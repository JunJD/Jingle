import type { JingleLangChainTraceEvent } from "./langchain-trace-callback"
import type { JingleAgentRunTraceConfig } from "./run-config"
import type { RuntimeRunContextScope } from "./runtime-scope"

export const RUNTIME_PROJECTION_KINDS = ["title", "memory-recording"] as const
export type RuntimeProjectionKind = (typeof RUNTIME_PROJECTION_KINDS)[number]

export interface RuntimeProjectionFailure {
  error: unknown
  projection: RuntimeProjectionKind
}

export interface RuntimeProjectionFailureRecordInput
  extends RuntimeRunContextScope, RuntimeProjectionFailure {}

export type RuntimeProjectionFailureObserver = (failure: RuntimeProjectionFailure) => void

export interface RuntimeProjectionSinkContract {
  recordFailure(input: RuntimeProjectionFailureRecordInput): Promise<void> | void
}

export interface RuntimeTraceRecordInput extends RuntimeRunContextScope {
  event: JingleLangChainTraceEvent
}

export interface RuntimeTraceConfigInput extends RuntimeRunContextScope {
  modelId?: string
}

export interface RuntimeRunTraceConfigInput extends RuntimeTraceConfigInput {
  source: "invoke" | "resume"
}

export interface RuntimeTraceSinkContract {
  createRunConfig?: (input: RuntimeRunTraceConfigInput) => JingleAgentRunTraceConfig
  createRuntimeConfig?: (input: RuntimeTraceConfigInput) => JingleAgentRunTraceConfig
  recordEvent(input: RuntimeTraceRecordInput): Promise<void>
  skippedRunNames?: ReadonlySet<string>
}

export interface RuntimeObservationSinkContract {
  projection?: RuntimeProjectionSinkContract
  trace?: RuntimeTraceSinkContract
}

export interface RuntimeObservationCapabilities {
  projection?: RuntimeProjectionSinkContract
  trace?: RuntimeTraceSinkContract
}

export type RuntimeObservationSink = RuntimeObservationSinkContract
export type RuntimeProjectionSink = RuntimeProjectionSinkContract
export type RuntimeTraceSink = RuntimeTraceSinkContract

export function createRuntimeObservationSink(
  input: RuntimeObservationCapabilities | undefined
): RuntimeObservationSinkContract | undefined {
  if (!input?.projection && !input?.trace) return undefined

  return {
    ...(input.projection ? { projection: input.projection } : {}),
    ...(input.trace ? { trace: input.trace } : {})
  }
}
