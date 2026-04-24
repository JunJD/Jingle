import type { AgentProjectionEnvelope } from "@shared/agent-projection"
import type { HITLDecision } from "@shared/hitl"
import type { AgentInvokeMessage } from "@shared/message-content"
import { invokeIpc, ipcRenderer } from "../ipc"

function getProjectionChannel(threadId: string): string {
  return `agent:projection:${threadId}`
}

export const agentApi = {
  invoke: (threadId: string, message: AgentInvokeMessage, modelId?: string): void => {
    ipcRenderer.send("agent:invoke", { threadId, message, modelId })
  },
  resume: (threadId: string, decision: HITLDecision, modelId?: string): void => {
    ipcRenderer.send("agent:resume", {
      threadId,
      command: {
        resume: decision
      },
      modelId
    })
  },
  cancel: (threadId: string): Promise<void> => {
    return invokeIpc("agent:cancel", { threadId })
  },
  getProjection: (threadId: string): Promise<AgentProjectionEnvelope> => {
    return invokeIpc("agent:getProjection", { threadId })
  },
  subscribeProjection: (
    threadId: string,
    onEnvelope: (envelope: AgentProjectionEnvelope) => void
  ): (() => void) => {
    const channel = getProjectionChannel(threadId)
    let disposed = false

    const listener = (_event: unknown, envelope: AgentProjectionEnvelope): void => {
      if (!disposed) {
        onEnvelope(envelope)
      }
    }

    ipcRenderer.on(channel, listener)

    void invokeIpc<AgentProjectionEnvelope>("agent:subscribeProjection", { threadId })
      .then((envelope) => {
        if (!disposed) {
          onEnvelope(envelope)
        }
      })
      .catch((error) => {
        if (!disposed) {
          console.error("[Agent] Failed to subscribe projection:", error)
        }
      })

    return () => {
      if (disposed) {
        return
      }

      disposed = true
      ipcRenderer.removeListener(channel, listener)
      void invokeIpc("agent:unsubscribeProjection", { threadId }).catch((error) => {
        console.error("[Agent] Failed to unsubscribe projection:", error)
      })
    }
  }
}
