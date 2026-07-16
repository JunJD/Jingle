import type { RuntimeResumeRunStart, RuntimeRunStart } from "./runtime-contract"
import {
  createRuntimeExecutionContext,
  type RuntimeExecutionActivation,
  type RuntimeExecutionContext
} from "./runtime-execution-context"
import type { RuntimeRunStreamChunk } from "./runtime-operation"
import {
  type RuntimeThreadTerminalCompletionInput,
  type RuntimeThreadTerminalLifecycle,
  type RuntimeThreadTerminalResult,
  type RuntimeThreadTerminalSubmission
} from "./runtime-thread-terminal"
import type {
  RuntimeThreadInvokeRun,
  RuntimeThreadOperationControl,
  RuntimeThreadResumeRun,
  RuntimeThreadRun,
  RuntimeThreadRunExecutionInput,
  RuntimeThreadRunResult,
  RuntimeThreadStreamControl
} from "./runtime-thread"

interface RuntimeThreadRunControls<TContextInclusion> {
  lifecycle: RuntimeThreadTerminalLifecycle<TContextInclusion>
  operations: RuntimeThreadOperationControl<TContextInclusion>
  stream: RuntimeThreadStreamControl
}

interface RuntimeThreadRunInternals<TContextInclusion> extends RuntimeThreadRun {
  readonly executionContext: RuntimeExecutionContext<TContextInclusion>
  execute(
    activation: Omit<RuntimeExecutionActivation, "signal">,
    operation: () => Promise<
      | RuntimeThreadTerminalCompletionInput<TContextInclusion>
      | { cancelAfterDecision?: () => Promise<void> | void; status: "cancelled" }
    >
  ): Promise<RuntimeThreadRunResult<TContextInclusion>>
  requestAbort(): RuntimeThreadTerminalSubmission
  requestCancellation(cancelAfterDecision?: () => Promise<void> | void): RuntimeThreadTerminalSubmission
  readonly signal: AbortSignal
}

export function createRuntimeThreadInvokeRun<TContextInclusion>(input: {
  controls: RuntimeThreadRunControls<TContextInclusion>
  start: RuntimeRunStart
}): RuntimeThreadInvokeRun<TContextInclusion> {
  const { controls, start } = input
  const run = createRuntimeThreadRunBase(controls.lifecycle, start)

  return {
    abort: run.abort,
    fail: run.fail,
    runId: run.runId,
    execute: (executionInput) =>
      run.execute(
        {
          callbacks: executionInput.callbacks,
          steeringBuffer: executionInput.steeringBuffer
        },
        () =>
          executeRuntimeThreadRunWork({
            createStream: () =>
              controls.operations.invoke(
                {
                  contextInclusions: executionInput.contextInclusions,
                  message: executionInput.message,
                  recordingRefs: [...start.recordingRefs],
                  removeMessageIds: executionInput.removeMessageIds,
                  runId: run.runId,
                  title: executionInput.title
                },
                { executionContext: run.executionContext, signal: run.signal }
              ),
            executionInput,
            run,
            stream: controls.stream,
            submittedContextInclusions: executionInput.contextInclusions
          })
      )
  }
}

export function createRuntimeThreadResumeRun<TContextInclusion>(input: {
  controls: RuntimeThreadRunControls<TContextInclusion>
  decision: Parameters<RuntimeThreadOperationControl<TContextInclusion>["resume"]>[0]["decision"]
  start: RuntimeResumeRunStart
}): RuntimeThreadResumeRun<TContextInclusion> {
  const { controls, start } = input
  const run = createRuntimeThreadRunBase(controls.lifecycle, start)

  return {
    abort: run.abort,
    fail: run.fail,
    runId: run.runId,
    execute: (executionInput) =>
      run.execute(
        {
          callbacks: executionInput.callbacks,
          steeringBuffer: executionInput.steeringBuffer
        },
        async () => {
          const completion = await executeRuntimeThreadRunWork({
            beforePendingHitlPersistence: async () => {
              await start.beforePendingHitlPersistence()
              if (input.decision.type === "user_declined") {
                run.requestCancellation(start.cancelAfterDecision)
              }
              executionInput.onDecisionCommitted?.()
            },
            createStream: () =>
              controls.operations.resume(
                {
                  contextInclusions: executionInput.contextInclusions,
                  decision: input.decision,
                  recordingRefs: [...start.recordingRefs],
                  runId: run.runId
                },
                { executionContext: run.executionContext, signal: run.signal }
              ),
            executionInput,
            run,
            stream: controls.stream,
            submittedContextInclusions: executionInput.contextInclusions ?? []
          })
          return completion
        }
      )
  }
}

async function executeRuntimeThreadRunWork<TContextInclusion>(input: {
  beforePendingHitlPersistence?: () => Promise<void> | void
  createStream: () => Promise<AsyncIterable<RuntimeRunStreamChunk>>
  executionInput: RuntimeThreadRunExecutionInput
  run: RuntimeThreadRunInternals<TContextInclusion>
  stream: RuntimeThreadStreamControl
  submittedContextInclusions: readonly TContextInclusion[]
}): Promise<RuntimeThreadTerminalCompletionInput<TContextInclusion>> {
  const removeAbortForwarding = forwardAbortSignal(
    input.executionInput.signal,
    input.run.requestAbort
  )

  try {
    assertRuntimeThreadExecutionActive(input.run.signal)

    const stream = await input.createStream()
    const drainResult = await input.stream.drainRunStream({
      beforePendingHitlPersistence: input.beforePendingHitlPersistence,
      onChunk: input.executionInput.onChunk,
      runId: input.run.runId,
      signal: input.run.signal,
      stream
    })

    assertRuntimeThreadExecutionActive(input.run.signal)

    if (input.beforePendingHitlPersistence && !drainResult.beforePendingHitlPersistenceApplied) {
      await input.beforePendingHitlPersistence()
    }

    assertRuntimeThreadExecutionActive(input.run.signal)

    const completion = {
      expectedMessageId: input.executionInput.expectedMessageId,
      interrupted: drainResult.interrupted,
      submittedContextInclusions: input.submittedContextInclusions
    }
    return completion
  } finally {
    removeAbortForwarding()
  }
}

function createRuntimeThreadRunBase<TContextInclusion>(
  lifecycle: RuntimeThreadTerminalLifecycle<TContextInclusion>,
  start: RuntimeRunStart
): RuntimeThreadRunInternals<TContextInclusion> {
  const executionContext = createRuntimeExecutionContext({ lifecycle, start })
  const terminal = executionContext.terminal
  let executionStarted = false
  let executionSettled: Promise<void> | null = null
  const requestAbort = (): RuntimeThreadTerminalSubmission => {
    executionContext.assertActive()
    const submission = terminal.submit({ status: "aborted" })
    executionContext.abort()
    return submission
  }
  const requestCancellation = (
    cancelAfterDecision?: () => Promise<void> | void
  ): RuntimeThreadTerminalSubmission => {
    executionContext.assertActive()
    return terminal.submit({ cancelAfterDecision, status: "cancelled" })
  }

  return {
    abort: async () => {
      const winnerStatus = terminal.winnerStatus()
      if (winnerStatus) {
        await executionSettled
        await terminal.commit()
        return winnerStatus === "aborted"
      }
      const submission = requestAbort()
      await executionSettled
      await terminal.commit()
      return terminal.winnerStatus() === submission.status
    },
    execute: (activation, operation) => {
      assertRuntimeThreadRunNotExecuted(executionStarted, start.runId)
      executionStarted = true
      let releaseExecutionBarrier!: () => void
      executionSettled = new Promise<void>((resolve) => {
        releaseExecutionBarrier = resolve
      })
      try {
        executionContext.activate(activation)
      } catch (error) {
        releaseExecutionBarrier()
        throw error
      }
      const execution = (async (): Promise<RuntimeThreadRunResult<TContextInclusion>> => {
        try {
          try {
            const outcome = await operation()
            if ("status" in outcome) {
              terminal.submit(outcome)
            } else {
              terminal.submit({ ...outcome, status: "completed" })
            }
          } catch (error) {
            terminal.submit({ error, status: "failed" })
          }
          return readPublicTerminalResult(await terminal.commit())
        } finally {
          releaseExecutionBarrier()
        }
      })()
      return execution
    },
    executionContext,
    fail: async (error) => {
      if (terminal.winnerStatus()) {
        await executionSettled
        await terminal.commit()
        return false
      }
      executionContext.assertActive()
      const submission = terminal.submit({ error, status: "failed" })
      executionContext.abort()
      await executionSettled
      await terminal.commit()
      return terminal.owns(submission)
    },
    requestAbort,
    requestCancellation,
    runId: start.runId,
    signal: executionContext.signal
  }
}

function assertRuntimeThreadExecutionActive(signal: AbortSignal): void {
  signal.throwIfAborted()
}

function assertRuntimeThreadRunNotExecuted(executionStarted: boolean, runId: string): void {
  if (executionStarted) {
    throw new Error(`[RuntimeThreadRun] Run "${runId}" has already been executed.`)
  }
}

function readPublicTerminalResult<TContextInclusion>(
  result: RuntimeThreadTerminalResult<TContextInclusion>
): RuntimeThreadRunResult<TContextInclusion> {
  if (result.status !== "failed") {
    return result
  }

  throw result.error
}

function forwardAbortSignal(source: AbortSignal, abortExecution: () => void): () => void {
  if (source.aborted) {
    abortExecution()
    return () => undefined
  }

  source.addEventListener("abort", abortExecution, { once: true })
  return () => source.removeEventListener("abort", abortExecution)
}
