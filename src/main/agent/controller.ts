import { type IpcMain, type WebContents } from "electron"
import {
  buildJingleAgentCommandEnvelope,
  buildJingleAgentCommandMessage,
  type JingleAgentSteerFailureReason,
  type JingleAgentSteerResult,
  type JingleRuntimeEventBatch
} from "@jingle/agent-client"
import type {
  AgentThreadEvent,
  AgentThreadEventSubscriptionSurface
} from "@shared/agent-thread-contract"
import { AgentService, type AgentStreamSink } from "./service"
import { AgentThreadRunner } from "./agent-thread-runner"
import {
  parseAgentCancelParams,
  parseAgentConnectThreadEventsParams,
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
import { buildIpcErrorEvent } from "../ipc/error"
import { registerIpcHandle } from "../ipc/handle"
import { IpcSchemaValidationError } from "../ipc/schema"
import { diagnosticsLogger } from "../diagnostics/instance"
import { serializeProcessError } from "../diagnostics/process-errors"

export class AgentController {
  private readonly eventSubscriptionCleanups = new Map<string, () => void>()
  private readonly eventSubscriptions = new Map<
    string,
    {
      sender: WebContents
      surface: AgentThreadEventSubscriptionSurface
      threadId: string
    }
  >()
  private readonly runtimeProjectionQueues = new Map<string, Promise<void>>()

  constructor(
    private readonly agentService: AgentService,
    private readonly agentThreadRunner: AgentThreadRunner
  ) {}

  register(ipcMain: IpcMain): void {
    console.log("[Agent] Registering agent handlers...")

    ipcMain.on("agent:invoke", (_event, rawParams: unknown) => {
      void this.handleInvoke(rawParams)
    })

    ipcMain.on("agent:editLastUserMessageAndInvoke", (_event, rawParams: unknown) => {
      void this.handleEditLastUserMessageAndInvoke(rawParams)
    })

    ipcMain.on("agent:resume", (_event, rawParams: unknown) => {
      void this.handleResume(rawParams)
    })

    registerIpcHandle(ipcMain, "agent:cancel", async (_event, rawParams: unknown) => {
      const params = parseAgentCancelParams(rawParams)
      const didCancel = await this.agentService.cancel(params)
      if (didCancel) {
        await this.agentThreadRunner.handlePayload(params.threadId, { type: "cancelled" })
      }
    })

    registerIpcHandle(ipcMain, "agent:connectThreadEvents", async (event, rawParams: unknown) => {
      const params = parseAgentConnectThreadEventsParams(rawParams)
      await this.ensureEventSubscription(event.sender, params.threadId, {
        fromRevision: params.fromRevision,
        surface: params.surface
      })
    })

    registerIpcHandle(
      ipcMain,
      "agent:disconnectThreadEvents",
      async (event, rawParams: unknown) => {
        const params = parseAgentCancelParams(rawParams)
        this.removeEventSubscription(event.sender.id, params.threadId)
      }
    )

    registerIpcHandle(ipcMain, "agent:enqueueFollowUp", async (_event, rawParams: unknown) => {
      const params = parseAgentFollowUpQueueMessageParams("agent:enqueueFollowUp", rawParams)
      return this.agentThreadRunner.enqueueFollowUp(params.threadId, {
        messageInput: params.messageInput
      })
    })

    registerIpcHandle(ipcMain, "agent:removeFollowUp", async (_event, rawParams: unknown) => {
      const params = parseAgentFollowUpQueueRequestParams("agent:removeFollowUp", rawParams)
      await this.agentThreadRunner.removeFollowUp(params.threadId, params.requestId)
    })

    registerIpcHandle(ipcMain, "agent:restoreFollowUp", async (_event, rawParams: unknown) => {
      const params = parseAgentFollowUpQueueItemParams("agent:restoreFollowUp", rawParams)
      await this.agentThreadRunner.restoreFollowUp(params.threadId, params.item)
    })

    registerIpcHandle(ipcMain, "agent:takeFollowUp", async (_event, rawParams: unknown) => {
      const params = parseAgentFollowUpQueueRequestParams("agent:takeFollowUp", rawParams)
      return this.agentThreadRunner.takeFollowUp(params.threadId, params.requestId)
    })

    registerIpcHandle(ipcMain, "agent:steerFollowUp", async (_event, rawParams: unknown) => {
      const params = parseAgentSteerFollowUpParams(rawParams)
      return this.handleSteerFollowUp(params.threadId, params.requestId, {
        expectedRunId: params.expectedRunId,
        expectedTurnId: params.expectedTurnId
      })
    })
  }

  private async handleInvoke(rawParams: unknown): Promise<void> {
    let params: AgentInvokeParams

    try {
      params = parseAgentInvokeParams(rawParams)
    } catch (error) {
      this.handleStreamValidationError(rawParams, "invoke", error)
      return
    }

    if (await this.handleSteeringFollowUp(params)) {
      return
    }

    void this.agentService.invoke(params, this.createStreamSink(params.threadId), {
      onRunAccepted: () => this.agentThreadRunner.prepareInvoke(params.threadId, params.message),
      onSteersApplied: (steers) =>
        this.enqueueRuntimeProjection(params.threadId, () =>
          this.agentThreadRunner.markSteeringApplied(params.threadId, steers)
        )
    })
  }

  private async handleEditLastUserMessageAndInvoke(rawParams: unknown): Promise<void> {
    let params: AgentEditLastUserMessageAndInvokeParams

    try {
      params = parseAgentEditLastUserMessageAndInvokeParams(rawParams)
    } catch (error) {
      this.handleStreamValidationError(rawParams, "editLastUserMessageAndInvoke", error)
      return
    }

    void this.agentService.editLastUserMessageAndInvoke(
      params,
      this.createStreamSink(params.threadId),
      {
        onRunAccepted: () =>
          this.agentThreadRunner.prepareEditLastUserMessageAndInvoke(
            params.threadId,
            params.message
          ),
        onSteersApplied: (steers) =>
          this.enqueueRuntimeProjection(params.threadId, () =>
            this.agentThreadRunner.markSteeringApplied(params.threadId, steers)
          )
      }
    )
  }

  private async handleResume(rawParams: unknown): Promise<void> {
    let params: AgentResumeParams

    try {
      params = parseAgentResumeParams(rawParams)
    } catch (error) {
      this.handleStreamValidationError(rawParams, "resume", error)
      return
    }

    void this.agentService.resume(params, this.createStreamSink(params.threadId), {
      onRunAccepted: () => this.agentThreadRunner.prepareResume(params.threadId, params.decision),
      onSteersApplied: (steers) =>
        this.enqueueRuntimeProjection(params.threadId, () =>
          this.agentThreadRunner.markSteeringApplied(params.threadId, steers)
        )
    })
  }

  private createThreadEventsChannel(threadId: string): string {
    return `agent:thread-events:${threadId}`
  }

  private async handleSteeringFollowUp(params: AgentInvokeParams): Promise<boolean> {
    if (params.followUpAction === "steer") {
      const acceptedAt = new Date()
      const steerResult = this.agentService.steerActiveRun(params.threadId, params.message, {
        acceptedAt,
        expectedRunId: params.expectedRunId,
        expectedTurnId: params.expectedTurnId
      })
      if (steerResult.type === "accepted") {
        await this.enqueueRuntimeProjection(params.threadId, () =>
          this.agentThreadRunner.prepareSteeringMessage(
            params.threadId,
            params.message,
            acceptedAt
          )
        )
        return true
      }

      if (
        steerResult.reason === "active_run_mismatch" ||
        steerResult.reason === "active_turn_mismatch"
      ) {
        await this.agentThreadRunner.handlePayload(params.threadId, {
          type: "error",
          ...buildIpcErrorEvent(
            "agent:invoke",
            new Error(this.getSteerRejectedMessage(steerResult.reason))
          )
        })
        return true
      }

      return false
    }

    const runtimeState = await this.agentThreadRunner.readThreadState(params.threadId)
    if (runtimeState.activeRun?.status !== "running") {
      return false
    }

    await this.agentThreadRunner.handlePayload(params.threadId, {
      type: "error",
      ...buildIpcErrorEvent(
        "agent:invoke",
        new Error("Agent run is already in progress; follow-ups must be queued or steered")
      )
    })
    return true
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
      if (
        steerResult.reason === "active_run_mismatch" ||
        steerResult.reason === "active_turn_mismatch" ||
        steerResult.reason === "invalid_message"
      ) {
        await this.agentThreadRunner.handlePayload(threadId, {
          type: "error",
          ...buildIpcErrorEvent(
            "agent:steerFollowUp",
            new Error(this.getSteerRejectedMessage(steerResult.reason))
          )
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

  private getSteerRejectedMessage(reason: JingleAgentSteerFailureReason): string {
    switch (reason) {
      case "active_run_mismatch":
        return "Agent run changed before the queued follow-up could steer it"
      case "active_turn_mismatch":
        return "Agent turn changed before the queued follow-up could steer it"
      case "invalid_message":
        return "Queued follow-up is empty and cannot steer the active run"
      case "no_active_run":
        return "Agent run is not available for steering"
      case "queue_item_not_found":
        return "Queued follow-up is no longer available"
    }
  }

  private createStreamSink(threadId: string): AgentStreamSink {
    return {
      send: (payload) => {
        this.enqueueRuntimeProjection(threadId, () =>
          this.agentThreadRunner.handlePayload(threadId, payload)
        )
      }
    }
  }

  private enqueueRuntimeProjection(threadId: string, task: () => Promise<void>): Promise<void> {
    const previousQueue = this.runtimeProjectionQueues.get(threadId) ?? Promise.resolve()
    // 这里必须返回队列 Promise：steer.applied 需要在真正喂给模型前完成投影。
    const nextQueue = previousQueue
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.runtimeProjectionQueues.get(threadId) === nextQueue) {
          this.runtimeProjectionQueues.delete(threadId)
        }
      })
      .catch((error) => {
        diagnosticsLogger.error("Agent runtime projection failed", {
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
  ): Promise<void> {
    const subscriptionKey = this.getSubscriptionKey(sender.id, threadId)
    const isExistingSubscription = this.eventSubscriptionCleanups.has(subscriptionKey)

    const listener = (batch: JingleRuntimeEventBatch<AgentThreadEvent>): void => {
      if (!sender.isDestroyed() && this.shouldSendThreadEvents(subscriptionKey, threadId)) {
        sender.send(this.createThreadEventsChannel(threadId), batch)
      }
    }

    this.eventSubscriptions.set(subscriptionKey, {
      sender,
      surface: options.surface,
      threadId
    })

    try {
      await this.agentThreadRunner.connectThreadEvents(threadId, subscriptionKey, listener, {
        fromRevision: options.fromRevision
      })
    } catch (error) {
      if (!isExistingSubscription) {
        this.eventSubscriptions.delete(subscriptionKey)
      }
      throw error
    }

    if (isExistingSubscription) {
      return
    }

    const cleanup = () => {
      this.agentThreadRunner.disconnectThreadEvents(threadId, subscriptionKey)
      this.eventSubscriptionCleanups.delete(subscriptionKey)
      this.eventSubscriptions.delete(subscriptionKey)
    }

    this.eventSubscriptionCleanups.set(subscriptionKey, cleanup)

    sender.once("destroyed", () => {
      this.removeAllSubscriptionsForSender(sender.id)
    })
  }

  private getSubscriptionKey(senderId: number, threadId: string): string {
    return `${senderId}:${threadId}`
  }

  private shouldSendThreadEvents(subscriptionKey: string, threadId: string): boolean {
    const subscription = this.eventSubscriptions.get(subscriptionKey)
    if (!subscription) {
      return false
    }

    if (subscription.surface !== "launcher") {
      return true
    }

    for (const [candidateKey, candidate] of this.eventSubscriptions) {
      if (
        candidateKey !== subscriptionKey &&
        candidate.threadId === threadId &&
        candidate.surface === "pinned-ai-session" &&
        !candidate.sender.isDestroyed()
      ) {
        return false
      }
    }

    return true
  }

  private handleStreamValidationError(
    rawParams: unknown,
    operation: "editLastUserMessageAndInvoke" | "invoke" | "resume",
    error: unknown
  ): void {
    const rawThreadId = this.getRawThreadId(rawParams)
    if (error instanceof IpcSchemaValidationError && rawThreadId) {
      void this.agentThreadRunner.handlePayload(rawThreadId, {
        type: "error",
        ...buildIpcErrorEvent(`agent:${operation}`, error)
      })
      return
    }

    throw error
  }

  private getRawThreadId(value: unknown): string | null {
    if (!value || typeof value !== "object") {
      return null
    }

    const threadId = (value as { threadId?: unknown }).threadId
    return typeof threadId === "string" && threadId.trim().length > 0 ? threadId.trim() : null
  }

  private removeAllSubscriptionsForSender(senderId: number): void {
    const prefix = `${senderId}:`
    for (const [subscriptionKey, cleanup] of this.eventSubscriptionCleanups.entries()) {
      if (!subscriptionKey.startsWith(prefix)) {
        continue
      }

      cleanup()
    }
  }

  private removeEventSubscription(senderId: number, threadId: string): void {
    const subscriptionKey = this.getSubscriptionKey(senderId, threadId)
    const cleanup = this.eventSubscriptionCleanups.get(subscriptionKey)
    cleanup?.()
  }
}
