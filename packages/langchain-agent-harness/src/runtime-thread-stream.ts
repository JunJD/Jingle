import { persistJingleValuesHitlRequest } from "./langgraph-hitl-reader"
import { drainRuntimeRunStream } from "./run-stream"
import type {
  CreateRuntimeThreadFactoryInput,
  RuntimePauseControllerContract
} from "./runtime-contract"
import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeThreadScope } from "./runtime-scope"
import type { RuntimeThreadStreamControl } from "./runtime-thread"

export interface RuntimeThreadStreamDrainControlInput<TReview = unknown> {
  pauseController: RuntimePauseControllerContract<TReview>
  thread: RuntimeThreadScope
}

export function createRuntimeThreadStreamDrainControl<
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
  threadInput: RuntimeThreadScope
): RuntimeThreadStreamControl {
  return createRuntimeThreadStreamDrainControlFromController({
    pauseController: input.host.control.pauseController,
    thread: threadInput
  })
}

export function createRuntimeThreadStreamDrainControlFromController<TReview = unknown>(
  input: RuntimeThreadStreamDrainControlInput<TReview>
): RuntimeThreadStreamControl {
  return {
    drainRunStream: async (drainInput) => {
      let beforePendingHitlPersistenceApplied = false
      const result = await drainRuntimeRunStream({
        onChunk: async (chunk) => {
          const [mode, data] = chunk
          if (drainInput.beforePendingHitlPersistence && !beforePendingHitlPersistenceApplied) {
            await drainInput.beforePendingHitlPersistence()
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
