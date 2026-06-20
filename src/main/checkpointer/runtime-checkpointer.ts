import type {
  Checkpoint,
  CheckpointMetadata,
  CheckpointTuple,
  SerializerProtocol
} from "@langchain/langgraph-checkpoint"
import { extractHitlRequestFromCheckpoint } from "../agent/runtime-state"
import { appendAgentEventSafely } from "../db/agent-events"
import { upsertHitlRequest } from "../db/hitl"
import { PrismaCheckpointSaver } from "./prisma-saver"

type RuntimeCheckpointSaverOptions = {
  serde?: SerializerProtocol
}

export async function flushMessageSearchProjection(): Promise<void> {
  return
}

export class RuntimeCheckpointSaver extends PrismaCheckpointSaver {
  constructor(options: RuntimeCheckpointSaverOptions = {}) {
    super(options.serde)
  }

  protected override async afterPut(input: {
    checkpoint: Checkpoint
    checkpointNs: string
    metadata: CheckpointMetadata
    runId: string | null
    threadId: string
  }): Promise<void> {
    if (input.runId) {
      const metadataSource =
        typeof input.metadata.source === "string" ? input.metadata.source : null
      await appendAgentEventSafely({
        checkpointId: input.checkpoint.id,
        payload: {
          checkpointId: input.checkpoint.id,
          checkpointNs: input.checkpointNs,
          metadataSource,
          step: input.metadata.step ?? null
        },
        runId: input.runId,
        threadId: input.threadId,
        type: "checkpoint.committed"
      })
    }

    const tuple = {
      checkpoint: input.checkpoint,
      metadata: input.metadata
    } as CheckpointTuple
    const hitlRequest = extractHitlRequestFromCheckpoint(input.threadId, tuple, {
      runId: input.runId
    })
    if (hitlRequest) {
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
}
