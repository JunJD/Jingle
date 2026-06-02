import type { AgentThreadEventBatch, AgentThreadSnapshot } from "@shared/agent-thread-runtime"
import type { HITLDecision } from "@shared/hitl"
import type { AgentInvokeMessage } from "@shared/message-content"
import type { PermissionModeName } from "@shared/permission-mode"
import { invokeIpc, ipcRenderer } from "../ipc"

function getThreadEventsChannel(threadId: string): string {
  return `agent:thread-events:${threadId}`
}

export const agentApi = {
  invoke: (
    threadId: string,
    message: AgentInvokeMessage,
    modelId?: string,
    permissionMode?: PermissionModeName,
    temporaryMode?: boolean
  ): void => {
    ipcRenderer.send("agent:invoke", { threadId, message, modelId, permissionMode, temporaryMode })
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
  getThreadSnapshot: (threadId: string): Promise<AgentThreadSnapshot> => {
    return invokeIpc("agent:getThreadSnapshot", { threadId })
  },
  subscribeThreadEvents: (
    threadId: string,
    onBatch: (batch: AgentThreadEventBatch) => void,
    onSnapshot?: (snapshot: AgentThreadSnapshot) => void
  ): (() => void) => {
    const channel = getThreadEventsChannel(threadId)
    let disposed = false
    let didReceiveSnapshot = false
    const pendingBatches: AgentThreadEventBatch[] = []

    const listener = (_event: unknown, batch: AgentThreadEventBatch): void => {
      if (disposed) {
        return
      }

      if (!didReceiveSnapshot) {
        pendingBatches.push(batch)
        return
      }

      onBatch(batch)
    }

    ipcRenderer.on(channel, listener)

    void invokeIpc<AgentThreadSnapshot>("agent:subscribeThreadEvents", { threadId })
      .then((snapshot) => {
        if (disposed) {
          return
        }

        didReceiveSnapshot = true
        onSnapshot?.(snapshot)
        for (const batch of pendingBatches) {
          onBatch(batch)
        }
        pendingBatches.length = 0
      })
      .catch((error) => {
        if (!disposed) {
          console.error("[Agent] Failed to subscribe thread events:", error)
        }
      })

    return () => {
      if (disposed) {
        return
      }

      disposed = true
      ipcRenderer.removeListener(channel, listener)
      void invokeIpc("agent:unsubscribeThreadEvents", { threadId }).catch((error) => {
        console.error("[Agent] Failed to unsubscribe thread events:", error)
      })
    }
  }
}
