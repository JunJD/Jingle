import {
  abortJingleAgentRun,
  completeJingleAgentRun,
  failJingleAgentRun
} from "./run-completion"
import type {
  CreateRuntimeThreadFactoryInput,
  RuntimeRunLifecycleControllerContract
} from "./runtime-contract"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeThreadRunLifecycleControl } from "./runtime-thread"
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
  context: RuntimeThreadContext
}

export function createRuntimeThreadRunLifecycleControl<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem,
  TGuardrailMetadata = Record<string, unknown>,
  TReview = unknown,
  TInvokeRunLifecycleInput = unknown,
  TResumeRunLifecycleInput = unknown
>(
  input: CreateRuntimeThreadFactoryInput<
    TContextInclusion,
    TGuardrailMetadata,
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
    runLifecycleController: input.host.control.runLifecycleController,
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
  const { runState, thread } = input.context

  return {
    abortRun: (abortInput) =>
      abortJingleAgentRun({
        markRunAborted: lifecycle.markRunAborted,
        recordRunFinished: lifecycle.recordRunFinished,
        recordRunInterrupted: lifecycle.recordRunInterrupted,
        runId: abortInput.runId,
        threadId: thread.threadId
      }),
    beginInvokeRun: async (beginInput) => {
      const runStart = await Promise.resolve(
        lifecycle.beginInvokeRun({
          invoke: beginInput.invoke,
          threadId: thread.threadId
        })
      )
      runState.currentRunId = runStart.runId
      return runStart
    },
    beginResumeRun: async (beginInput) => {
      const runStart = await Promise.resolve(
        lifecycle.beginResumeRun({
          resume: beginInput.resume,
          threadId: thread.threadId
        })
      )
      runState.currentRunId = runStart.runId
      return runStart
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
      })
  }
}
