import type { RuntimeRunStart } from "./runtime-contract"
import type { CompleteJingleAgentRunResult } from "./run-completion"
import type { RuntimeThreadRunLifecycleControl } from "./runtime-thread"

export type RuntimeThreadTerminalLifecycle<TContextInclusion> = Pick<
  RuntimeThreadRunLifecycleControl<TContextInclusion>,
  "abortRun" | "completeRun" | "failRun" | "settleRun"
>

export interface RuntimeThreadTerminalCompletionInput<TContextInclusion> {
  expectedMessageId?: string
  interrupted: boolean
  submittedContextInclusions: readonly TContextInclusion[]
}

export type RuntimeThreadTerminalIntent<TContextInclusion> =
  | { status: "aborted" }
  | { error: unknown; status: "failed" }
  | ({ status: "completed" } & RuntimeThreadTerminalCompletionInput<TContextInclusion>)

export type RuntimeThreadTerminalResult<TContextInclusion> =
  | { status: "aborted" }
  | { error: unknown; status: "failed" }
  | {
      completion: CompleteJingleAgentRunResult<TContextInclusion>
      status: "completed"
    }

export type RuntimeThreadTerminalStatus = "aborted" | "completed" | "failed"

export type RuntimeThreadTerminalSubmission =
  | {
      accepted: true
      status: RuntimeThreadTerminalStatus
      token: symbol
    }
  | {
      accepted: false
      status: RuntimeThreadTerminalStatus
      winnerStatus: RuntimeThreadTerminalStatus
    }

export interface RuntimeThreadTerminalReferee<TContextInclusion> {
  commit(): Promise<RuntimeThreadTerminalResult<TContextInclusion>>
  owns(submission: RuntimeThreadTerminalSubmission): boolean
  submit(intent: RuntimeThreadTerminalIntent<TContextInclusion>): RuntimeThreadTerminalSubmission
  winnerStatus(): RuntimeThreadTerminalStatus | null
}

export interface RuntimeThreadIgnoredTerminalDiagnostic {
  ignoredError: unknown | null
  ignoredStatus: RuntimeThreadTerminalStatus
  runId: string
  winnerStatus: RuntimeThreadTerminalStatus
}

export function createRuntimeThreadTerminalReferee<TContextInclusion>(input: {
  lifecycle: RuntimeThreadTerminalLifecycle<TContextInclusion>
  observeIgnoredTerminal: (diagnostic: RuntimeThreadIgnoredTerminalDiagnostic) => void
  start: RuntimeRunStart
}): RuntimeThreadTerminalReferee<TContextInclusion> {
  const { lifecycle, start } = input
  let winner: {
    intent: RuntimeThreadTerminalIntent<TContextInclusion>
    token: symbol
  } | null = null
  let committed: Promise<RuntimeThreadTerminalResult<TContextInclusion>> | null = null

  return {
    commit: () => {
      if (!winner) {
        throw new Error(`[RuntimeThreadRun] Run "${start.runId}" has no terminal outcome.`)
      }
      if (committed) {
        return committed
      }

      const intent = winner.intent
      committed = commitRuntimeThreadTerminal({ intent, lifecycle, start })
      return committed
    },
    owns: (submission) =>
      submission.accepted && winner !== null && winner.token === submission.token,
    submit: (intent) => {
      if (winner) {
        observeIgnoredTerminalSafely(input.observeIgnoredTerminal, {
          ignoredError: intent.status === "failed" ? intent.error : null,
          ignoredStatus: intent.status,
          runId: start.runId,
          winnerStatus: winner.intent.status
        })
        return {
          accepted: false,
          status: intent.status,
          winnerStatus: winner.intent.status
        }
      }

      const token = Symbol(intent.status)
      winner = { intent, token }
      return { accepted: true, status: intent.status, token }
    },
    winnerStatus: () => winner?.intent.status ?? null
  }
}

function observeIgnoredTerminalSafely(
  observe: (diagnostic: RuntimeThreadIgnoredTerminalDiagnostic) => void,
  diagnostic: RuntimeThreadIgnoredTerminalDiagnostic
): void {
  try {
    observe(diagnostic)
  } catch (error) {
    console.error("[RuntimeThreadTerminal] Ignored-terminal diagnostic failed.", error)
  }
}

async function commitRuntimeThreadTerminal<TContextInclusion>(input: {
  intent: RuntimeThreadTerminalIntent<TContextInclusion>
  lifecycle: RuntimeThreadTerminalLifecycle<TContextInclusion>
  start: RuntimeRunStart
}): Promise<RuntimeThreadTerminalResult<TContextInclusion>> {
  const persistence = await captureResult(() =>
    persistRuntimeThreadTerminal(input.lifecycle, input.start, input.intent)
  )
  const settlement = await captureResult(() =>
    input.lifecycle.settleRun({ runId: input.start.runId })
  )

  if (!persistence.ok) {
    if (!settlement.ok) {
      throw new AggregateError(
        [...readContainedErrors(persistence.error), settlement.error],
        `Run "${input.start.runId}" terminal persistence and ownership cleanup both failed.`
      )
    }
    throw persistence.error
  }

  if (!settlement.ok) {
    if (persistence.value.status === "failed") {
      throw new AggregateError(
        [persistence.value.error, settlement.error],
        `Run "${input.start.runId}" failed and ownership cleanup also failed.`
      )
    }
    throw settlement.error
  }

  return persistence.value
}

async function persistRuntimeThreadTerminal<TContextInclusion>(
  lifecycle: RuntimeThreadTerminalLifecycle<TContextInclusion>,
  start: RuntimeRunStart,
  intent: RuntimeThreadTerminalIntent<TContextInclusion>
): Promise<RuntimeThreadTerminalResult<TContextInclusion>> {
  if (intent.status === "aborted") {
    await lifecycle.abortRun({ runId: start.runId })
    return intent
  }
  if (intent.status === "failed") {
    try {
      await lifecycle.failRun({ error: intent.error, runId: start.runId })
      return intent
    } catch (persistenceError) {
      throw new AggregateError(
        [intent.error, persistenceError],
        `Run "${start.runId}" failed and its failure state could not be persisted.`
      )
    }
  }

  try {
    const completion = await lifecycle.completeRun({
      expectedMessageId: intent.expectedMessageId,
      interrupted: intent.interrupted,
      runId: start.runId,
      submittedContextInclusions: [...intent.submittedContextInclusions],
      submittedRecordingRefs: [...start.recordingRefs]
    })
    return { completion, status: "completed" }
  } catch (completionError) {
    try {
      await lifecycle.failRun({ error: completionError, runId: start.runId })
      return { error: completionError, status: "failed" }
    } catch (persistenceError) {
      throw new AggregateError(
        [completionError, persistenceError],
        `Run "${start.runId}" completion failed and its failure state could not be persisted.`
      )
    }
  }
}

async function captureResult<T>(
  operation: () => Promise<T> | T
): Promise<{ ok: true; value: T } | { error: unknown; ok: false }> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return { error, ok: false }
  }
}

function readContainedErrors(error: unknown): readonly unknown[] {
  return error instanceof AggregateError ? error.errors : [error]
}
