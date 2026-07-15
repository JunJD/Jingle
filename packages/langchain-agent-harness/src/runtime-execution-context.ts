import type { BaseCallbackHandler } from "@langchain/core/callbacks/base"
import type { AgentRunSteeringBufferPort } from "./run-steering"
import type { RuntimeRunStart } from "./runtime-contract"
import type { RuntimeRunExecution } from "./runtime-execution"
import type { RuntimeExecutionFactory } from "./runtime-execution-factory"
import {
  createRuntimeThreadTerminalReferee,
  type RuntimeThreadIgnoredTerminalDiagnostic,
  type RuntimeThreadTerminalLifecycle,
  type RuntimeThreadTerminalReferee
} from "./runtime-thread-terminal"

export class RuntimeThreadBusyError extends Error {
  constructor(runId: string) {
    super(`[RuntimeThread] Run "${runId}" cannot start while another operation is active.`)
    this.name = "RuntimeThreadBusyError"
  }
}

export interface RuntimeExecutionActivation {
  callbacks?: readonly BaseCallbackHandler[]
  steeringBuffer?: AgentRunSteeringBufferPort | null
}

export interface RuntimeExecutionContext<TContextInclusion = unknown> {
  readonly modelId: string
  readonly runId: string
  readonly signal: AbortSignal
  readonly terminal: RuntimeThreadTerminalReferee<TContextInclusion>
  activate(input: RuntimeExecutionActivation): void
  abort(): void
  assertActive(): void
  bindExecution(factory: RuntimeExecutionFactory): void
  dispose(): void
  resolveExecution(): Promise<RuntimeRunExecution>
}

export function createRuntimeExecutionContext<TContextInclusion>(input: {
  lifecycle: RuntimeThreadTerminalLifecycle<TContextInclusion>
  start: RuntimeRunStart
}): RuntimeExecutionContext<TContextInclusion> {
  const { start } = input
  const abortController = new AbortController()
  let activation: RuntimeExecutionActivation | null = null
  let createRunExecution: RuntimeExecutionFactory | null = null
  let execution: Promise<RuntimeRunExecution> | null = null
  let disposed = false

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    abortController.abort()
    activation = null
    createRunExecution = null
    execution = null
  }
  const terminal = createRuntimeThreadTerminalReferee({
    lifecycle: {
      ...input.lifecycle,
      settleRun: async (settleInput) => {
        try {
          await input.lifecycle.settleRun(settleInput)
        } finally {
          dispose()
        }
      }
    },
    observeIgnoredTerminal: (diagnostic) =>
      recordIgnoredTerminal(diagnostic, abortController.signal),
    start
  })

  const assertActive = (): void => {
    if (disposed) {
      throw new Error(`[RuntimeExecutionContext] Run "${start.runId}" is no longer active.`)
    }
  }

  return {
    abort() {
      assertActive()
      abortController.abort()
    },
    activate(nextActivation) {
      assertActive()
      if (activation) {
        throw new Error(`[RuntimeExecutionContext] Run "${start.runId}" was already activated.`)
      }
      activation = nextActivation
    },
    assertActive,
    bindExecution(factory) {
      assertActive()
      if (createRunExecution || execution) {
        throw new Error(`[RuntimeExecutionContext] Run "${start.runId}" was already bound.`)
      }
      createRunExecution = factory
    },
    dispose,
    modelId: start.modelId,
    resolveExecution() {
      assertActive()
      if (!activation) {
        throw new Error(`[RuntimeExecutionContext] Run "${start.runId}" was not activated.`)
      }
      if (execution) {
        return execution
      }
      if (!createRunExecution) {
        throw new Error(
          `[RuntimeExecutionContext] Run "${start.runId}" lost its execution binding.`
        )
      }
      const factory = createRunExecution
      const currentActivation = activation
      createRunExecution = null
      execution = Promise.resolve().then(() =>
        factory({
          callbacks: currentActivation.callbacks ? [...currentActivation.callbacks] : undefined,
          modelId: start.modelId,
          runId: start.runId,
          signal: abortController.signal,
          steeringBuffer: currentActivation.steeringBuffer
        })
      )
      return execution
    },
    runId: start.runId,
    signal: abortController.signal,
    terminal
  }
}

function recordIgnoredTerminal(
  diagnostic: RuntimeThreadIgnoredTerminalDiagnostic,
  signal: AbortSignal
): void {
  if (signal.aborted && diagnostic.ignoredError === signal.reason) {
    console.debug(
      "[RuntimeThreadTerminal] Ignored expected cancellation after terminal decision.",
      {
        ignoredStatus: diagnostic.ignoredStatus,
        runId: diagnostic.runId,
        winnerStatus: diagnostic.winnerStatus
      }
    )
    return
  }

  console.warn("[RuntimeThreadTerminal] Ignored conflicting terminal event.", diagnostic)
}
