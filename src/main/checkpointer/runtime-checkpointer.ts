import type { Checkpoint, CheckpointMetadata, CheckpointTuple } from "@langchain/langgraph-checkpoint"
import { extractHitlRequestFromCheckpoint, extractMessagesFromCheckpoint } from "../agent/runtime-state"
import { upsertHitlRequest } from "../db/hitl"
import { syncMessageSearchIndexFromSnapshot } from "../db/message-search"
import { PrismaCheckpointSaver } from "./prisma-saver"

export class RuntimeCheckpointSaver extends PrismaCheckpointSaver {
  protected override async afterPut(input: {
    checkpoint: Checkpoint
    metadata: CheckpointMetadata
    runId: string | null
    threadId: string
  }): Promise<void> {
    const tuple = {
      checkpoint: input.checkpoint,
      metadata: input.metadata
    } as CheckpointTuple

    await syncMessageSearchIndexFromSnapshot(
      input.threadId,
      extractMessagesFromCheckpoint(input.threadId, tuple)
    )

    const hitlRequest = extractHitlRequestFromCheckpoint(input.threadId, tuple, {
      runId: input.runId
    })
    if (!hitlRequest) {
      return
    }

    await upsertHitlRequest({
      request_id: hitlRequest.id,
      thread_id: input.threadId,
      run_id: input.runId,
      tool_call_id: hitlRequest.tool_call.id,
      tool_name: hitlRequest.tool_call.name,
      tool_args: hitlRequest.tool_call.args,
      review_kind: hitlRequest.review?.kind ?? null,
      review_payload: hitlRequest.review,
      allowed_decisions: hitlRequest.allowed_decisions,
      status: "pending"
    })
  }
}
