import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph-checkpoint"

export interface JingleCheckpointCommittedEvent {
  checkpointId: string
  checkpointNs: string
  metadataSource: string | null
  runId: string
  step: unknown
  threadId: string
}

export interface JingleCheckpointAfterCommitInput {
  checkpoint: Checkpoint
  checkpointNs: string
  metadata: CheckpointMetadata
  recordCheckpointCommitted: (event: JingleCheckpointCommittedEvent) => Promise<void> | void
  runId: string | null
  threadId: string
}

export async function handleJingleCheckpointAfterCommit(
  input: JingleCheckpointAfterCommitInput
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
}
