import type { AgentThreadEvent } from "@shared/agent-thread-contract"
import type {
  JingleAgentFollowUpAction,
  JingleAgentFollowUpQueueItem,
  JingleAgentSteerResult,
  JingleAgentRuntimeReplayOptions,
  JingleAgentRuntimeSubscription,
  JingleRuntimeEventBatch
} from "@jingle/agent-client"
import type { HITLDecision } from "@shared/hitl"
import type { AgentInvokeMessage, ComposerMessageInput } from "@shared/message-content"
import type { PermissionModeName } from "@shared/permission-mode"
import type { AgentThreadEventSubscriptionSurface } from "@shared/agent-thread-contract"
import { invokeIpc, ipcRenderer } from "../ipc"
import {
  buildAgentConnectThreadEventsIpcPayload,
  buildAgentInvokeIpcPayload,
  buildAgentResumeIpcPayload
} from "./agent-payload"

function getThreadEventsChannel(threadId: string): string {
  return `agent:thread-events:${threadId}`
}

export const agentApi = {
  invoke: (
    threadId: string,
    message: AgentInvokeMessage,
    modelId?: string,
    permissionMode?: PermissionModeName,
    temporaryMode?: boolean,
    followUpAction?: JingleAgentFollowUpAction,
    expectedRunId?: string | null,
    expectedTurnId?: string | null
  ): void => {
    ipcRenderer.send(
      "agent:invoke",
      buildAgentInvokeIpcPayload({
        expectedRunId,
        threadId,
        message,
        modelId,
        permissionMode,
        temporaryMode,
        followUpAction,
        expectedTurnId
      })
    )
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
    ipcRenderer.send(
      "agent:resume",
      buildAgentResumeIpcPayload({
        threadId,
        decision,
        modelId
      })
    )
  },
  cancel: (threadId: string): Promise<void> => {
    return invokeIpc("agent:cancel", { threadId })
  },
  enqueueFollowUp: (
    threadId: string,
    messageInput: ComposerMessageInput
  ): Promise<JingleAgentFollowUpQueueItem> => {
    return invokeIpc("agent:enqueueFollowUp", { messageInput, threadId })
  },
  removeFollowUp: (threadId: string, requestId: string): Promise<void> => {
    return invokeIpc("agent:removeFollowUp", { requestId, threadId })
  },
  restoreFollowUp: (threadId: string, item: JingleAgentFollowUpQueueItem): Promise<void> => {
    return invokeIpc("agent:restoreFollowUp", { item, threadId })
  },
  takeFollowUp: (
    threadId: string,
    requestId: string
  ): Promise<JingleAgentFollowUpQueueItem | null> => {
    return invokeIpc("agent:takeFollowUp", { requestId, threadId })
  },
  steerFollowUp: (
    threadId: string,
    requestId: string,
    expectedRunId?: string | null,
    expectedTurnId?: string | null
  ): Promise<JingleAgentSteerResult> => {
    const payload = {
      ...(expectedRunId !== undefined ? { expectedRunId } : {}),
      ...(expectedTurnId !== undefined ? { expectedTurnId } : {}),
      requestId,
      threadId
    }
    return invokeIpc("agent:steerFollowUp", payload)
  },
  connectThreadEvents: (
    threadId: string,
    onBatch: (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void,
    options: JingleAgentRuntimeReplayOptions & {
      surface?: AgentThreadEventSubscriptionSurface
    } = {}
  ): JingleAgentRuntimeSubscription => {
    const channel = getThreadEventsChannel(threadId)
    let disposed = false

    const listener = (_event: unknown, batch: JingleRuntimeEventBatch<AgentThreadEvent>): void => {
      if (disposed) {
        return
      }

      onBatch(batch)
    }

    ipcRenderer.on(channel, listener)

    const ready: Promise<void> = invokeIpc(
      "agent:connectThreadEvents",
      buildAgentConnectThreadEventsIpcPayload(threadId, options)
    )
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
    }) as JingleAgentRuntimeSubscription

    cleanup.ready = ready
    return cleanup
  },
  replayThreadEvents: (
    threadId: string,
    options: JingleAgentRuntimeReplayOptions & {
      surface?: AgentThreadEventSubscriptionSurface
    } = {}
  ): Promise<void> => {
    return invokeIpc(
      "agent:connectThreadEvents",
      buildAgentConnectThreadEventsIpcPayload(threadId, options)
    ).then(() => undefined)
  }
}
