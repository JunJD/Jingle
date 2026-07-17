import { abortJingleAgentRun, completeJingleAgentRun, failJingleAgentRun } from "./run-completion"
import type {
  RuntimeResumeRunStart,
  RuntimeRunLifecycleControllerContract,
  RuntimeRunStart
} from "./runtime-contract"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type {
  RuntimeThreadExecutionBinder,
  RuntimeThreadFactoryInput,
  RuntimeThreadRunLifecycleControl
} from "./runtime-thread"
import type { RuntimeThreadContext } from "./runtime-thread-context"

export interface RuntimeThreadRunLifecycleControlInput<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
> {
  runLifecycleController: RuntimeRunLifecycleControllerContract<
    TContextInclusion,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
  bindExecution: RuntimeThreadExecutionBinder<TInvokeRunLifecycleInput, TResumeRunLifecycleInput>
  context: RuntimeThreadContext
}

export function createRuntimeThreadRunLifecycleControl<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  input: RuntimeThreadFactoryInput<
    TContextInclusion,
    TReview,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >,
  context: RuntimeThreadContext
): RuntimeThreadRunLifecycleControl<
  TContextInclusion,
  TInvokeRunLifecycleInput,
  TResumeRunLifecycleInput
> {
  return createRuntimeThreadRunLifecycleControlFromController({
    bindExecution: input.bindExecution,
    runLifecycleController: input.runLifecycleController,
    context
  })
}

export function createRuntimeThreadRunLifecycleControlFromController<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  input: RuntimeThreadRunLifecycleControlInput<
    TContextInclusion,
    TInvokeRunLifecycleInput,
    TResumeRunLifecycleInput
  >
): RuntimeThreadRunLifecycleControl<
  TContextInclusion,
  TInvokeRunLifecycleInput,
  TResumeRunLifecycleInput
> {
  const lifecycle = input.runLifecycleController
  const { thread } = input.context

  return {
    abortRun: (abortInput) =>
      abortJingleAgentRun({
        markRunAborted: lifecycle.markRunAborted,
        recordRunFinished: lifecycle.recordRunFinished,
        recordRunInterrupted: lifecycle.recordRunInterrupted,
        runId: abortInput.runId,
        threadId: thread.threadId
      }),
    cancelRun: async ({ runId }) => {
      await lifecycle.markRunCancelled({ runId, threadId: thread.threadId })
      await lifecycle.recordRunFinished({
        completionReason: "user_declined",
        runId,
        status: "cancelled",
        threadId: thread.threadId
      })
    },
    beginInvokeRun: async (beginInput) => {
      const reservation = input.context.reserveRun()
      let runStart: RuntimeRunStart | null = null
      try {
        runStart = await Promise.resolve(
          lifecycle.beginInvokeRun({
            invoke: beginInput.invoke,
            threadId: thread.threadId
          })
        )
        const publicStart = {
          modelId: runStart.modelId,
          recordingRefs: [...runStart.recordingRefs],
          runId: runStart.runId
        }
        const admission = {
          ...runStart,
          createRunExecution: input.bindExecution.invoke({
            invoke: beginInput.invoke,
            start: runStart,
            thread
          })
        }
        input.context.admitRun(reservation, admission)
        return publicStart
      } catch (error) {
        try {
          if (runStart) {
            await failStartedRunAdmission({ error, lifecycle, runStart, threadId: thread.threadId })
          }
          throw error
        } finally {
          input.context.releaseRunReservation(reservation)
        }
      }
    },
    beginResumeRun: async (beginInput) => {
      const reservation = input.context.reserveRun()
      let runStart: RuntimeResumeRunStart | null = null
      try {
        runStart = await Promise.resolve(
          lifecycle.beginResumeRun({
            resume: beginInput.resume,
            threadId: thread.threadId
          })
        )
        const admittedStart = runStart
        const publicStart = {
          executionDisposition: admittedStart.executionDisposition,
          modelId: admittedStart.modelId,
          recordingRefs: [...admittedStart.recordingRefs],
          runId: admittedStart.runId
        }
        const admission = {
          ...admittedStart,
          createRunExecution:
            admittedStart.executionDisposition === "terminal"
              ? async () => {
                  throw new Error(
                    `[RuntimeThread] Terminal resume "${admittedStart.runId}" cannot create execution.`
                  )
                }
              : input.bindExecution.resume({
                  resume: beginInput.resume,
                  start: admittedStart,
                  thread
                })
        }
        input.context.admitRun(reservation, admission)
        return publicStart
      } catch (error) {
        try {
          if (runStart) {
            await failStartedRunAdmission({ error, lifecycle, runStart, threadId: thread.threadId })
          }
          throw error
        } finally {
          input.context.releaseRunReservation(reservation)
        }
      }
    },
    completeRun: async (completionInput) => {
      const completion = await completeJingleAgentRun({
        expectedMessageId: completionInput.expectedMessageId,
        finalizeRunWithoutCheckpoint: (runInput) =>
          lifecycle.finalizeRunWithoutCheckpoint({
            ...runInput,
            submittedContextInclusions: completionInput.submittedContextInclusions,
            submittedRecordingRefs: completionInput.submittedRecordingRefs
          }),
        interrupted: completionInput.interrupted,
        recordRunFinished: lifecycle.recordRunFinished,
        recordRunInterrupted: lifecycle.recordRunInterrupted,
        runId: completionInput.runId,
        syncRunFromLatestCheckpoint: (runInput) =>
          lifecycle.syncRunFromLatestCheckpoint({
            ...runInput,
            submittedContextInclusions: completionInput.submittedContextInclusions,
            submittedRecordingRefs: completionInput.submittedRecordingRefs
          }),
        threadId: thread.threadId,
        useCheckpointPersistence: lifecycle.useCheckpointPersistence()
      })
      await lifecycle.recordMemoryRecordingRefs({
        recordingRefs: completion.facts.recordingRefs,
        runId: completionInput.runId,
        threadId: thread.threadId
      })
      return completion
    },
    failRun: (failInput) =>
      failJingleAgentRun({
        error: failInput.error,
        markRunFailed: lifecycle.markRunFailed,
        recordRunFinished: lifecycle.recordRunFinished,
        runId: failInput.runId,
        threadId: thread.threadId
      }),
    settleRun: async ({ runId }) => {
      try {
        await lifecycle.settleRun({
          runId,
          threadId: thread.threadId
        })
      } finally {
        input.context.settleRun(runId)
      }
    }
  }
}

async function failStartedRunAdmission(input: {
  error: unknown
  lifecycle: Pick<
    RuntimeRunLifecycleControllerContract,
    "markRunFailed" | "recordRunFinished" | "settleRun"
  >
  runStart: RuntimeRunStart
  threadId: string
}): Promise<void> {
  const compensationErrors: unknown[] = []
  try {
    await failJingleAgentRun({
      error: input.error,
      markRunFailed: input.lifecycle.markRunFailed,
      recordRunFinished: input.lifecycle.recordRunFinished,
      runId: input.runStart.runId,
      threadId: input.threadId
    })
  } catch (error) {
    compensationErrors.push(error)
  }

  try {
    await input.lifecycle.settleRun({ runId: input.runStart.runId, threadId: input.threadId })
  } catch (error) {
    compensationErrors.push(error)
  }

  if (compensationErrors.length > 0) {
    throw new AggregateError(
      [input.error, ...compensationErrors],
      `[RuntimeThread] Run "${input.runStart.runId}" admission and compensation both failed.`
    )
  }
}
