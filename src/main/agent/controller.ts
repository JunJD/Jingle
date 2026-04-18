import { BrowserWindow, type IpcMain, type IpcMainEvent } from "electron"
import type {
  AgentCancelParams,
  AgentInterruptParams,
  AgentInvokeParams,
  AgentResumeParams
} from "../types"
import { AgentService, type AgentStreamSink } from "./service"

export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  register(ipcMain: IpcMain): void {
    console.log("[Agent] Registering agent handlers...")

    ipcMain.on("agent:invoke", (event, params: AgentInvokeParams) => {
      const sink = this.createStreamSink(event, params.threadId, "invoke")
      if (!sink) {
        return
      }

      void this.agentService.invoke(params, sink)
    })

    ipcMain.on("agent:resume", (event, params: AgentResumeParams) => {
      const sink = this.createStreamSink(event, params.threadId, "resume")
      if (!sink) {
        return
      }

      void this.agentService.resume(params, sink)
    })

    ipcMain.on("agent:interrupt", (event, params: AgentInterruptParams) => {
      const sink = this.createStreamSink(event, params.threadId, "interrupt response")
      if (!sink) {
        return
      }

      void this.agentService.interrupt(params, sink)
    })

    ipcMain.handle("agent:cancel", (_event, params: AgentCancelParams) => {
      return this.agentService.cancel(params)
    })
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
}
