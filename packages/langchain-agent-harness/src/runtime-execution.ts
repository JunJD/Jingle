import type { RunnableConfig } from "@langchain/core/runnables"
import type {
  RuntimeCompactInput,
  RuntimeCompactResult,
  RuntimeRunExecutionOptions
} from "./runtime-operation"

export interface RuntimeRunExecutionInput extends RuntimeRunExecutionOptions {
  runId: string
}

export type RuntimeRunStream<TChunk = unknown> = Promise<AsyncIterable<TChunk>>

export interface RuntimeRunExecution {
  compact(input: RuntimeCompactInput): Promise<RuntimeCompactResult>
  streamInvoke<TInput>(input: TInput, options: RuntimeRunStreamOptions): RuntimeRunStream
  streamResume<TInput>(input: TInput, options: RuntimeRunStreamOptions): RuntimeRunStream
}

export interface RuntimeRunStreamOptions {
  signal: AbortSignal
}

export interface RuntimeGraphEngine {
  getState<TValues = Record<string, unknown>>(
    config?: RunnableConfig,
    options?: unknown
  ): Promise<{ values: TValues }>
  invoke<TInput = unknown, TOutput = unknown>(
    state: TInput,
    config?: RunnableConfig
  ): Promise<TOutput>
  stream<TInput = unknown, TChunk = unknown>(
    state: TInput,
    config?: RunnableConfig
  ): Promise<AsyncIterable<TChunk>>
  updateState<TValues = Record<string, unknown>>(
    inputConfig: RunnableConfig,
    values: TValues,
    asNode?: string
  ): Promise<RunnableConfig>
}
