import { extractJingleHitlRequestFromValuesState } from "./langgraph-hitl-reader"
import { drainRuntimeRunStream } from "./run-stream"
import type { RuntimePauseControllerContract } from "./runtime-contract"
import type { RuntimeThreadScope } from "./runtime-scope"
import type { RuntimeThreadStreamControl } from "./runtime-thread"

export interface RuntimeThreadStreamDrainControlInput<TReview = unknown> {
  pauseController: RuntimePauseControllerContract<TReview>
  thread: RuntimeThreadScope
}

export function createRuntimeThreadStreamDrainControlFromController<TReview = unknown>(
  input: RuntimeThreadStreamDrainControlInput<TReview>
): RuntimeThreadStreamControl {
  return {
    drainRunStream: async (drainInput) => {
      const result = await drainRuntimeRunStream({
        onChunk: async (chunk) => {
          drainInput.signal.throwIfAborted()
          const [mode, data] = chunk
          const interrupted =
            mode === "values" &&
            extractJingleHitlRequestFromValuesState(input.thread.threadId, drainInput.runId, data, {
              parseReview: input.pauseController.parseReview
            }) !== null
          drainInput.signal.throwIfAborted()
          await drainInput.onChunk(chunk)
          return interrupted
        },
        signal: drainInput.signal,
        stream: drainInput.stream
      })
      return result
    }
  }
}
