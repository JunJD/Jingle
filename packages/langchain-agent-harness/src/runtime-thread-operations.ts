import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import { parseRuntimeCompactInput } from "./runtime-operation"
import {
  buildRuntimeInvokeInitialState,
  buildRuntimeResumeCommand
} from "./runtime-operation-payload"
import type {
  RuntimeThreadCompactionControl,
  RuntimeThreadOperationControl
} from "./runtime-thread"
import type { RuntimeThreadContext } from "./runtime-thread-context"
import type { RuntimeExecutionContext } from "./runtime-execution-context"

export function createRuntimeThreadOperationControl<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
>(
  context: RuntimeThreadContext,
  compaction?: RuntimeThreadCompactionControl
): RuntimeThreadOperationControl<TContextInclusion> {
  const readRunExecution = async (executionContext: RuntimeExecutionContext<TContextInclusion>) => {
    context.activateRun(executionContext)
    return executionContext.resolveExecution()
  }

  return {
    compact: async (compactInput) => {
      const admittedInput = parseRuntimeCompactInput(compactInput)
      const reservation = context.reserveRun()
      try {
        if (!compaction) {
          throw new Error(
            "[RuntimeThread] Compact is an independent operation unavailable in this runtime environment."
          )
        }
        return await compaction.compact({
          ...admittedInput,
          ...context.thread
        })
      } finally {
        context.releaseRunReservation(reservation)
      }
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
