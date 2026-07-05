import type {
  Checkpoint,
  CheckpointMetadata,
  CheckpointTuple
} from "@langchain/langgraph-checkpoint"
import type {
  JingleHitlReviewParser,
  JinglePendingHitlRequestUpserter
} from "./langgraph-hitl-reader"
import { extractJingleHitlRequestFromCheckpoint } from "./langgraph-hitl-reader"

export interface JingleCheckpointCommittedEvent {
  checkpointId: string
  checkpointNs: string
  metadataSource: string | null
  runId: string
  step: unknown
  threadId: string
}

export interface JingleCheckpointAfterCommitInput<TReview = unknown> {
  checkpoint: Checkpoint
  checkpointNs: string
  metadata: CheckpointMetadata
  parseReview: JingleHitlReviewParser<TReview>
  recordCheckpointCommitted: (event: JingleCheckpointCommittedEvent) => Promise<void> | void
  runId: string | null
  threadId: string
  upsertPendingHitlRequest: JinglePendingHitlRequestUpserter<TReview>
}

export async function handleJingleCheckpointAfterCommit<TReview>(
  input: JingleCheckpointAfterCommitInput<TReview>
): Promise<void> {
  if (input.runId) {
    await input.recordCheckpointCommitted({
      checkpointId: input.checkpoint.id,
      checkpointNs: input.checkpointNs,
      metadataSource: typeof input.metadata.source === "string" ? input.metadata.source : null,
      runId: input.runId,
      step: input.metadata.step ?? null,
      threadId: input.threadId
    })
  }

  const tuple = {
    checkpoint: input.checkpoint,
    metadata: input.metadata
  } as CheckpointTuple
  const hitlRequest = extractJingleHitlRequestFromCheckpoint(input.threadId, tuple, {
    parseReview: input.parseReview,
    runId: input.runId
  })

  if (hitlRequest) {
    await input.upsertPendingHitlRequest(hitlRequest, {
      runId: input.runId,
      threadId: input.threadId
    })
  }
}
