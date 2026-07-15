import type {
  JingleAgentFollowUpAction,
  JingleAgentFollowUpQueueItem,
  JingleAgentSteerResult,
  JingleAgentRuntimeReplayOptions
} from "@jingle/agent-client"
import type { HITLDecision } from "@shared/hitl"
import type { AgentInvokeMessage, ComposerMessageInput } from "@shared/message-content"
import type { PermissionModeName } from "@shared/permission-mode"
import type { AgentThreadEventSubscriptionSurface } from "@shared/agent-thread-contract"
import {
  getAgentCommandLifecycleChannel,
  type AgentCommandLifecycleEvent,
  type AgentCommandOutcome
} from "@shared/agent-command"
import { invokeIpc, ipcRenderer } from "../ipc"
import {
  buildAgentConnectThreadEventsIpcPayload,
  buildAgentDisconnectThreadEventsIpcPayload,
  buildAgentInvokeIpcPayload,
  buildAgentResumeIpcPayload
} from "./agent-payload"
import { createAgentThreadEventsApi } from "./agent-thread-events"

function getThreadEventsChannel(threadId: string): string {
  return `agent:thread-events:${threadId}`
}

const agentThreadEventsApi = createAgentThreadEventsApi({
  connect: (threadId, options) =>
    invokeIpc(
      "agent:connectThreadEvents",
      buildAgentConnectThreadEventsIpcPayload(threadId, options)
    ),
  disconnect: (threadId, subscriptionToken) =>
    invokeIpc(
      "agent:disconnectThreadEvents",
      buildAgentDisconnectThreadEventsIpcPayload(threadId, subscriptionToken)
    ),
  listen: (threadId, listener) => {
    const channel = getThreadEventsChannel(threadId)
    const ipcListener = (_event: unknown, batch: Parameters<typeof listener>[0]): void => {
      listener(batch)
    }
    ipcRenderer.on(channel, ipcListener)
    return () => ipcRenderer.removeListener(channel, ipcListener)
  },
  reportError: (message, error) => {
    console.error(message, error)
  }
})

export const agentApi = {
  observeCommandLifecycle: (
    commandId: string,
    listener: (event: AgentCommandLifecycleEvent) => void
  ): (() => void) => {
    const channel = getAgentCommandLifecycleChannel(commandId)
    const ipcListener = (_event: unknown, lifecycleEvent: AgentCommandLifecycleEvent): void => {
      if (lifecycleEvent.commandId === commandId) {
        listener(lifecycleEvent)
      }
    }
    ipcRenderer.on(channel, ipcListener)
    return () => ipcRenderer.removeListener(channel, ipcListener)
  },
  invoke: (
    threadId: string,
    message: AgentInvokeMessage,
    modelId?: string,
    permissionMode?: PermissionModeName,
    temporaryMode?: boolean,
    followUpAction?: JingleAgentFollowUpAction,
    expectedRunId?: string | null,
    expectedTurnId?: string | null
  ): Promise<AgentCommandOutcome> => {
    return invokeIpc<AgentCommandOutcome>(
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
  ): Promise<AgentCommandOutcome> => {
    return invokeIpc<AgentCommandOutcome>("agent:editLastUserMessageAndInvoke", {
      threadId,
      message,
      modelId,
      permissionMode,
      temporaryMode
    })
  },
  resume: (
    threadId: string,
    decision: HITLDecision,
    modelId?: string
  ): Promise<AgentCommandOutcome> => {
    return invokeIpc<AgentCommandOutcome>(
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
  connectThreadEvents: agentThreadEventsApi.connectThreadEvents,
  replayThreadEvents: (
    threadId: string,
    options: JingleAgentRuntimeReplayOptions & {
      surface?: AgentThreadEventSubscriptionSurface
    } = {}
  ): Promise<void> => {
    return agentThreadEventsApi.replayThreadEvents(threadId, options)
  }
}
