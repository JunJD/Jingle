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

export type AgentThreadEventSubscriptionToken = string

export interface AgentConnectThreadEventsResult {
  subscriptionToken: AgentThreadEventSubscriptionToken
}

export function parseAgentConnectThreadEventsResult(
  value: unknown
): AgentConnectThreadEventsResult {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1
  ) {
    throw new Error("Agent thread event subscription result is invalid.")
  }

  const subscriptionToken = (value as Record<string, unknown>).subscriptionToken
  if (
    typeof subscriptionToken !== "string" ||
    subscriptionToken.length === 0 ||
    subscriptionToken.trim() !== subscriptionToken
  ) {
    throw new Error("Agent thread event subscription token is invalid.")
  }

  return Object.freeze({ subscriptionToken })
}

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

export function createDefaultAgentThreadRuntimeState(threadId: string): AgentThreadRuntimeState {
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
