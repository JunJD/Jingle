import type {
  Checkpoint,
  CheckpointMetadata,
  SerializerProtocol
} from "@langchain/langgraph-checkpoint"
import {
  handleJingleCheckpointAfterCommit,
  type JingleCheckpointCommittedEvent,
  type JingleHitlRequest
} from "@jingle/langchain-agent-harness/transitional"
import { appendAgentEventSafely } from "../db/agent-events"
import { upsertHitlRequest } from "../db/hitl"
import { parseToolApprovalItem } from "@shared/tool-approval"
import { PrismaCheckpointSaver } from "./prisma-saver"

type RuntimeCheckpointSaverOptions = {
  serde?: SerializerProtocol
}

export async function flushMessageSearchProjection(): Promise<void> {
  return
}

async function recordCheckpointCommitted(event: JingleCheckpointCommittedEvent): Promise<void> {
  await appendAgentEventSafely({
    checkpointId: event.checkpointId,
    payload: {
      checkpointId: event.checkpointId,
      checkpointNs: event.checkpointNs,
      metadataSource: event.metadataSource,
      step: event.step
    },
    runId: event.runId,
    threadId: event.threadId,
    type: "checkpoint.committed"
  })
}

async function upsertPendingHitlRequest(
  request: JingleHitlRequest<ReturnType<typeof parseToolApprovalItem>>,
  context: { runId: string | null; threadId: string }
): Promise<void> {
  await upsertHitlRequest({
    request_id: request.id,
    thread_id: context.threadId,
    run_id: context.runId,
    tool_call_id: request.tool_call.id,
    tool_name: request.tool_call.name,
    tool_args: request.tool_call.args,
    review_kind: request.review?.kind ?? null,
    review_payload: request.review,
    allowed_decisions: request.allowed_decisions,
    status: "pending"
  })
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
    await handleJingleCheckpointAfterCommit({
      checkpoint: input.checkpoint,
      checkpointNs: input.checkpointNs,
      metadata: input.metadata,
      parseReview: parseToolApprovalItem,
      recordCheckpointCommitted,
      runId: input.runId,
      threadId: input.threadId,
      upsertPendingHitlRequest
    })
  }
}
