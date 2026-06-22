import { type IpcMain, type WebContents } from "electron"
import type { AgentThreadEventBatch } from "@shared/agent-thread-runtime"
import { AgentService, type AgentStreamSink } from "./service"
import { AgentThreadRunner } from "./agent-thread-runner"
import {
  parseAgentCancelParams,
  parseAgentConnectThreadEventsParams,
  parseAgentEditLastUserMessageAndInvokeParams,
  parseAgentInvokeParams,
  parseAgentResumeParams
} from "./controller-schema"
import type {
  AgentEditLastUserMessageAndInvokeParams,
  AgentInvokeParams,
  AgentResumeParams
} from "../types"
import { buildIpcErrorEvent } from "../ipc/error"
import { registerIpcHandle } from "../ipc/handle"
import { IpcSchemaValidationError } from "../ipc/schema"

export class AgentController {
  private readonly eventSubscriptionCleanups = new Map<string, () => void>()

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
        fromRevision: params.fromRevision
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
  }

  private async handleInvoke(rawParams: unknown): Promise<void> {
    let params: AgentInvokeParams

    try {
      params = parseAgentInvokeParams(rawParams)
    } catch (error) {
      this.handleStreamValidationError(rawParams, "invoke", error)
      return
    }

    if (await this.handleRunningFollowUp(params)) {
      return
    }

    void this.agentService.invoke(params, this.createStreamSink(params.threadId), {
      onRunAccepted: () => this.agentThreadRunner.prepareInvoke(params.threadId, params.message)
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
      onRunAccepted: () =>
        this.agentThreadRunner.prepareResume(params.threadId, params.command?.resume)
    })
  }

  private createThreadEventsChannel(threadId: string): string {
    return `agent:thread-events:${threadId}`
  }

  private async handleRunningFollowUp(params: AgentInvokeParams): Promise<boolean> {
    const runtimeState = await this.agentThreadRunner.readThreadState(params.threadId)
    if (runtimeState.activeRun?.status !== "running") {
      return false
    }

    if (params.followUpAction !== "steer") {
      await this.agentThreadRunner.handlePayload(params.threadId, {
        type: "error",
        ...buildIpcErrorEvent(
          "agent:invoke",
          new Error("Agent run is already in progress; follow-ups must be queued locally or steered")
        )
      })
      return true
    }

    const appliedSteer = this.agentService.steerActiveRun(params.threadId, params.message)
    if (!appliedSteer) {
      await this.agentThreadRunner.handlePayload(params.threadId, {
        type: "error",
        ...buildIpcErrorEvent(
          "agent:invoke",
          new Error("Agent run is not available for steering")
        )
      })
    }
    return true
  }

  private createStreamSink(threadId: string): AgentStreamSink {
    return {
      send: (payload) => {
        void this.agentThreadRunner.handlePayload(threadId, payload)
      }
    }
  }

  private async ensureEventSubscription(
    sender: WebContents,
    threadId: string,
    options: { fromRevision?: number } = {}
  ): Promise<void> {
    const subscriptionKey = this.getSubscriptionKey(sender.id, threadId)
    const listener = (batch: AgentThreadEventBatch): void => {
      if (!sender.isDestroyed()) {
        sender.send(this.createThreadEventsChannel(threadId), batch)
      }
    }

    await this.agentThreadRunner.connectThreadEvents(threadId, subscriptionKey, listener, {
      fromRevision: options.fromRevision
    })

    if (this.eventSubscriptionCleanups.has(subscriptionKey)) {
      return
    }

    const cleanup = () => {
      this.agentThreadRunner.disconnectThreadEvents(threadId, subscriptionKey)
      this.eventSubscriptionCleanups.delete(subscriptionKey)
    }

    this.eventSubscriptionCleanups.set(subscriptionKey, cleanup)

    sender.once("destroyed", () => {
      this.removeAllSubscriptionsForSender(sender.id)
    })
  }

  private getSubscriptionKey(senderId: number, threadId: string): string {
    return `${senderId}:${threadId}`
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
