import type { RunnableConfig } from "@langchain/core/runnables"
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint"
import type {
  RuntimeCompactRequestIdentity,
  RuntimeCheckpointCompactionReceipt,
  RuntimeCheckpointCompactionStore
} from "@jingle/langchain-agent-harness/transitional"
import type { RuntimeCheckpointSaver } from "./runtime-checkpointer"

type CheckpointCompactionSaver = Pick<
  RuntimeCheckpointSaver,
  "compactCheckpoint" | "getTuple" | "readCompactionCommit"
>

export function createCheckpointCompactionStore(input: {
  getCheckpointer(threadId: string): Promise<CheckpointCompactionSaver>
}): RuntimeCheckpointCompactionStore {
  return {
    async commit(commitInput) {
      const checkpointer = await input.getCheckpointer(commitInput.threadId)
      const checkpointNs = readCheckpointNamespace(commitInput.envelope.config)
      const previousStep = commitInput.envelope.metadata.step
      if (!Number.isSafeInteger(previousStep)) {
        throw new Error(
          `[RuntimeCompact] Checkpoint "${commitInput.envelope.checkpoint.id}" has an invalid metadata step.`
        )
      }
      const result = await checkpointer.compactCheckpoint({
        checkpoint: commitInput.envelope.checkpoint,
        checkpointNs,
        commitMetadata: {
          ...commitInput.envelope.metadata,
          source: "update",
          step: previousStep + 1,
          writes: {
            __runtime_compact__: {
              channels: Object.keys(commitInput.ownedValues),
              operationId: commitInput.metadata.operationId
            }
          },
          [commitInput.commitMetadataKey]: commitInput.metadata
        },
        commitMetadataKey: commitInput.commitMetadataKey,
        expectedCheckpointId: commitInput.envelope.checkpoint.id,
        operationId: commitInput.metadata.operationId,
        ownedValues: commitInput.ownedValues,
        requestIdentity: readRequestIdentity(commitInput.metadata),
        result: {
          compaction: readCommittedCompaction(
            commitInput.ownedValues.compactions,
            commitInput.metadata.operationId
          ),
          messageCountAfterCompaction: commitInput.metadata.messageCountAfterCompaction,
          messageCountBeforeCompaction: commitInput.metadata.messageCountBeforeCompaction
        },
        threadId: commitInput.threadId
      })

      switch (result.status) {
        case "already-committed":
          return { receipt: result.receipt, status: result.status }
        case "committed":
          return { receipt: result.receipt, status: result.status }
        default:
          return result
      }
    },
    async prepare(prepareInput: { threadId: string }) {
      const checkpointer = await input.getCheckpointer(prepareInput.threadId)
      const tuple = await checkpointer.getTuple({
        configurable: {
          checkpoint_ns: "",
          thread_id: prepareInput.threadId
        }
      })
      if (!tuple) {
        return { status: "not-found" } as const
      }
      if ((tuple.pendingWrites?.length ?? 0) > 0) {
        return {
          checkpointId: tuple.checkpoint.id,
          reason: "pending-writes",
          status: "unstable"
        } as const
      }

      return {
        envelope: readCheckpointEnvelope(tuple, tuple.checkpoint.id),
        status: "ready"
      } as const
    },
    async readCommitted(readInput) {
      const checkpointer = await input.getCheckpointer(readInput.threadId)
      return checkpointer.readCompactionCommit(readInput)
    }
  }
}

function readRequestIdentity(
  metadata: RuntimeCompactRequestIdentity
): RuntimeCompactRequestIdentity {
  return {
    modelId: metadata.modelId,
    preserveLastUserMessageCount: metadata.preserveLastUserMessageCount,
    preserveLastUserMessageCountPresent: metadata.preserveLastUserMessageCountPresent,
    reason: metadata.reason,
    trigger: metadata.trigger
  }
}

function readCommittedCompaction(
  compactions: readonly RuntimeCheckpointCompactionReceipt["compaction"][],
  operationId: string
): RuntimeCheckpointCompactionReceipt["compaction"] {
  const compaction = compactions.find((item) => item.compactionId === operationId)
  if (!compaction) {
    throw new Error(`[RuntimeCompact] Owned values are missing compaction fact "${operationId}".`)
  }
  return compaction
}

function readCheckpointEnvelope(tuple: CheckpointTuple | undefined, checkpointId: string) {
  if (!tuple || tuple.checkpoint.id !== checkpointId) {
    throw new Error(`[RuntimeCompact] Committed checkpoint "${checkpointId}" is unavailable.`)
  }
  if (!tuple.metadata) {
    throw new Error(`[RuntimeCompact] Checkpoint "${checkpointId}" is missing metadata.`)
  }

  return {
    checkpoint: tuple.checkpoint,
    config: tuple.config,
    metadata: tuple.metadata,
    parentConfig: tuple.parentConfig,
    pendingWrites: tuple.pendingWrites ?? []
  }
}

function readCheckpointNamespace(config: RunnableConfig): string {
  const configurable = config.configurable
  if (!configurable || typeof configurable !== "object" || Array.isArray(configurable)) {
    throw new Error("[RuntimeCompact] Checkpoint config is missing configurable fields.")
  }
  const checkpointNs = (configurable as Record<string, unknown>).checkpoint_ns
  if (checkpointNs === undefined) {
    return ""
  }
  if (typeof checkpointNs !== "string") {
    throw new Error("[RuntimeCompact] Checkpoint namespace is invalid.")
  }
  return checkpointNs
}
