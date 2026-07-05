import type {
  JingleActiveAgentRun,
  JingleAgentFollowUpQueueSummary,
  JingleAgentThreadEvent,
  JingleAgentThreadEventDraft,
  JingleAgentThreadRuntimeState,
  JingleRuntimeStatus,
  JingleTokenUsage
} from "@jingle/agent-client"
import {
  createEmptyJingleAgentFollowUpQueueSummary,
  createJingleAgentThreadRuntimeState
} from "@jingle/agent-client"
import type { AgentContextInclusion } from "./jingle-memory"
import type { HITLDecision, HITLRequest, Message, Todo } from "./app-types"
import type { IpcErrorPayload } from "./ipc-error"

export type AgentThreadEventSubscriptionSurface = "launcher" | "pinned-ai-session"

export type AgentThreadRuntimeState = JingleAgentThreadRuntimeState<
  AgentContextInclusion,
  IpcErrorPayload,
  JingleAgentFollowUpQueueSummary,
  Message,
  HITLRequest,
  JingleActiveAgentRun,
  Todo,
  JingleTokenUsage,
  JingleRuntimeStatus
>

export type AgentThreadEvent = JingleAgentThreadEvent<
  AgentContextInclusion,
  IpcErrorPayload,
  JingleAgentFollowUpQueueSummary,
  Message,
  HITLRequest,
  JingleActiveAgentRun,
  Todo,
  JingleTokenUsage,
  JingleRuntimeStatus,
  HITLDecision
>

export type AgentThreadEventDraft = JingleAgentThreadEventDraft<
  AgentContextInclusion,
  IpcErrorPayload,
  JingleAgentFollowUpQueueSummary,
  Message,
  HITLRequest,
  JingleActiveAgentRun,
  Todo,
  JingleTokenUsage,
  JingleRuntimeStatus,
  HITLDecision
>

export function createDefaultAgentThreadRuntimeState(
  threadId: string
): AgentThreadRuntimeState {
  return createJingleAgentThreadRuntimeState<
    AgentContextInclusion,
    IpcErrorPayload,
    JingleAgentFollowUpQueueSummary,
    Message,
    HITLRequest,
    JingleActiveAgentRun,
    Todo,
    JingleTokenUsage,
    JingleRuntimeStatus
  >({
    followUpQueue: createEmptyJingleAgentFollowUpQueueSummary(),
    status: "idle",
    threadId
  })
}
