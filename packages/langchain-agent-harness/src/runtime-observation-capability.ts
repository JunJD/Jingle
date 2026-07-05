import type { BaseCallbackHandler } from "@langchain/core/callbacks/base"
import {
  createJingleLangChainTraceCallback,
  type JingleLangChainTraceEvent
} from "./langchain-trace-callback"
import type { JingleAgentRunTraceConfig } from "./run-config"
import type {
  RuntimeObservationHostContract,
  RuntimeRunContextScope,
  RuntimeTraceSinkContract
} from "./runtime-contract"

export interface RuntimeObservationRunConfigInput {
  source: "invoke" | "resume"
}

export interface RuntimeObservationExecution {
  callbacks: BaseCallbackHandler[]
  createRunTraceConfig(input: RuntimeObservationRunConfigInput): JingleAgentRunTraceConfig
  runtimeTraceConfig: JingleAgentRunTraceConfig
}

export interface CreateRuntimeObservationExecutionInput {
  modelId?: string
  observation: RuntimeObservationHostContract
  runContext: RuntimeRunContextScope
}

export function createRuntimeObservationExecution(
  input: CreateRuntimeObservationExecutionInput
): RuntimeObservationExecution {
  const trace = input.observation.sink?.trace

  return {
    callbacks: createRuntimeTraceCallbacks({
      modelId: input.modelId,
      runContext: input.runContext,
      trace
    }),
    createRunTraceConfig: ({ source }) =>
      createRuntimeRunTraceConfig({
        modelId: input.modelId,
        runContext: input.runContext,
        source,
        trace
      }),
    runtimeTraceConfig: createRuntimeTraceConfig({
      modelId: input.modelId,
      runContext: input.runContext,
      trace
    })
  }
}

function createRuntimeTraceCallbacks(input: {
  modelId?: string
  runContext: RuntimeRunContextScope
  trace?: RuntimeTraceSinkContract
}): BaseCallbackHandler[] {
  if (!input.trace) return []

  const trace = input.trace
  const callbackInput = {
    ...(input.modelId ? { modelId: input.modelId } : {}),
    recordEvent: async (event: JingleLangChainTraceEvent) => {
      await recordRuntimeTraceEvent({
        event,
        runContext: input.runContext,
        trace
      })
    },
    ...(trace.skippedRunNames ? { skippedRunNames: trace.skippedRunNames } : {})
  }

  return [createJingleLangChainTraceCallback(callbackInput)]
}

async function recordRuntimeTraceEvent(input: {
  event: JingleLangChainTraceEvent
  runContext: RuntimeRunContextScope
  trace: RuntimeTraceSinkContract
}): Promise<void> {
  try {
    await input.trace.recordEvent({
      ...input.runContext,
      event: input.event
    })
  } catch (error) {
    console.warn(
      `[RuntimeObservation] Trace sink failed for thread ${input.runContext.threadId}:`,
      error
    )
  }
}

function createRuntimeTraceConfig(input: {
  modelId?: string
  runContext: RuntimeRunContextScope
  trace?: RuntimeTraceSinkContract
}): JingleAgentRunTraceConfig {
  return (
    input.trace?.createRuntimeConfig?.({
      ...input.runContext,
      ...(input.modelId ? { modelId: input.modelId } : {})
    }) ?? {}
  )
}

function createRuntimeRunTraceConfig(input: {
  modelId?: string
  runContext: RuntimeRunContextScope
  source: "invoke" | "resume"
  trace?: RuntimeTraceSinkContract
}): JingleAgentRunTraceConfig {
  return (
    input.trace?.createRunConfig?.({
      ...input.runContext,
      source: input.source,
      ...(input.modelId ? { modelId: input.modelId } : {})
    }) ?? {}
  )
}
