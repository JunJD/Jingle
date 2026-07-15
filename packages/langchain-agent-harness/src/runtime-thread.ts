import type { BaseCallbackHandler } from "@langchain/core/callbacks/base"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeExecutionContext } from "./runtime-execution-context"
import type { AgentRunSteeringBufferPort } from "./run-steering"
import type {
  RuntimePauseControllerContract,
  RuntimeResumeRunStart,
  RuntimeRunLifecycleControllerContract,
  RuntimeRunStart
} from "./runtime-contract"
import type { CompleteJingleAgentRunResult } from "./run-completion"
import type { DrainRuntimeRunStreamResult } from "./run-stream"
import type {
  RuntimeAbortOperation,
  RuntimeCompactInput,
  RuntimeCompactResult,
  RuntimeCompleteOperation,
  RuntimeDrainOperation,
  RuntimeFailOperation,
  RuntimeInvokeOperation,
  RuntimeResumeOperation,
  RuntimeRunStreamChunk
} from "./runtime-operation"
import type { RuntimeRunStream } from "./runtime-execution"
import type { RuntimeExecutionFactory } from "./runtime-execution-factory"
import type { RuntimeThreadScope } from "./runtime-scope"

export interface RuntimeThreadInput {
  threadId: string
  workspacePath: string
}

export type RuntimeThreadRoleId =
  | "capability-to-execution-assembly"
  | "control-surface"
  | "graph-engine-creation"
  | "operation-factory"

export type RuntimeThreadRoleVisibility = "internal" | "public"

export interface RuntimeThreadRoleContract {
  files: readonly string[]
  id: RuntimeThreadRoleId
  owner: string
  surface: readonly string[]
  visibility: RuntimeThreadRoleVisibility
}

export interface RuntimeThreadBoundaryContract {
  publicRole: "control-surface"
  roles: readonly RuntimeThreadRoleContract[]
}

export const RUNTIME_THREAD_BOUNDARY = {
  publicRole: "control-surface",
  roles: [
    {
      files: [
        "src/runtime-thread.ts",
        "src/runtime-thread-implementation.ts",
        "src/runtime-thread-run.ts"
      ],
      id: "control-surface",
      owner: "RuntimeThread",
      surface: [
        "startInvoke",
        "startResume",
        "compact",
        "RuntimeThreadRun.execute",
        "abort",
        "fail"
      ],
      visibility: "public"
    },
    {
      files: ["src/runtime-thread-operations.ts", "src/runtime-operation-payload.ts"],
      id: "operation-factory",
      owner: "RuntimeThreadOperationControl",
      surface: [
        "RuntimeThreadInvokeInput -> RuntimeInvokeOperation payload",
        "RuntimeThreadResumeInput -> RuntimeResumeOperation command",
        "RuntimeThread.compact -> independent Pause 4 boundary"
      ],
      visibility: "internal"
    },
    {
      files: [
        "src/runtime-execution.ts",
        "src/runtime-execution-factory.ts",
        "src/harness-runtime/index.ts"
      ],
      id: "graph-engine-creation",
      owner: "RuntimeExecutionFactory",
      surface: ["createRuntimeGraphEngine", "buildRuntimeInvokeConfig", "buildRuntimeResumeConfig"],
      visibility: "internal"
    },
    {
      files: ["src/runtime-execution-assembly.ts"],
      id: "capability-to-execution-assembly",
      owner: "assembleRuntimeExecution",
      surface: [
        "bound execution capabilities -> RuntimeHostContract",
        "RuntimeHostContract -> current engine middleware"
      ],
      visibility: "internal"
    }
  ]
} as const satisfies RuntimeThreadBoundaryContract

export interface RuntimeThreadBeginInvokeInput<TInvokeRunLifecycleInput = unknown> {
  invoke: TInvokeRunLifecycleInput
}

export interface RuntimeThreadBeginResumeInput<TResumeRunLifecycleInput = unknown> {
  resume: TResumeRunLifecycleInput
}

export interface RuntimeThreadInvokeExecutionBindingInput<TInvokeRunLifecycleInput = unknown> {
  invoke: TInvokeRunLifecycleInput
  start: RuntimeRunStart
  thread: RuntimeThreadScope
}

export interface RuntimeThreadResumeExecutionBindingInput<TResumeRunLifecycleInput = unknown> {
  resume: TResumeRunLifecycleInput
  start: RuntimeResumeRunStart
  thread: RuntimeThreadScope
}

export interface RuntimeThreadExecutionBinder<
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  invoke(
    input: RuntimeThreadInvokeExecutionBindingInput<TInvokeRunLifecycleInput>
  ): RuntimeExecutionFactory
  resume(
    input: RuntimeThreadResumeExecutionBindingInput<TResumeRunLifecycleInput>
  ): RuntimeExecutionFactory
}

export interface RuntimeThreadFactoryInput<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  bindExecution: RuntimeThreadExecutionBinder<TInvokeRunLifecycleInput, TResumeRunLifecycleInput>
  pauseController: RuntimePauseControllerContract<TReview>
  runLifecycleController: RuntimeRunLifecycleControllerContract<
    TContextInclusion,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
}

type RuntimeThreadScopedOperationInput<TOperation> = Omit<
  TOperation,
  "kind" | "threadId" | "workspacePath"
>

export type RuntimeThreadInvokeInput<TContextInclusion = unknown> =
  RuntimeThreadScopedOperationInput<RuntimeInvokeOperation<TContextInclusion>>

export type RuntimeThreadResumeInput<TContextInclusion = unknown> =
  RuntimeThreadScopedOperationInput<RuntimeResumeOperation<TContextInclusion>>

export type RuntimeThreadCompleteInput<TContextInclusion = unknown> =
  RuntimeThreadScopedOperationInput<RuntimeCompleteOperation<TContextInclusion>>

export type RuntimeThreadAbortInput = RuntimeThreadScopedOperationInput<RuntimeAbortOperation>

export type RuntimeThreadFailInput = RuntimeThreadScopedOperationInput<RuntimeFailOperation>

export type RuntimeThreadDrainInput<TChunk extends RuntimeRunStreamChunk> =
  RuntimeThreadScopedOperationInput<RuntimeDrainOperation<TChunk>>

export interface RuntimeThreadDrainResult extends DrainRuntimeRunStreamResult {
  beforePendingHitlPersistenceApplied: boolean
}

export interface RuntimeThreadRunExecutionInput {
  callbacks?: readonly BaseCallbackHandler[]
  expectedMessageId?: string
  onChunk: (chunk: RuntimeRunStreamChunk) => Promise<void> | void
  signal: AbortSignal
  steeringBuffer?: AgentRunSteeringBufferPort | null
}

export interface RuntimeThreadOperationOptions<
  TContextInclusion = JingleContextInclusionStateItem
> {
  executionContext: RuntimeExecutionContext<TContextInclusion>
  signal: AbortSignal
}

export type RuntimeThreadInvokeRunExecutionInput<TContextInclusion> = Omit<
  RuntimeThreadInvokeInput<TContextInclusion>,
  "callbacks" | "modelId" | "recordingRefs" | "runId"
> &
  RuntimeThreadRunExecutionInput

export type RuntimeThreadResumeRunExecutionInput<TContextInclusion> = Omit<
  RuntimeThreadResumeInput<TContextInclusion>,
  "callbacks" | "decision" | "modelId" | "recordingRefs" | "runId"
> &
  RuntimeThreadRunExecutionInput & {
    /** Synchronously dispatches observation after the resume decision is durably committed. */
    onDecisionCommitted?: () => void
  }

export type RuntimeThreadRunResult<TContextInclusion> =
  | {
      status: "aborted"
    }
  | {
      completion: CompleteJingleAgentRunResult<TContextInclusion>
      status: "completed"
    }

export interface RuntimeThreadRun {
  readonly runId: string
  /** Returns true only when abort owns the run's terminal outcome. */
  abort(): Promise<boolean>
  /** Returns true only when this failure owns the run's terminal outcome. */
  fail(error: unknown): Promise<boolean>
}

export interface RuntimeThreadInvokeRun<
  TContextInclusion = JingleContextInclusionStateItem
> extends RuntimeThreadRun {
  execute(
    input: RuntimeThreadInvokeRunExecutionInput<TContextInclusion>
  ): Promise<RuntimeThreadRunResult<TContextInclusion>>
}

export interface RuntimeThreadResumeRun<
  TContextInclusion = JingleContextInclusionStateItem
> extends RuntimeThreadRun {
  execute(
    input: RuntimeThreadResumeRunExecutionInput<TContextInclusion>
  ): Promise<RuntimeThreadRunResult<TContextInclusion>>
}

export interface RuntimeThread<
  TContextInclusion = JingleContextInclusionStateItem,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  compact(input: RuntimeCompactInput): Promise<RuntimeCompactResult>
  startInvoke(input: TInvokeRunLifecycleInput): Promise<RuntimeThreadInvokeRun<TContextInclusion>>
  startResume(
    input: TResumeRunLifecycleInput & { decision: RuntimeResumeOperation["decision"] }
  ): Promise<RuntimeThreadResumeRun<TContextInclusion>>
}

export interface RuntimeThreadRunLifecycleControl<
  TContextInclusion = JingleContextInclusionStateItem,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  abortRun(input: RuntimeThreadAbortInput): Promise<void>
  beginInvokeRun(
    input: RuntimeThreadBeginInvokeInput<TInvokeRunLifecycleInput>
  ): Promise<RuntimeRunStart>
  beginResumeRun(
    input: RuntimeThreadBeginResumeInput<TResumeRunLifecycleInput>
  ): Promise<RuntimeResumeRunStart>
  completeRun(
    input: RuntimeThreadCompleteInput<TContextInclusion>
  ): Promise<CompleteJingleAgentRunResult<TContextInclusion>>
  failRun(input: RuntimeThreadFailInput): Promise<void>
  /** Releases run-scoped runtime ownership after the terminal persistence attempt. */
  settleRun(input: { runId: string }): Promise<void>
}

export interface RuntimeThreadStreamControl {
  drainRunStream<TChunk extends RuntimeRunStreamChunk>(
    input: RuntimeThreadDrainInput<TChunk>
  ): Promise<RuntimeThreadDrainResult>
}

export interface RuntimeThreadOperationControl<
  TContextInclusion = JingleContextInclusionStateItem
> {
  compact(input: RuntimeCompactInput): Promise<RuntimeCompactResult>
  invoke(
    input: RuntimeThreadInvokeInput<TContextInclusion>,
    options: RuntimeThreadOperationOptions<TContextInclusion>
  ): RuntimeRunStream<RuntimeRunStreamChunk>
  resume(
    input: RuntimeThreadResumeInput<TContextInclusion>,
    options: RuntimeThreadOperationOptions<TContextInclusion>
  ): RuntimeRunStream<RuntimeRunStreamChunk>
}
