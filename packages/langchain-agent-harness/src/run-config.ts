export type RuntimeRunStreamMode = "messages" | "values"

export interface JingleAgentRunTraceConfig {
  metadata?: Record<string, unknown>
  runName?: string
  tags?: string[]
}

export interface BuildRuntimeInvokeConfigInput {
  runId: string
  signal: AbortSignal
  threadId: string
  traceConfig: JingleAgentRunTraceConfig
  workspacePath: string
}

export interface BuildRuntimeResumeConfigInput extends BuildRuntimeInvokeConfigInput {
  runId: string
}

export interface BuildJingleCheckpointLookupConfigInput {
  checkpointRunId?: string | null
  threadId: string
}

type RuntimeOperationConfigKind = "invoke" | "resume"

const RUNTIME_RUN_STREAM_MODE = ["messages", "values"] as RuntimeRunStreamMode[]
const RUNTIME_RUN_RECURSION_LIMIT = 1000

function buildRuntimeRunMetadata(input: {
  operationKind: RuntimeOperationConfigKind
  runId: string
  threadId: string
  workspacePath: string
}): Record<string, string> {
  return {
    run_id: input.runId,
    runtime_operation_kind: input.operationKind,
    thread_id: input.threadId,
    workspace_path: input.workspacePath
  }
}

export function buildRuntimeInvokeConfig(input: BuildRuntimeInvokeConfigInput) {
  const runtimeMetadata = buildRuntimeRunMetadata({
    ...input,
    operationKind: "invoke"
  })

  return {
    configurable: {
      ...runtimeMetadata
    },
    ...input.traceConfig,
    metadata: {
      ...(input.traceConfig.metadata ?? {}),
      ...runtimeMetadata
    },
    signal: input.signal,
    streamMode: [...RUNTIME_RUN_STREAM_MODE],
    recursionLimit: RUNTIME_RUN_RECURSION_LIMIT
  }
}

export function buildRuntimeResumeConfig(input: BuildRuntimeResumeConfigInput) {
  const runtimeMetadata = buildRuntimeRunMetadata({
    ...input,
    operationKind: "resume"
  })

  return {
    configurable: {
      ...runtimeMetadata
    },
    ...input.traceConfig,
    metadata: {
      ...(input.traceConfig.metadata ?? {}),
      ...runtimeMetadata
    },
    signal: input.signal,
    streamMode: [...RUNTIME_RUN_STREAM_MODE],
    recursionLimit: RUNTIME_RUN_RECURSION_LIMIT
  }
}

export function buildJingleCheckpointLookupConfig(input: BuildJingleCheckpointLookupConfigInput) {
  return {
    configurable: {
      thread_id: input.threadId,
      ...(input.checkpointRunId ? { checkpoint_run_id: input.checkpointRunId } : {})
    }
  }
}
