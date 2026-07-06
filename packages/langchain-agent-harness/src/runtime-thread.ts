import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeRunStart } from "./runtime-contract"
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
import type { RuntimeRunStream, RuntimeRunStreamOptions } from "./runtime-execution"

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
      files: ["src/runtime-thread.ts", "src/runtime-thread-implementation.ts"],
      id: "control-surface",
      owner: "RuntimeThread",
      surface: [
        "beginInvokeRun",
        "beginResumeRun",
        "invoke",
        "resume",
        "compact",
        "drainRunStream",
        "completeRun",
        "failRun",
        "abortRun"
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
        "RuntimeThread.compact -> current run compact operation"
      ],
      visibility: "internal"
    },
    {
      files: ["src/runtime-execution-factory.ts", "src/harness-runtime/index.ts"],
      id: "graph-engine-creation",
      owner: "RuntimeExecutionFactory",
      surface: [
        "createRuntimeGraphEngine",
        "buildRuntimeInvokeConfig",
        "buildRuntimeResumeConfig"
      ],
      visibility: "internal"
    },
    {
      files: ["src/runtime-execution-assembly.ts"],
      id: "capability-to-execution-assembly",
      owner: "assembleRuntimeExecution",
      surface: [
        "RuntimeCapabilities -> RuntimeHostContract",
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

export interface RuntimeThread<
  TContextInclusion = JingleContextInclusionStateItem,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> extends RuntimeThreadRunLifecycleControl<
      TContextInclusion,
      TInvokeRunLifecycleInput,
      TResumeRunLifecycleInput
    >,
    RuntimeThreadStreamControl,
    RuntimeThreadOperationControl<TContextInclusion> {}

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
  ): Promise<RuntimeRunStart>
  completeRun(
    input: RuntimeThreadCompleteInput<TContextInclusion>
  ): Promise<CompleteJingleAgentRunResult<TContextInclusion>>
  failRun(input: RuntimeThreadFailInput): Promise<void>
}

export interface RuntimeThreadStreamControl {
  drainRunStream<TChunk extends RuntimeRunStreamChunk>(
    input: RuntimeThreadDrainInput<TChunk>
  ): Promise<RuntimeThreadDrainResult>
}

export interface RuntimeThreadOperationControl<TContextInclusion = JingleContextInclusionStateItem> {
  compact(input: RuntimeCompactInput): Promise<RuntimeCompactResult>
  invoke(
    input: RuntimeThreadInvokeInput<TContextInclusion>,
    options: RuntimeRunStreamOptions
  ): RuntimeRunStream
  resume(
    input: RuntimeThreadResumeInput<TContextInclusion>,
    options: RuntimeRunStreamOptions
  ): RuntimeRunStream
}
