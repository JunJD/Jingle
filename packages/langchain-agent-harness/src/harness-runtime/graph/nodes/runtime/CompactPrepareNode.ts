import { isBaseMessage } from "@langchain/core/messages"
import { buildJingleCheckpointLookupConfig } from "../../../../run-config"
import type { RuntimeCompactOperation } from "../../../../runtime-operation"
import type {
  RuntimeCompactPlan,
  RuntimeNodeContext,
  RuntimeTargetNode
} from "./node-contract"

export interface CompactPrepareNodeResult {
  readonly privateState: { compactPlan: RuntimeCompactPlan }
}

export function createCompactCheckpointConfig(operation: RuntimeCompactOperation) {
  return buildJingleCheckpointLookupConfig({
    checkpointRunId: operation.runId,
    threadId: operation.threadId
  })
}

export class CompactPrepareNode implements RuntimeTargetNode<undefined, CompactPrepareNodeResult>
{
  readonly boundary = "compact"
  readonly kind = "CompactPrepareNode"

  invoke(
    _input: undefined,
    context: RuntimeNodeContext
  ): CompactPrepareNodeResult {
    if (context.operation.kind !== "compact") {
      throw new Error("[CompactPrepareNode] Expected a compact operation.")
    }

    const messages = context.state.messages
    for (const message of messages) {
      if (!isBaseMessage(message)) {
        throw new Error("[CompactPrepareNode] Runtime messages channel contains a non-message value.")
      }
    }

    const operation = context.operation as RuntimeCompactOperation

    return {
      privateState: {
        compactPlan: {
          checkpointConfig: createCompactCheckpointConfig(operation),
          messages,
          operation,
          preserveLastUserMessageCount: operation.preserveLastUserMessageCount,
          trigger: operation.trigger
        }
      }
    }
  }
}
