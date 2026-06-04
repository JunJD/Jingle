import { type IpcMain, type WebContents } from "electron"
import { AgentService, type AgentStreamSink } from "./service"
import { AgentStreamHub } from "./stream-hub"
import {
  parseAgentCancelParams,
  parseAgentInvokeParams,
  parseAgentResumeParams
} from "./controller-schema"
import type { AgentInvokeParams, AgentResumeParams } from "../types"
import { buildIpcErrorEvent } from "../ipc/error"
import { registerIpcHandle } from "../ipc/handle"
import { IpcSchemaValidationError } from "../ipc/schema"

export class AgentController {
  private readonly eventSubscriptionCleanups = new Map<string, () => void>()

  constructor(
    private readonly agentService: AgentService,
    private readonly agentStreamHub: AgentStreamHub
  ) {}

  register(ipcMain: IpcMain): void {
    console.log("[Agent] Registering agent handlers...")

    ipcMain.on("agent:invoke", (_event, rawParams: unknown) => {
      void this.handleInvoke(rawParams)
    })

    ipcMain.on("agent:resume", (_event, rawParams: unknown) => {
      void this.handleResume(rawParams)
    })

    registerIpcHandle(ipcMain, "agent:cancel", async (_event, rawParams: unknown) => {
      const params = parseAgentCancelParams(rawParams)
      const didCancel = await this.agentService.cancel(params)
      if (didCancel) {
        await this.agentStreamHub.handlePayload(params.threadId, { type: "cancelled" })
      }
    })

    registerIpcHandle(ipcMain, "agent:getThreadSnapshot", async (_event, rawParams: unknown) => {
      const params = parseAgentCancelParams(rawParams)
      return this.agentStreamHub.getThreadSnapshot(params.threadId)
    })

    registerIpcHandle(ipcMain, "agent:subscribeThreadEvents", async (event, rawParams: unknown) => {
      const params = parseAgentCancelParams(rawParams)
      await this.ensureEventSubscription(event.sender, params.threadId)
      return this.agentStreamHub.getThreadSnapshot(params.threadId)
    })

    registerIpcHandle(ipcMain, "agent:unsubscribeThreadEvents", async (event, rawParams: unknown) => {
      const params = parseAgentCancelParams(rawParams)
      this.removeEventSubscription(event.sender.id, params.threadId)
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

    void this.agentService.invoke(params, this.createStreamSink(params.threadId), {
      onRunAccepted: () => this.agentStreamHub.prepareInvoke(params.threadId, params.message)
    })
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
      onRunAccepted: () => this.agentStreamHub.prepareResume(params.threadId)
    })
  }

  private createThreadEventsChannel(threadId: string): string {
    return `agent:thread-events:${threadId}`
  }

  private createStreamSink(threadId: string): AgentStreamSink {
    return {
      send: (payload) => {
        void this.agentStreamHub.handlePayload(threadId, payload)
      }
    }
  }

  private async ensureEventSubscription(sender: WebContents, threadId: string): Promise<void> {
    const subscriptionKey = this.getSubscriptionKey(sender.id, threadId)
    if (this.eventSubscriptionCleanups.has(subscriptionKey)) {
      return
    }

    await this.agentStreamHub.subscribeThreadEvents(threadId, subscriptionKey, (batch) => {
      if (!sender.isDestroyed()) {
        sender.send(this.createThreadEventsChannel(threadId), batch)
      }
    })

    const cleanup = () => {
      this.agentStreamHub.unsubscribeThreadEvents(threadId, subscriptionKey)
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
    operation: "invoke" | "resume",
    error: unknown
  ): void {
    const rawThreadId = this.getRawThreadId(rawParams)
    if (error instanceof IpcSchemaValidationError && rawThreadId) {
      void this.agentStreamHub.handlePayload(rawThreadId, {
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
