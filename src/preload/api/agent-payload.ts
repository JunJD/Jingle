import type {
  JingleAgentFollowUpAction,
  JingleAgentRuntimeReplayOptions
} from "@jingle/agent-client"
import type { HITLDecision } from "@shared/hitl"
import type { AgentInvokeMessage } from "@shared/message-content"
import type { PermissionModeName } from "@shared/permission-mode"
import type { AgentThreadEventSubscriptionSurface } from "@shared/agent-thread-contract"

export interface AgentInvokeIpcPayload {
  readonly followUpAction?: JingleAgentFollowUpAction
  readonly message: AgentInvokeMessage
  readonly modelId?: string
  readonly permissionMode?: PermissionModeName
  readonly temporaryMode?: boolean
  readonly threadId: string
}

export interface AgentResumeIpcPayload {
  readonly decision: HITLDecision
  readonly modelId?: string
  readonly threadId: string
}

export interface AgentConnectThreadEventsIpcPayload extends JingleAgentRuntimeReplayOptions {
  readonly surface?: AgentThreadEventSubscriptionSurface
  readonly threadId: string
}

function withOptionalProperty<TObject extends object, TKey extends string, TValue>(
  object: TObject,
  key: TKey,
  value: TValue | undefined
): TObject & Partial<Record<TKey, TValue>> {
  if (value === undefined) {
    return object
  }

  return {
    ...object,
    [key]: value
  }
}

export function buildAgentInvokeIpcPayload(input: {
  readonly followUpAction?: JingleAgentFollowUpAction
  readonly message: AgentInvokeMessage
  readonly modelId?: string
  readonly permissionMode?: PermissionModeName
  readonly temporaryMode?: boolean
  readonly threadId: string
}): AgentInvokeIpcPayload {
  const withModelId = withOptionalProperty(
    {
      message: input.message,
      threadId: input.threadId
    },
    "modelId",
    input.modelId
  )
  const withPermissionMode = withOptionalProperty(
    withModelId,
    "permissionMode",
    input.permissionMode
  )
  const withTemporaryMode = withOptionalProperty(
    withPermissionMode,
    "temporaryMode",
    input.temporaryMode
  )

  return withOptionalProperty(withTemporaryMode, "followUpAction", input.followUpAction)
}

export function buildAgentResumeIpcPayload(input: {
  readonly decision: HITLDecision
  readonly modelId?: string
  readonly threadId: string
}): AgentResumeIpcPayload {
  return withOptionalProperty(
    {
      decision: input.decision,
      threadId: input.threadId
    },
    "modelId",
    input.modelId
  )
}

export function buildAgentConnectThreadEventsIpcPayload(
  threadId: string,
  options: JingleAgentRuntimeReplayOptions & {
    readonly surface?: AgentThreadEventSubscriptionSurface
  }
): AgentConnectThreadEventsIpcPayload {
  const withSurface = withOptionalProperty(
    {
      threadId
    },
    "surface",
    options.surface
  )

  return withOptionalProperty(
    withSurface,
    "fromRevision",
    options.fromRevision
  )
}
