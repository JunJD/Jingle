import type { BaseCallbackHandler } from "@langchain/core/callbacks/base"
import type { RunnableConfig } from "@langchain/core/runnables"
import type { AgentRunSteeringBufferPort } from "./run-steering"
import type { RuntimeRunStreamChunk } from "./runtime-operation"

export interface RuntimeRunExecutionInput {
  callbacks?: BaseCallbackHandler[]
  modelId: string
  runId: string
  signal: AbortSignal
  steeringBuffer?: AgentRunSteeringBufferPort | null
}

export type RuntimeRunStream<TChunk = unknown> = Promise<AsyncIterable<TChunk>>

export interface RuntimeRunExecution {
  streamInvoke<TInput>(
    input: TInput,
    options: RuntimeRunStreamOptions
  ): RuntimeRunStream<RuntimeRunStreamChunk>
  streamResume<TInput>(
    input: TInput,
    options: RuntimeRunStreamOptions
  ): RuntimeRunStream<RuntimeRunStreamChunk>
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
