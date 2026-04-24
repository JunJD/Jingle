import { BrowserWindow, type IpcMain, type IpcMainEvent } from "electron"
import { AgentService, type AgentStreamSink } from "./service"
import {
  parseAgentCancelParams,
  parseAgentInvokeParams,
  parseAgentResumeParams
} from "./controller-schema"
import { buildIpcErrorEvent } from "../ipc/error"
import { registerIpcHandle } from "../ipc/handle"
import { IpcSchemaValidationError } from "../ipc/schema"
import { startAgentStreamOperation } from "./stream-operation"

export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  register(ipcMain: IpcMain): void {
    console.log("[Agent] Registering agent handlers...")

    ipcMain.on("agent:invoke", (event, rawParams: unknown) => {
      const params = this.parseInvokeParams(event, rawParams)
      if (!params) {
        return
      }

      const sink = this.createStreamSink(event, params.threadId, "invoke")
      if (!sink) {
        return
      }

      startAgentStreamOperation("invoke", sink, this.agentService.invoke(params, sink))
    })

    ipcMain.on("agent:resume", (event, rawParams: unknown) => {
      const params = this.parseResumeParams(event, rawParams)
      if (!params) {
        return
      }

      const sink = this.createStreamSink(event, params.threadId, "resume")
      if (!sink) {
        return
      }

      startAgentStreamOperation("resume", sink, this.agentService.resume(params, sink))
    })

    registerIpcHandle(ipcMain, "agent:cancel", (_event, rawParams: unknown) => {
      return this.agentService.cancel(parseAgentCancelParams(rawParams))
    })
  }

  private parseInvokeParams(event: IpcMainEvent, rawParams: unknown) {
    try {
      return parseAgentInvokeParams(rawParams)
    } catch (error) {
      this.handleStreamValidationError(event, rawParams, "invoke", error)
      return null
    }
  }

  private parseResumeParams(event: IpcMainEvent, rawParams: unknown) {
    try {
      return parseAgentResumeParams(rawParams)
    } catch (error) {
      this.handleStreamValidationError(event, rawParams, "resume", error)
      return null
    }
  }

  private createStreamSink(
    event: IpcMainEvent,
    threadId: string,
    operation: string
  ): AgentStreamSink | null {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) {
      console.error(`[Agent] No window found for ${operation}`)
      return null
    }

    const channel = `agent:stream:${threadId}`

    return {
      onClosed: (listener) => {
        window.once("closed", listener)
        return () => {
          window.removeListener("closed", listener)
        }
      },
      send: (payload) => {
        window.webContents.send(channel, payload)
      }
    }
  }

  private handleStreamValidationError(
    event: IpcMainEvent,
    rawParams: unknown,
    operation: "invoke" | "resume",
    error: unknown
  ): void {
    const rawThreadId = this.getRawThreadId(rawParams)
    if (error instanceof IpcSchemaValidationError) {
      const sink = rawThreadId ? this.createStreamSink(event, rawThreadId, operation) : null
      if (sink) {
        sink.send({
          type: "error",
          ...buildIpcErrorEvent(`agent:${operation}`, error)
        })
        return
      }
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
}
