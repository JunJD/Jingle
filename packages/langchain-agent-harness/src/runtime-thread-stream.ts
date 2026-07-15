import { persistJingleValuesHitlRequest } from "./langgraph-hitl-reader"
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
      let beforePendingHitlPersistenceApplied = false
      const result = await drainRuntimeRunStream({
        onChunk: async (chunk) => {
          drainInput.signal.throwIfAborted()
          const [mode, data] = chunk
          if (drainInput.beforePendingHitlPersistence && !beforePendingHitlPersistenceApplied) {
            await drainInput.beforePendingHitlPersistence()
            drainInput.signal.throwIfAborted()
            beforePendingHitlPersistenceApplied = true
          }
          const interrupted = await persistJingleValuesHitlRequest({
            data,
            mode,
            parseReview: input.pauseController.parseReview,
            runId: drainInput.runId,
            threadId: input.thread.threadId,
            upsertPendingHitlRequest: input.pauseController.upsertPendingHitlRequest
          })
          drainInput.signal.throwIfAborted()
          await drainInput.onChunk(chunk)
          return interrupted
        },
        signal: drainInput.signal,
        stream: drainInput.stream
      })
      return {
        ...result,
        beforePendingHitlPersistenceApplied
      }
    }
  }
}
