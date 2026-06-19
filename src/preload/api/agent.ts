import type { AgentThreadEventBatch, AgentThreadReplayOptions } from "@shared/agent-thread-runtime"
import type { HITLDecision } from "@shared/hitl"
import type { AgentInvokeMessage } from "@shared/message-content"
import type { PermissionModeName } from "@shared/permission-mode"
import { invokeIpc, ipcRenderer } from "../ipc"

function getThreadEventsChannel(threadId: string): string {
  return `agent:thread-events:${threadId}`
}

export interface AgentThreadEventSubscription {
  (): void
  ready: Promise<void>
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
  editLastUserMessageAndInvoke: (
    threadId: string,
    message: AgentInvokeMessage,
    modelId?: string,
    permissionMode?: PermissionModeName,
    temporaryMode?: boolean
  ): void => {
    ipcRenderer.send("agent:editLastUserMessageAndInvoke", {
      threadId,
      message,
      modelId,
      permissionMode,
      temporaryMode
    })
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
  connectThreadEvents: (
    threadId: string,
    onBatch: (batch: AgentThreadEventBatch) => void,
    options: AgentThreadReplayOptions = {}
  ): AgentThreadEventSubscription => {
    const channel = getThreadEventsChannel(threadId)
    let disposed = false

    const listener = (_event: unknown, batch: AgentThreadEventBatch): void => {
      if (disposed) {
        return
      }

      onBatch(batch)
    }

    ipcRenderer.on(channel, listener)

    const ready: Promise<void> = invokeIpc("agent:connectThreadEvents", { ...options, threadId })
      .then(() => undefined)
      .catch((error) => {
        if (!disposed) {
          console.error("[Agent] Failed to subscribe thread events:", error)
        }
        throw error
      })
    ready.catch(() => {})

    const cleanup = (() => {
      if (disposed) {
        return
      }

      disposed = true
      ipcRenderer.removeListener(channel, listener)
      void invokeIpc("agent:disconnectThreadEvents", { threadId }).catch((error) => {
        console.error("[Agent] Failed to unsubscribe thread events:", error)
      })
    }) as AgentThreadEventSubscription

    cleanup.ready = ready
    return cleanup
  },
  replayThreadEvents: (threadId: string, options: AgentThreadReplayOptions = {}): Promise<void> => {
    return invokeIpc("agent:connectThreadEvents", { ...options, threadId }).then(() => undefined)
  }
}
