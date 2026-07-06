import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import {
  buildRuntimeInvokeInitialState,
  buildRuntimeResumeCommand
} from "./runtime-operation-payload"
import type { RuntimeThreadOperationControl } from "./runtime-thread"
import type { RuntimeThreadContext } from "./runtime-thread-context"

export function createRuntimeThreadOperationControl<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
>(
  context: RuntimeThreadContext
): RuntimeThreadOperationControl<TContextInclusion> {
  const { createRunExecution, runState } = context

  return {
    compact: async (compactInput) => {
      if (!runState.currentRunId) {
        throw new Error("[RuntimeThread] Cannot compact before beginning a run.")
      }
      return (await createRunExecution({ runId: runState.currentRunId })).compact(compactInput)
    },
    invoke: async (invokeInput, streamOptions) => {
      runState.currentRunId = invokeInput.runId

      return (await createRunExecution(invokeInput)).streamInvoke(
        buildRuntimeInvokeInitialState(invokeInput),
        streamOptions
      )
    },
    resume: async (resumeInput, streamOptions) => {
      runState.currentRunId = resumeInput.runId

      return (await createRunExecution(resumeInput)).streamResume(
        buildRuntimeResumeCommand(resumeInput),
        streamOptions
      )
    }
  }
}
