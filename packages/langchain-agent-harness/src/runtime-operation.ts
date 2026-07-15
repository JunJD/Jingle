import type { BaseMessage, MessageContent } from "@langchain/core/messages"
import type { RunnableConfig } from "@langchain/core/runnables"
import type { RuntimeRunLifecycleSubmittedFacts } from "./runtime-contract"
import type { RuntimeCompaction, RuntimeRecordingRef } from "./runtime-state"
import { RUNTIME_CHILD_WORK_BOUNDARY, type RuntimeChildWorkCapability } from "./runtime-child-work"
import { RUNTIME_SHELL_BOUNDARY, type RuntimeShellCapability } from "./runtime-shell"

export type RuntimeDurableOperationKind = "invoke" | "resume"
export type RuntimeDeferredOperationKind = "compact"
export type RuntimeInternalControlKind = "drain" | "complete" | "fail" | "abort"
export type RuntimeOperationKind =
  | RuntimeDurableOperationKind
  | RuntimeDeferredOperationKind
  | RuntimeInternalControlKind

export type RuntimeDeferredOperationCapability =
  | "compact"
  | RuntimeChildWorkCapability
  | RuntimeShellCapability

export interface RuntimeOperationSurfaceContract {
  durable: readonly RuntimeDurableOperationKind[]
  entries: readonly RuntimeOperationEntryContract[]
  internal: readonly RuntimeInternalControlKind[]
  deferred: readonly RuntimeDeferredOperationCapability[]
  toolApprovalEntry: "resume"
}

export type RuntimeOperationEntryId =
  | RuntimeOperationKind
  | RuntimeDeferredOperationCapability
  | "toolApproval"

export type RuntimeOperationEntryStatus =
  | "deferred-capability"
  | "implemented-operation"
  | "internal-control"
  | "resume-mediated"

export interface RuntimeOperationEntryContract {
  checkpointBoundary: "external" | "langgraph-state-update" | "stable-checkpoint"
  graphLoop: "outside-model-tool-loop" | "inside-model-tool-loop" | "stream-consumer"
  id: RuntimeOperationEntryId
  operationKind: RuntimeOperationKind | "not-introduced"
  owner: string
  status: RuntimeOperationEntryStatus
}

export const RUNTIME_OPERATION_SURFACE = {
  entries: [
    {
      checkpointBoundary: "langgraph-state-update",
      graphLoop: "inside-model-tool-loop",
      id: "invoke",
      operationKind: "invoke",
      owner: "RuntimeThreadOperationControl",
      status: "implemented-operation"
    },
    {
      checkpointBoundary: "langgraph-state-update",
      graphLoop: "inside-model-tool-loop",
      id: "resume",
      operationKind: "resume",
      owner: "RuntimeThreadOperationControl",
      status: "implemented-operation"
    },
    {
      checkpointBoundary: "langgraph-state-update",
      graphLoop: "inside-model-tool-loop",
      id: "toolApproval",
      operationKind: "resume",
      owner: "RuntimeApproval",
      status: "resume-mediated"
    },
    {
      checkpointBoundary: "stable-checkpoint",
      graphLoop: "outside-model-tool-loop",
      id: "compact",
      operationKind: "not-introduced",
      owner: "RuntimeThreadOperationControl",
      status: "deferred-capability"
    },
    {
      checkpointBoundary: "external",
      graphLoop: "stream-consumer",
      id: "drain",
      operationKind: "drain",
      owner: "RuntimeThreadStreamControl",
      status: "internal-control"
    },
    {
      checkpointBoundary: "stable-checkpoint",
      graphLoop: "outside-model-tool-loop",
      id: "complete",
      operationKind: "complete",
      owner: "RuntimeThreadRunLifecycleControl",
      status: "internal-control"
    },
    {
      checkpointBoundary: "external",
      graphLoop: "outside-model-tool-loop",
      id: "fail",
      operationKind: "fail",
      owner: "RuntimeThreadRunLifecycleControl",
      status: "internal-control"
    },
    {
      checkpointBoundary: "external",
      graphLoop: "outside-model-tool-loop",
      id: "abort",
      operationKind: "abort",
      owner: "RuntimeThreadRunLifecycleControl",
      status: "internal-control"
    },
    {
      checkpointBoundary: "stable-checkpoint",
      graphLoop: "outside-model-tool-loop",
      id: "task",
      operationKind: "not-introduced",
      owner: "RuntimeChildWork",
      status: "deferred-capability"
    },
    {
      checkpointBoundary: "stable-checkpoint",
      graphLoop: "outside-model-tool-loop",
      id: "subAgent",
      operationKind: "not-introduced",
      owner: "RuntimeChildWork",
      status: "deferred-capability"
    },
    {
      checkpointBoundary: "external",
      graphLoop: "inside-model-tool-loop",
      id: "shell",
      operationKind: "not-introduced",
      owner: "RuntimeShell",
      status: "deferred-capability"
    }
  ],
  durable: ["invoke", "resume"],
  internal: ["drain", "complete", "fail", "abort"],
  deferred: [
    "compact",
    ...RUNTIME_CHILD_WORK_BOUNDARY.capabilities,
    RUNTIME_SHELL_BOUNDARY.capability
  ],
  toolApprovalEntry: "resume"
} as const satisfies RuntimeOperationSurfaceContract

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

export interface RuntimeToolApprovalDecision {
  feedback?: string | null
  request_id: string
  tool_call_id?: string | null
  type: RuntimeToolApprovalDecisionType
}

export type RuntimeToolApprovalDecisionType = "approve" | "reject"

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
  beforePendingHitlPersistence?: () => Promise<void> | void
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
  preserveLastUserMessageCount?: number
  reason?: string | null
  trigger: RuntimeCompactTrigger
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
  | RuntimeCompactOperation

export interface RuntimeOperationCheckpointBoundary {
  compactRunsInsideModelToolLoop: false
  postRunCompactAfterRunCommit: true
  preRunCompactBeforeContextActivation: true
  stableCheckpointRequired: true
}

// Compact is a RuntimeThread control operation. RuntimeGraph may execute a compact branch,
// but compact is not a generic hook and does not run inside every model/tool loop.
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
