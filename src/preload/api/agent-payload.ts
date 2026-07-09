import type {
  JingleAgentFollowUpAction,
  JingleAgentRuntimeReplayOptions
} from "@jingle/agent-client"
import type { HITLDecision } from "@shared/hitl"
import type { AgentInvokeMessage } from "@shared/message-content"
import type { PermissionModeName } from "@shared/permission-mode"
import type { AgentThreadEventSubscriptionSurface } from "@shared/agent-thread-contract"

export interface AgentInvokeIpcPayload {
  readonly expectedRunId?: string | null
  readonly expectedTurnId?: string | null
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

function assignOptionalProperties<TResult extends object>(
  base: object,
  optionals: ReadonlyArray<readonly [key: string, value: unknown]>
): TResult {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of optionals) {
    if (value !== undefined) {
      result[key] = value
    }
  }

  return result as TResult
}

export function buildAgentInvokeIpcPayload(input: {
  readonly expectedRunId?: string | null
  readonly expectedTurnId?: string | null
  readonly followUpAction?: JingleAgentFollowUpAction
  readonly message: AgentInvokeMessage
  readonly modelId?: string
  readonly permissionMode?: PermissionModeName
  readonly temporaryMode?: boolean
  readonly threadId: string
}): AgentInvokeIpcPayload {
  return assignOptionalProperties<AgentInvokeIpcPayload>(
    {
      message: input.message,
      threadId: input.threadId
    },
    [
      ["modelId", input.modelId],
      ["permissionMode", input.permissionMode],
      ["temporaryMode", input.temporaryMode],
      ["followUpAction", input.followUpAction],
      ["expectedRunId", input.expectedRunId],
      ["expectedTurnId", input.expectedTurnId]
    ]
  )
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
