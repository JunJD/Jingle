import { ipcRenderer } from "electron"
import type { IPCEvent } from "../../types"
import type { AgentInvokeMessage } from "../../shared/message-content"
import type { HITLDecision } from "../../shared/app-types"

export const agentApi = {
  invoke: (
    threadId: string,
    message: AgentInvokeMessage,
    onEvent: (event: IPCEvent) => void,
    modelId?: string
  ): (() => void) => {
    const channel = `agent:stream:${threadId}`

    const handler = (_event: unknown, data: IPCEvent): void => {
      onEvent(data)
      if (data.type === "done" || data.type === "error") {
        ipcRenderer.removeListener(channel, handler)
      }
    }

    ipcRenderer.on(channel, handler)
    ipcRenderer.send("agent:invoke", { threadId, message, modelId })

    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
  streamAgent: (
    threadId: string,
    message: AgentInvokeMessage,
    command: unknown,
    onEvent: (event: IPCEvent) => void,
    modelId?: string
  ): (() => void) => {
    const channel = `agent:stream:${threadId}`

    const handler = (_event: unknown, data: IPCEvent): void => {
      onEvent(data)
      if (data.type === "done" || data.type === "error") {
        ipcRenderer.removeListener(channel, handler)
      }
    }

    ipcRenderer.on(channel, handler)

    if (command) {
      ipcRenderer.send("agent:resume", { threadId, command, modelId })
    } else {
      ipcRenderer.send("agent:invoke", { threadId, message, modelId })
    }

    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
  interrupt: (
    threadId: string,
    decision: HITLDecision,
    onEvent?: (event: IPCEvent) => void
  ): (() => void) => {
    const channel = `agent:stream:${threadId}`

    const handler = (_event: unknown, data: IPCEvent): void => {
      onEvent?.(data)
      if (data.type === "done" || data.type === "error") {
        ipcRenderer.removeListener(channel, handler)
      }
    }

    ipcRenderer.on(channel, handler)
    ipcRenderer.send("agent:interrupt", { threadId, decision })

    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
  cancel: (threadId: string): Promise<void> => {
    return ipcRenderer.invoke("agent:cancel", { threadId })
  }
}
