import { isBaseMessage } from "@langchain/core/messages"
import type { RunnableConfig } from "@langchain/core/runnables"
import type { RuntimeCompactPlan, RuntimeNodeContext, RuntimeTargetNode } from "./node-contract"

export interface CompactPrepareNodeResult {
  readonly privateState: { compactPlan: RuntimeCompactPlan }
}

export interface CompactPrepareNodeInput {
  readonly checkpointConfig: RunnableConfig
}

export class CompactPrepareNode implements RuntimeTargetNode<
  CompactPrepareNodeInput,
  CompactPrepareNodeResult
> {
  readonly boundary = "compact"
  readonly kind = "CompactPrepareNode"

  invoke(input: CompactPrepareNodeInput, context: RuntimeNodeContext): CompactPrepareNodeResult {
    if (context.operation.kind !== "compact") {
      throw new Error("[CompactPrepareNode] Expected a compact operation.")
    }

    const messages = context.state.messages
    for (const message of messages) {
      if (!isBaseMessage(message)) {
        throw new Error(
          "[CompactPrepareNode] Runtime messages channel contains a non-message value."
        )
      }
    }

    const operation = context.operation

    return {
      privateState: {
        compactPlan: {
          checkpointConfig: input.checkpointConfig,
          messages,
          operation,
          preserveLastUserMessageCount: operation.preserveLastUserMessageCount,
          trigger: operation.trigger
        }
      }
    }
  }
}
