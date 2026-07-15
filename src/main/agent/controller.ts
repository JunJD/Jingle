import { type IpcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import { randomUUID } from "node:crypto"
import {
  buildJingleAgentCommandEnvelope,
  buildJingleAgentCommandMessage,
  getJingleAgentSteerRejectionMessage,
  shouldSurfaceJingleSteerRejection,
  type JingleAgentSteerFailureReason,
  type JingleAgentSteerResult,
  type JingleRuntimeEventBatch
} from "@jingle/agent-client"
import type {
  AgentConnectThreadEventsResult,
  AgentThreadEvent,
  AgentThreadEventSubscriptionSurface,
  AgentThreadEventSubscriptionToken
} from "@shared/agent-thread-contract"
import {
  getAgentCommandLifecycleChannel,
  type AgentCommandLifecycleEvent,
  type AgentCommandOutcome
} from "@shared/agent-command"
import { AgentService, type AgentStreamSink } from "./service"
import { AgentThreadRunner } from "./agent-thread-runner"
import {
  parseAgentCancelParams,
  parseAgentConnectThreadEventsParams,
  parseAgentDisconnectThreadEventsParams,
  parseAgentEditLastUserMessageAndInvokeParams,
  parseAgentFollowUpQueueItemParams,
  parseAgentFollowUpQueueMessageParams,
  parseAgentFollowUpQueueRequestParams,
  parseAgentInvokeParams,
  parseAgentResumeParams,
  parseAgentSteerFollowUpParams
} from "./controller-schema"
import type {
  AgentEditLastUserMessageAndInvokeParams,
  AgentInvokeParams,
  AgentResumeParams
} from "../types"
import { buildIpcErrorPayload, JingleIpcError } from "../ipc/error"
import { registerIpcHandle } from "../ipc/handle"
import { serializeProcessError } from "../diagnostics/process-errors"

interface AgentControllerDiagnostics {
  error(message: string, metadata: Record<string, unknown>): void
  warn(message: string, metadata: Record<string, unknown>): void
}

interface AgentControllerSenderIdentity {
  getPinnedAiSessionThreadId(sender: WebContents): string | null
  isLauncher(sender: WebContents): boolean
}

type AgentControllerSender =
  | { surface: "launcher" }
  | { surface: "pinned-ai-session"; threadId: string }

export class AgentController {
  private readonly eventSubscriptionCleanups = new Map<string, () => void>()
  private readonly eventSubscriptions = new Map<
    string,
    {
      sender: WebContents
      subscriberId: string
      subscriptionToken: AgentThreadEventSubscriptionToken
      suppressesLauncher: boolean
      surface: AgentThreadEventSubscriptionSurface
      threadId: string
    }
  >()
  private readonly eventSubscriptionGenerations = new Map<string, number>()
  private nextEventSubscriberId = 0
  private readonly runtimeProjectionQueues = new Map<string, Promise<void>>()

  constructor(
    private readonly agentService: AgentService,
    private readonly agentThreadRunner: AgentThreadRunner,
    private readonly diagnostics: AgentControllerDiagnostics,
    private readonly senderIdentity: AgentControllerSenderIdentity
  ) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "agent:invoke", (event, rawParams: unknown) => {
      const sender = this.resolveAgentSender(event, "agent:invoke")
      return this.handleInvoke(event.sender, sender, rawParams)
    })

    registerIpcHandle(
      ipcMain,
      "agent:editLastUserMessageAndInvoke",
      (event, rawParams: unknown) => {
        const sender = this.resolveAgentSender(event, "agent:editLastUserMessageAndInvoke")
        return this.handleEditLastUserMessageAndInvoke(event.sender, sender, rawParams)
      }
    )

    registerIpcHandle(ipcMain, "agent:resume", (event, rawParams: unknown) => {
      const sender = this.resolveAgentSender(event, "agent:resume")
      return this.handleResume(event.sender, sender, rawParams)
    })

    registerIpcHandle(ipcMain, "agent:cancel", async (event, rawParams: unknown) => {
      const sender = this.resolveAgentSender(event, "agent:cancel")
      const params = parseAgentCancelParams(rawParams)
      this.assertAgentThreadAccess(sender, params.threadId, "agent:cancel")
      const didCancel = await this.agentService.cancel(params)
      if (didCancel) {
        await this.enqueueRuntimeProjection(params.threadId, () =>
          this.agentThreadRunner.handlePayload(params.threadId, { type: "cancelled" })
        )
      }
    })

    registerIpcHandle(ipcMain, "agent:connectThreadEvents", async (event, rawParams: unknown) => {
      const sender = this.resolveAgentSender(event, "agent:connectThreadEvents")
      const params = parseAgentConnectThreadEventsParams(rawParams)
      this.assertAgentThreadAccess(sender, params.threadId, "agent:connectThreadEvents")
      if (params.surface !== undefined && params.surface !== sender.surface) {
        throw new JingleIpcError({
          channel: "agent:connectThreadEvents",
          code: "PERMISSION_DENIED",
          message: "Agent event subscription surface does not match the invoking window."
        })
      }
      return this.ensureEventSubscription(event.sender, params.threadId, {
        fromRevision: params.fromRevision,
        surface: sender.surface
      })
    })

    registerIpcHandle(
      ipcMain,
      "agent:disconnectThreadEvents",
      async (event, rawParams: unknown) => {
        const sender = this.resolveAgentSender(event, "agent:disconnectThreadEvents")
        const params = parseAgentDisconnectThreadEventsParams(rawParams)
        this.assertAgentThreadAccess(sender, params.threadId, "agent:disconnectThreadEvents")
        this.removeEventSubscription(event.sender.id, params.threadId, params.subscriptionToken)
      }
    )

    registerIpcHandle(ipcMain, "agent:enqueueFollowUp", async (event, rawParams: unknown) => {
      const sender = this.resolveAgentSender(event, "agent:enqueueFollowUp")
      const params = parseAgentFollowUpQueueMessageParams("agent:enqueueFollowUp", rawParams)
      this.assertAgentThreadAccess(sender, params.threadId, "agent:enqueueFollowUp")
      return this.agentThreadRunner.enqueueFollowUp(params.threadId, {
        messageInput: params.messageInput
      })
    })

    registerIpcHandle(ipcMain, "agent:removeFollowUp", async (event, rawParams: unknown) => {
      const sender = this.resolveAgentSender(event, "agent:removeFollowUp")
      const params = parseAgentFollowUpQueueRequestParams("agent:removeFollowUp", rawParams)
      this.assertAgentThreadAccess(sender, params.threadId, "agent:removeFollowUp")
      await this.agentThreadRunner.removeFollowUp(params.threadId, params.requestId)
    })

    registerIpcHandle(ipcMain, "agent:restoreFollowUp", async (event, rawParams: unknown) => {
      const sender = this.resolveAgentSender(event, "agent:restoreFollowUp")
      const params = parseAgentFollowUpQueueItemParams("agent:restoreFollowUp", rawParams)
      this.assertAgentThreadAccess(sender, params.threadId, "agent:restoreFollowUp")
      await this.agentThreadRunner.restoreFollowUp(params.threadId, params.item)
    })

    registerIpcHandle(ipcMain, "agent:takeFollowUp", async (event, rawParams: unknown) => {
      const sender = this.resolveAgentSender(event, "agent:takeFollowUp")
      const params = parseAgentFollowUpQueueRequestParams("agent:takeFollowUp", rawParams)
      this.assertAgentThreadAccess(sender, params.threadId, "agent:takeFollowUp")
      return this.agentThreadRunner.takeFollowUp(params.threadId, params.requestId)
    })

    registerIpcHandle(ipcMain, "agent:steerFollowUp", async (event, rawParams: unknown) => {
      const sender = this.resolveAgentSender(event, "agent:steerFollowUp")
      const params = parseAgentSteerFollowUpParams(rawParams)
      this.assertAgentThreadAccess(sender, params.threadId, "agent:steerFollowUp")
      return this.handleSteerFollowUp(params.threadId, params.requestId, {
        expectedRunId: params.expectedRunId,
        expectedTurnId: params.expectedTurnId
      })
    })
  }

  private resolveAgentSender(event: IpcMainInvokeEvent, channel: string): AgentControllerSender {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new JingleIpcError({
        channel,
        code: "PERMISSION_DENIED",
        message: "Agent commands can only be invoked from a window's main frame."
      })
    }

    const isLauncher = this.senderIdentity.isLauncher(event.sender)
    const pinnedThreadId = this.senderIdentity.getPinnedAiSessionThreadId(event.sender)
    if (isLauncher) {
      if (pinnedThreadId !== null) {
        throw new JingleIpcError({
          channel,
          code: "PERMISSION_DENIED",
          message: "Agent commands can only be invoked by the Launcher or a Pinned AI session."
        })
      }
      return { surface: "launcher" }
    }
    if (pinnedThreadId === null) {
      throw new JingleIpcError({
        channel,
        code: "PERMISSION_DENIED",
        message: "Agent commands can only be invoked by the Launcher or a Pinned AI session."
      })
    }
    return { surface: "pinned-ai-session", threadId: pinnedThreadId }
  }

  private assertAgentThreadAccess(
    sender: AgentControllerSender,
    threadId: string,
    channel: string
  ): void {
    if (sender.surface === "pinned-ai-session" && sender.threadId !== threadId) {
      throw new JingleIpcError({
        channel,
        code: "PERMISSION_DENIED",
        message: "Pinned AI sessions can only access their bound thread."
      })
    }
  }

  private async handleInvoke(
    sender: WebContents,
    senderIdentity: AgentControllerSender,
    rawParams: unknown
  ): Promise<AgentCommandOutcome> {
    const params = parseAgentInvokeParams(rawParams)
    this.assertAgentThreadAccess(senderIdentity, params.threadId, "agent:invoke")
    const steeringOutcome = await this.handleSteeringFollowUp(params, sender)
    if (steeringOutcome) {
      return steeringOutcome
    }

    return this.agentService.dispatchInvoke(params, this.createStreamSink(params.threadId), {
      onCoreAdmitted: () => {
        this.sendCommandLifecycleEvent(sender, {
          commandId: params.message.id,
          threadId: params.threadId,
          type: "admitted"
        })
      },
      onRunAccepted: () => {
        this.enqueueCommandProjection({
          channel: "agent:invoke",
          commandId: params.message.id,
          sender,
          task: () => this.agentThreadRunner.prepareInvoke(params.threadId, params.message),
          threadId: params.threadId
        })
      },
      onSteersApplied: (steers) =>
        this.enqueueRuntimeProjection(params.threadId, () =>
          this.agentThreadRunner.markSteeringApplied(params.threadId, steers)
        )
    })
  }

  private handleEditLastUserMessageAndInvoke(
    sender: WebContents,
    senderIdentity: AgentControllerSender,
    rawParams: unknown
  ): Promise<AgentCommandOutcome> {
    const params: AgentEditLastUserMessageAndInvokeParams =
      parseAgentEditLastUserMessageAndInvokeParams(rawParams)
    this.assertAgentThreadAccess(
      senderIdentity,
      params.threadId,
      "agent:editLastUserMessageAndInvoke"
    )

    return this.agentService.dispatchEditLastUserMessageAndInvoke(
      params,
      this.createStreamSink(params.threadId),
      {
        onCoreAdmitted: () => {
          this.sendCommandLifecycleEvent(sender, {
            commandId: params.message.id,
            threadId: params.threadId,
            type: "admitted"
          })
        },
        onRunAccepted: () => {
          this.enqueueCommandProjection({
            channel: "agent:editLastUserMessageAndInvoke",
            commandId: params.message.id,
            sender,
            task: () =>
              this.agentThreadRunner.prepareEditLastUserMessageAndInvoke(
                params.threadId,
                params.message
              ),
            threadId: params.threadId
          })
        },
        onSteersApplied: (steers) =>
          this.enqueueRuntimeProjection(params.threadId, () =>
            this.agentThreadRunner.markSteeringApplied(params.threadId, steers)
          )
      }
    )
  }

  private handleResume(
    sender: WebContents,
    senderIdentity: AgentControllerSender,
    rawParams: unknown
  ): Promise<AgentCommandOutcome> {
    const params: AgentResumeParams = parseAgentResumeParams(rawParams)
    this.assertAgentThreadAccess(senderIdentity, params.threadId, "agent:resume")

    return this.agentService.dispatchResume(params, this.createStreamSink(params.threadId), {
      onCoreAdmitted: () => {
        this.sendCommandLifecycleEvent(sender, {
          commandId: params.decision.request_id,
          threadId: params.threadId,
          type: "admitted"
        })
      },
      onRunAccepted: (decision) => {
        this.enqueueCommandProjection({
          channel: "agent:resume",
          commandId: params.decision.request_id,
          sender,
          task: () => this.agentThreadRunner.prepareResume(params.threadId, decision),
          threadId: params.threadId
        })
      },
      onSteersApplied: (steers) =>
        this.enqueueRuntimeProjection(params.threadId, () =>
          this.agentThreadRunner.markSteeringApplied(params.threadId, steers)
        )
    })
  }

  private createThreadEventsChannel(threadId: string): string {
    return `agent:thread-events:${threadId}`
  }

  private async handleSteeringFollowUp(
    params: AgentInvokeParams,
    sender: WebContents
  ): Promise<AgentCommandOutcome | null> {
    if (params.followUpAction !== "steer") {
      return null
    }

    const acceptedAt = new Date()
    const steerResult = this.agentService.steerActiveRun(params.threadId, params.message, {
      acceptedAt,
      expectedRunId: params.expectedRunId,
      expectedTurnId: params.expectedTurnId
    })
    if (steerResult.type === "accepted") {
      this.sendCommandLifecycleEvent(sender, {
        commandId: params.message.id,
        threadId: params.threadId,
        type: "admitted"
      })
      this.enqueueCommandProjection({
        channel: "agent:invoke",
        commandId: params.message.id,
        sender,
        task: () =>
          this.agentThreadRunner.prepareSteeringMessage(
            params.threadId,
            params.message,
            acceptedAt
          ),
        threadId: params.threadId
      })
      return { disposition: "steer", type: "accepted" }
    }

    if (!shouldSurfaceJingleSteerRejection(steerResult.reason)) {
      return null
    }

    const error = buildIpcErrorPayload(
      "agent:invoke",
      new JingleIpcError({
        channel: "agent:invoke",
        code: this.getSteerRejectedErrorCode(steerResult.reason),
        message: getJingleAgentSteerRejectionMessage(steerResult.reason)
      })
    )
    this.diagnostics.warn("Agent steering command rejected", {
      code: error.code,
      message: error.message,
      reason: steerResult.reason,
      threadId: params.threadId
    })
    return {
      error,
      type: "rejected"
    }
  }

  private async handleSteerFollowUp(
    threadId: string,
    requestId: string,
    options: { expectedRunId?: string | null; expectedTurnId?: string | null } = {}
  ): Promise<JingleAgentSteerResult> {
    const runtimeState = await this.agentThreadRunner.readThreadState(threadId)
    const queued = runtimeState.followUpQueue.items.find((item) => item.requestId === requestId)
    if (!queued) {
      return { reason: "queue_item_not_found", type: "rejected" }
    }

    const commandEnvelope = buildJingleAgentCommandEnvelope({
      messageInput: queued.messageInput
    })
    if (!commandEnvelope) {
      return { reason: "invalid_message", type: "rejected" }
    }

    const message: AgentInvokeParams["message"] = buildJingleAgentCommandMessage({
      envelope: commandEnvelope,
      messageId: queued.requestId
    })
    const acceptedAt = new Date()
    const steerResult = this.agentService.steerActiveRun(threadId, message, {
      acceptedAt,
      expectedRunId: options.expectedRunId,
      expectedTurnId: options.expectedTurnId
    })
    if (steerResult.type === "rejected") {
      if (shouldSurfaceJingleSteerRejection(steerResult.reason)) {
        this.diagnostics.warn("Queued agent steering command rejected", {
          message: getJingleAgentSteerRejectionMessage(steerResult.reason),
          reason: steerResult.reason,
          requestId,
          threadId
        })
      }
      return steerResult
    }

    await this.enqueueRuntimeProjection(threadId, () =>
      this.agentThreadRunner.prepareSteeringMessage(threadId, message, acceptedAt)
    )
    await this.agentThreadRunner.removeFollowUp(threadId, requestId)
    return steerResult
  }

  private getSteerRejectedErrorCode(
    reason: JingleAgentSteerFailureReason
  ): "CONFLICT" | "INVALID_ARGUMENT" | "NOT_FOUND" {
    switch (reason) {
      case "active_run_mismatch":
      case "active_turn_mismatch":
      case "no_active_run":
        return "CONFLICT"
      case "invalid_message":
        return "INVALID_ARGUMENT"
      case "queue_item_not_found":
        return "NOT_FOUND"
    }
  }

  private createStreamSink(threadId: string): AgentStreamSink {
    return {
      send: (payload) => {
        if (payload.type === "run_rejected") {
          this.diagnostics.warn("Agent run admission rejected", {
            code: payload.code,
            message: payload.message ?? payload.error,
            threadId
          })
          return
        }
        this.enqueueRuntimeProjection(threadId, () =>
          this.agentThreadRunner.handlePayload(threadId, payload)
        )
      }
    }
  }

  private enqueueCommandProjection(input: {
    channel: "agent:editLastUserMessageAndInvoke" | "agent:invoke" | "agent:resume"
    commandId: string
    sender: WebContents
    task: () => Promise<void>
    threadId: string
  }): void {
    void this.enqueueRuntimeProjection(input.threadId, async () => {
      try {
        await input.task()
        this.sendCommandLifecycleEvent(input.sender, {
          commandId: input.commandId,
          threadId: input.threadId,
          type: "projection_applied"
        })
      } catch (error) {
        this.sendCommandLifecycleEvent(input.sender, {
          commandId: input.commandId,
          error: buildIpcErrorPayload(input.channel, error),
          threadId: input.threadId,
          type: "projection_failed"
        })
        throw error
      }
    })
  }

  private sendCommandLifecycleEvent(sender: WebContents, event: AgentCommandLifecycleEvent): void {
    if (sender.isDestroyed()) {
      return
    }

    try {
      sender.send(getAgentCommandLifecycleChannel(event.commandId), event)
    } catch (error) {
      this.diagnostics.error("Agent command lifecycle delivery failed", {
        commandId: event.commandId,
        error: serializeProcessError(error),
        threadId: event.threadId,
        type: event.type
      })
    }
  }

  private enqueueRuntimeProjection(threadId: string, task: () => Promise<void>): Promise<void> {
    const previousQueue = this.runtimeProjectionQueues.get(threadId) ?? Promise.resolve()
    // 入队顺序同步确定；runtime callbacks 不等待投影，显式 projection commands 可以等待。
    const nextQueue = previousQueue
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.runtimeProjectionQueues.get(threadId) === nextQueue) {
          this.runtimeProjectionQueues.delete(threadId)
        }
      })
      .catch((error) => {
        this.diagnostics.error("Agent runtime projection failed", {
          error: serializeProcessError(error),
          threadId
        })
      })
    this.runtimeProjectionQueues.set(threadId, nextQueue)
    return nextQueue
  }

  private async ensureEventSubscription(
    sender: WebContents,
    threadId: string,
    options: {
      fromRevision?: number
      surface: AgentThreadEventSubscriptionSurface
    }
  ): Promise<AgentConnectThreadEventsResult> {
    const subscriptionKey = this.getSubscriptionKey(sender.id, threadId)
    const generationKey =
      options.surface === "pinned-ai-session"
        ? this.getPinnedSubscriptionGenerationKey(sender.id)
        : subscriptionKey
    const generation = (this.eventSubscriptionGenerations.get(generationKey) ?? 0) + 1
    this.eventSubscriptionGenerations.set(generationKey, generation)
    this.nextEventSubscriberId += 1
    const subscriberId = `${subscriptionKey}:${this.nextEventSubscriberId}`
    const subscriptionToken = randomUUID()
    const previousCleanup = this.eventSubscriptionCleanups.get(subscriptionKey)
    const previousSubscription = this.eventSubscriptions.get(subscriptionKey)
    const restorePreviousSubscription = (): void => {
      if (this.eventSubscriptions.get(subscriptionKey)?.subscriberId !== subscriberId) {
        return
      }
      if (
        previousCleanup &&
        previousSubscription &&
        this.eventSubscriptionCleanups.get(subscriptionKey) === previousCleanup &&
        !sender.isDestroyed()
      ) {
        this.eventSubscriptions.set(subscriptionKey, previousSubscription)
        return
      }
      this.eventSubscriptions.delete(subscriptionKey)
    }
    const listener = (batch: JingleRuntimeEventBatch<AgentThreadEvent>): void => {
      if (
        !sender.isDestroyed() &&
        this.eventSubscriptions.get(subscriptionKey)?.subscriberId === subscriberId &&
        this.shouldSendThreadEvents(subscriptionKey, threadId)
      ) {
        sender.send(this.createThreadEventsChannel(threadId), batch)
      }
    }

    this.eventSubscriptions.set(subscriptionKey, {
      sender,
      subscriberId,
      subscriptionToken,
      suppressesLauncher: previousCleanup !== undefined,
      surface: options.surface,
      threadId
    })

    const handlePendingSenderDestroyed = (): void => {
      this.removeAllSubscriptionsForSender(sender.id)
    }
    sender.once("destroyed", handlePendingSenderDestroyed)

    try {
      await this.agentThreadRunner.connectThreadEvents(threadId, subscriberId, listener, {
        fromRevision: options.fromRevision
      })
    } catch (error) {
      sender.removeListener("destroyed", handlePendingSenderDestroyed)
      this.agentThreadRunner.disconnectThreadEvents(threadId, subscriberId)
      restorePreviousSubscription()
      throw error
    }

    sender.removeListener("destroyed", handlePendingSenderDestroyed)

    const isCurrentGeneration = this.eventSubscriptionGenerations.get(generationKey) === generation
    const isCurrentPinnedThread =
      options.surface !== "pinned-ai-session" ||
      this.senderIdentity.getPinnedAiSessionThreadId(sender) === threadId
    if (sender.isDestroyed() || !isCurrentGeneration || !isCurrentPinnedThread) {
      this.agentThreadRunner.disconnectThreadEvents(threadId, subscriberId)
      restorePreviousSubscription()
      return { subscriptionToken }
    }

    if (options.surface === "pinned-ai-session") {
      this.removeOtherSubscriptionsForSender(sender.id, subscriptionKey)
    }
    previousCleanup?.()

    const handleSenderDestroyed = (): void => {
      this.removeAllSubscriptionsForSender(sender.id)
    }
    const cleanup = () => {
      this.agentThreadRunner.disconnectThreadEvents(threadId, subscriberId)
      if (this.eventSubscriptionCleanups.get(subscriptionKey) === cleanup) {
        this.eventSubscriptionCleanups.delete(subscriptionKey)
      }
      if (this.eventSubscriptions.get(subscriptionKey)?.subscriberId === subscriberId) {
        this.eventSubscriptions.delete(subscriptionKey)
      }
      sender.removeListener("destroyed", handleSenderDestroyed)
    }

    this.eventSubscriptions.set(subscriptionKey, {
      sender,
      subscriberId,
      subscriptionToken,
      suppressesLauncher: true,
      surface: options.surface,
      threadId
    })
    this.eventSubscriptionCleanups.set(subscriptionKey, cleanup)

    sender.once("destroyed", handleSenderDestroyed)
    return { subscriptionToken }
  }

  private getSubscriptionKey(senderId: number, threadId: string): string {
    return `${senderId}:${threadId}`
  }

  private shouldSendThreadEvents(subscriptionKey: string, threadId: string): boolean {
    const subscription = this.eventSubscriptions.get(subscriptionKey)
    if (!subscription) {
      return false
    }

    if (subscription.surface === "pinned-ai-session") {
      return this.senderIdentity.getPinnedAiSessionThreadId(subscription.sender) === threadId
    }

    for (const [candidateKey, candidate] of this.eventSubscriptions) {
      if (
        candidateKey !== subscriptionKey &&
        candidate.threadId === threadId &&
        candidate.surface === "pinned-ai-session" &&
        candidate.suppressesLauncher &&
        this.senderIdentity.getPinnedAiSessionThreadId(candidate.sender) === threadId &&
        !candidate.sender.isDestroyed()
      ) {
        return false
      }
    }

    return true
  }

  private removeAllSubscriptionsForSender(senderId: number): void {
    this.invalidateEventSubscriptionGeneration(this.getPinnedSubscriptionGenerationKey(senderId))
    const prefix = `${senderId}:`
    for (const subscriptionKey of this.eventSubscriptions.keys()) {
      if (!subscriptionKey.startsWith(prefix)) {
        continue
      }

      this.invalidateEventSubscriptionGeneration(subscriptionKey)
      this.removeSubscriptionByKey(subscriptionKey)
    }
  }

  private removeOtherSubscriptionsForSender(senderId: number, retainedKey: string): void {
    const prefix = `${senderId}:`
    for (const subscriptionKey of this.eventSubscriptions.keys()) {
      if (subscriptionKey !== retainedKey && subscriptionKey.startsWith(prefix)) {
        this.removeSubscriptionByKey(subscriptionKey)
      }
    }
  }

  private removeEventSubscription(
    senderId: number,
    threadId: string,
    subscriptionToken: AgentThreadEventSubscriptionToken
  ): void {
    const subscriptionKey = this.getSubscriptionKey(senderId, threadId)
    if (this.eventSubscriptions.get(subscriptionKey)?.subscriptionToken !== subscriptionToken) {
      return
    }
    this.invalidateEventSubscriptionGeneration(subscriptionKey)
    this.invalidateEventSubscriptionGeneration(this.getPinnedSubscriptionGenerationKey(senderId))
    this.removeSubscriptionByKey(subscriptionKey)
  }

  private removeSubscriptionByKey(subscriptionKey: string): void {
    const cleanup = this.eventSubscriptionCleanups.get(subscriptionKey)
    cleanup?.()
    const subscription = this.eventSubscriptions.get(subscriptionKey)
    if (!subscription) {
      return
    }
    this.agentThreadRunner.disconnectThreadEvents(subscription.threadId, subscription.subscriberId)
    this.eventSubscriptions.delete(subscriptionKey)
  }

  private getPinnedSubscriptionGenerationKey(senderId: number): string {
    return `pinned:${senderId}`
  }

  private invalidateEventSubscriptionGeneration(generationKey: string): void {
    const generation = (this.eventSubscriptionGenerations.get(generationKey) ?? 0) + 1
    this.eventSubscriptionGenerations.set(generationKey, generation)
  }
}
