import type { RunnableConfig } from "@langchain/core/runnables"
import {
  CompactPrepareNode,
  CompactSummarizeNode,
  createCompactCheckpointConfig,
  type CompactSummarizeUpdate
} from "./harness-runtime/graph/nodes"
import { type JingleSummarizationController } from "./harness-runtime/summarization"
import type { RuntimeCompactOperation } from "./runtime-operation"
import type { RuntimeGraphEngine } from "./runtime-execution"
import type { RuntimeCompaction } from "./runtime-state"

export interface JingleCompactionInput {
  preserveLastUserMessageCount?: number
  reason?: string | null
  trigger: string
}

export interface JingleCompactionRunContext {
  runId: string
  threadId: string
  workspacePath: string
}

export interface JingleCompactionRuntimeState {
  _summarizationEvent?: unknown
  _summarizationSessionId?: unknown
  compactions?: unknown
  messages?: unknown
}

export interface JingleCompactionResult {
  checkpointConfig: RunnableConfig
  compaction: RuntimeCompaction
  messageCountAfterCompaction: number
  messageCountBeforeCompaction: number
}

export interface CreateJingleCompactionControllerInput {
  runtime: RuntimeGraphEngine
  summarization: JingleSummarizationController
}

export interface JingleCompactionController {
  compact(
    input: JingleCompactionInput & JingleCompactionRunContext
  ): Promise<JingleCompactionResult>
}

export function createJingleCompactionController(
  input: CreateJingleCompactionControllerInput
): JingleCompactionController {
  const prepareNode = new CompactPrepareNode()
  const summarizeNode = new CompactSummarizeNode(input.summarization)

  return {
    compact: async (compactInput) => {
      const operation: RuntimeCompactOperation = {
        kind: "compact",
        preserveLastUserMessageCount: compactInput.preserveLastUserMessageCount,
        reason: compactInput.reason,
        runId: compactInput.runId,
        threadId: compactInput.threadId,
        trigger: compactInput.trigger,
        workspacePath: compactInput.workspacePath
      }
      const checkpointConfig = createCompactCheckpointConfig(operation)
      const state = await input.runtime.getState<JingleCompactionRuntimeState>(checkpointConfig)
      const preparedWithState = prepareNode.invoke(undefined, {
        operation,
        state: state.values as never
      })
      const planWithState = preparedWithState.privateState.compactPlan
      const summarized = await summarizeNode.invoke(
        { plan: planWithState },
        {
          operation,
          scratch: {
            compactPlan: planWithState
          },
          state: state.values as never
        }
      )
      const compactUpdate = summarized.stateUpdate as CompactSummarizeUpdate
      const compaction = compactUpdate.compactions[0] as RuntimeCompaction
      const messageCountAfterCompaction = summarized.privateState.messageCountAfterCompaction

      await input.runtime.updateState(checkpointConfig, compactUpdate)

      return {
        checkpointConfig,
        compaction,
        messageCountAfterCompaction,
        messageCountBeforeCompaction: planWithState.messages.length
      }
    }
  }
}
