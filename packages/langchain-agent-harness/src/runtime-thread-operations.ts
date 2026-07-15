import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import {
  buildRuntimeInvokeInitialState,
  buildRuntimeResumeCommand
} from "./runtime-operation-payload"
import type { RuntimeThreadOperationControl } from "./runtime-thread"
import type { RuntimeThreadContext } from "./runtime-thread-context"
import type { RuntimeExecutionContext } from "./runtime-execution-context"

export function createRuntimeThreadOperationControl<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
>(context: RuntimeThreadContext): RuntimeThreadOperationControl<TContextInclusion> {
  const readRunExecution = async (executionContext: RuntimeExecutionContext<TContextInclusion>) => {
    context.activateRun(executionContext)
    return executionContext.resolveExecution()
  }

  return {
    compact: async () => {
      throw new Error(
        "[RuntimeThread] Compact is an independent operation and is not available before Pause 4."
      )
    },
    invoke: async (invokeInput, streamOptions) => {
      return (await readRunExecution(streamOptions.executionContext)).streamInvoke(
        buildRuntimeInvokeInitialState(invokeInput),
        { signal: streamOptions.signal }
      )
    },
    resume: async (resumeInput, streamOptions) => {
      return (await readRunExecution(streamOptions.executionContext)).streamResume(
        buildRuntimeResumeCommand(resumeInput),
        { signal: streamOptions.signal }
      )
    }
  }
}
