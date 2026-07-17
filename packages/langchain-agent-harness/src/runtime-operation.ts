import type { BaseMessage, MessageContent } from "@langchain/core/messages"
import type { RunnableConfig } from "@langchain/core/runnables"
import type { RuntimeRunLifecycleSubmittedFacts } from "./runtime-contract"
import type { RuntimeCompaction, RuntimeRecordingRef } from "./runtime-state"

export type RuntimeDurableOperationKind = "invoke" | "resume" | "compact"
export type RuntimeDeferredOperationKind = never
export type RuntimeInternalControlKind = "drain" | "complete" | "fail" | "abort"
export type RuntimeOperationKind =
  | RuntimeDurableOperationKind
  | RuntimeDeferredOperationKind
  | RuntimeInternalControlKind

export interface RuntimeRunContext {
  runId: string
  threadId: string
  workspacePath: string
}

export interface RuntimeOperationBase extends RuntimeRunContext {
  kind: RuntimeDurableOperationKind
}

export type RuntimeRunStreamChunk = [mode: string, data: unknown]

export interface RuntimeSubmittedMessage {
  content: MessageContent
  id: string
  refs?: unknown[]
}

type RuntimeToolApprovalDecisionScope = {
  request_id: string
  tool_call_id?: string | null
}
export type RuntimeToolApprovalDecision = RuntimeToolApprovalDecisionScope &
  ({ type: "approve" } | { type: "user_declined" } | { correction: string; type: "corrected" })

export type RuntimeToolApprovalDecisionType = "approve" | "user_declined" | "corrected"

export interface RuntimeInvokeOperation<TContextInclusion = unknown> extends RuntimeOperationBase {
  contextInclusions: TContextInclusion[]
  kind: "invoke"
  message: RuntimeSubmittedMessage
  removeMessageIds: string[]
  recordingRefs?: RuntimeRecordingRefsInput
  title?: string | null
}

export interface RuntimeResumeOperation<TContextInclusion = unknown> extends RuntimeOperationBase {
  contextInclusions?: TContextInclusion[]
  decision: RuntimeToolApprovalDecision
  kind: "resume"
  recordingRefs?: RuntimeRecordingRefsInput
}

export interface RuntimeDrainOperation<
  TChunk extends RuntimeRunStreamChunk
> extends RuntimeRunContext {
  kind: "drain"
  onChunk: (chunk: TChunk) => Promise<void> | void
  signal: AbortSignal
  stream: AsyncIterable<TChunk>
}

export interface RuntimeCompleteOperation<TContextInclusion = unknown>
  extends RuntimeRunContext, RuntimeRunLifecycleSubmittedFacts<TContextInclusion> {
  expectedMessageId?: string
  interrupted: boolean
  kind: "complete"
}

export interface RuntimeAbortOperation extends RuntimeRunContext {
  kind: "abort"
}

export interface RuntimeFailOperation extends RuntimeRunContext {
  error: unknown
  kind: "fail"
}

export type RuntimeCompactTrigger = "pre-run" | "post-run" | "manual" | (string & {})

export interface RuntimeCompactInput {
  modelId: string
  operationId: string
  preserveLastUserMessageCount?: number
  reason?: string | null
  trigger: "manual"
}

export function parseRuntimeCompactInput(input: unknown): Readonly<RuntimeCompactInput> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("[RuntimeCompact] input must be an object.")
  }
  if (Object.getPrototypeOf(input) !== Object.prototype) {
    throw new Error("[RuntimeCompact] input must be a plain object.")
  }

  const snapshot = readRuntimeCompactDataProperties(input)
  const operationId = readNormalizedCompactIdentifier(snapshot.get("operationId"), "operationId")
  const modelId = readNormalizedCompactIdentifier(snapshot.get("modelId"), "modelId")
  if (snapshot.get("trigger") !== "manual") {
    throw new Error('[RuntimeCompact] trigger must be "manual".')
  }
  const reason = snapshot.get("reason")
  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    throw new Error("[RuntimeCompact] reason must be a string, null, or undefined.")
  }
  const preserveLastUserMessageCount = snapshot.get("preserveLastUserMessageCount")
  if (
    preserveLastUserMessageCount !== undefined &&
    (!Number.isSafeInteger(preserveLastUserMessageCount) ||
      (preserveLastUserMessageCount as number) < 0)
  ) {
    throw new Error(
      "[RuntimeCompact] preserveLastUserMessageCount must be a non-negative safe integer or undefined."
    )
  }

  const canonical: RuntimeCompactInput = {
    modelId,
    operationId,
    reason: (reason ?? null) as string | null,
    trigger: "manual"
  }
  if (snapshot.has("preserveLastUserMessageCount")) {
    canonical.preserveLastUserMessageCount = preserveLastUserMessageCount as number | undefined
  }
  return Object.freeze(canonical)
}

function readRuntimeCompactDataProperties(input: object): ReadonlyMap<PropertyKey, unknown> {
  const snapshot = new Map<PropertyKey, unknown>()
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor || !("value" in descriptor)) {
      throw new Error("[RuntimeCompact] input must contain data properties only.")
    }
    snapshot.set(key, descriptor.value)
  }
  return snapshot
}

function readNormalizedCompactIdentifier(value: unknown, field: "modelId" | "operationId"): string {
  if (typeof value !== "string") {
    throw new Error(`[RuntimeCompact] ${field} must be a non-empty string.`)
  }
  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new Error(`[RuntimeCompact] ${field} must be a non-empty string.`)
  }
  return normalized
}

export interface RuntimeCompactOperation extends RuntimeRunContext, RuntimeCompactInput {
  kind: "compact"
}

export interface RuntimeCompactResult {
  checkpointConfig: RunnableConfig
  compaction: RuntimeCompaction
  messageCountAfterCompaction: number
  messageCountBeforeCompaction: number
}

export type RuntimeDurableOperation<TContextInclusion = unknown> =
  | RuntimeInvokeOperation<TContextInclusion>
  | RuntimeResumeOperation<TContextInclusion>
  | RuntimeCompactOperation

// RuntimeGraph still consumes these internal controls from config. They are execution protocol
// messages, not durable RuntimeOperation facts or public RuntimeThread commands.
export type RuntimeOperation<
  TContextInclusion = unknown,
  TChunk extends RuntimeRunStreamChunk = RuntimeRunStreamChunk
> =
  | RuntimeDurableOperation<TContextInclusion>
  | RuntimeDrainOperation<TChunk>
  | RuntimeCompleteOperation<TContextInclusion>
  | RuntimeAbortOperation
  | RuntimeFailOperation

export interface RuntimeOperationCheckpointBoundary {
  compactRunsInsideModelToolLoop: false
  postRunCompactAfterRunCommit: true
  preRunCompactBeforeContextActivation: true
  stableCheckpointRequired: true
}

// Compact is a RuntimeThread control operation outside RuntimeGraph's model/tool loop.
export const RUNTIME_OPERATION_CHECKPOINT_BOUNDARY = {
  compactRunsInsideModelToolLoop: false,
  postRunCompactAfterRunCommit: true,
  preRunCompactBeforeContextActivation: true,
  stableCheckpointRequired: true
} as const satisfies RuntimeOperationCheckpointBoundary

type RuntimeRecordingRefsInput = RuntimeRecordingRef[]

export interface RuntimeInvokeInitialState<TContextInclusion = unknown> {
  contextInclusions: TContextInclusion[]
  messages: BaseMessage[]
  recordingRefs?: RuntimeRecordingRefsInput
  title?: string
}
