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
import {
  findMessageSearchProjectionDriftThreadIds,
  rebuildMessageSearchIndexFromMessages,
  syncMessageSearchIndexEntriesFromMessages
} from "../db/message-search"
import type { MessageSearchProjectionDelta } from "../db/message-state"
import { createProjectionQueue } from "../projection/projection-queue"
import { parseToolApprovalItem } from "@shared/tool-approval"
import { PrismaCheckpointSaver } from "./prisma-saver"

const MESSAGE_SEARCH_FULL_REBUILD_THRESHOLD = 128
type PendingMessageSearchProjection =
  | { kind: "full" }
  | { kind: "messages"; messageIds: Set<string> }

export interface MessageSearchProjectionCoordinator {
  enqueueDelta(threadId: string, delta: MessageSearchProjectionDelta): void
  enqueueFull(threadId: string): void
  flush(): Promise<void>
  startRecovery(): Promise<void>
}

interface CreateMessageSearchProjectionCoordinatorOptions {
  findDriftThreadIds?: () => Promise<string[]>
  rebuildThread?: (threadId: string) => Promise<void>
  syncEntries?: (input: { messageIds: readonly string[]; threadId: string }) => Promise<void>
}

export function createMessageSearchProjectionCoordinator(
  options: CreateMessageSearchProjectionCoordinatorOptions = {}
): MessageSearchProjectionCoordinator {
  const findDriftThreadIds = options.findDriftThreadIds ?? findMessageSearchProjectionDriftThreadIds
  const rebuildThread = options.rebuildThread ?? rebuildMessageSearchIndexFromMessages
  const syncEntries = options.syncEntries ?? syncMessageSearchIndexEntriesFromMessages
  const pending = new Map<string, PendingMessageSearchProjection>()
  const queue = createProjectionQueue<string>({
    debounceMs: 50,
    getKey: (threadId) => threadId,
    maxConcurrency: 1,
    name: "MessageSearchProjector",
    run: async (threadId) => {
      const projection = pending.get(threadId)
      pending.delete(threadId)
      if (!projection) return
      if (projection.kind === "full") {
        await rebuildThread(threadId)
        return
      }
      await syncEntries({
        messageIds: Array.from(projection.messageIds),
        threadId
      })
    }
  })
  let recoveryTask: Promise<void> | null = null

  const coordinator: MessageSearchProjectionCoordinator = {
    enqueueDelta(threadId, delta) {
      if (delta.messageIds.length === 0) return
      const current = pending.get(threadId)
      if (current?.kind === "full") return
      const messageIds = current?.messageIds ?? new Set<string>()
      for (const messageId of delta.messageIds) messageIds.add(messageId)
      pending.set(
        threadId,
        messageIds.size > MESSAGE_SEARCH_FULL_REBUILD_THRESHOLD
          ? { kind: "full" }
          : { kind: "messages", messageIds }
      )
      queue.enqueue(threadId)
    },
    enqueueFull(threadId) {
      pending.set(threadId, { kind: "full" })
      queue.enqueue(threadId)
    },
    async flush() {
      await recoveryTask
      await queue.flush()
    },
    startRecovery() {
      if (recoveryTask) return recoveryTask
      recoveryTask = (async () => {
        try {
          const threadIds = await findDriftThreadIds()
          for (const threadId of threadIds) coordinator.enqueueFull(threadId)
        } catch (error) {
          console.warn(
            "[MessageSearchProjector] Failed to inspect startup projection drift.",
            error
          )
        }
      })().finally(() => {
        recoveryTask = null
      })
      return recoveryTask
    }
  }
  return coordinator
}

const messageSearchProjectionCoordinator = createMessageSearchProjectionCoordinator()

type RuntimeCheckpointSaverOptions = {
  messageSearchProjectionCoordinator?: MessageSearchProjectionCoordinator
  serde?: SerializerProtocol
}

export function enqueueMessageSearchProjection(threadId: string): void {
  messageSearchProjectionCoordinator.enqueueFull(threadId)
}

export function startMessageSearchProjectionLifecycle(): Promise<void> {
  return messageSearchProjectionCoordinator.startRecovery()
}

export async function flushMessageSearchProjection(): Promise<void> {
  await messageSearchProjectionCoordinator.flush()
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
  private readonly messageSearchProjectionCoordinator: MessageSearchProjectionCoordinator

  constructor(options: RuntimeCheckpointSaverOptions = {}) {
    super(options.serde)
    this.messageSearchProjectionCoordinator =
      options.messageSearchProjectionCoordinator ?? messageSearchProjectionCoordinator
  }

  protected override async afterPut(input: {
    checkpoint: Checkpoint
    checkpointNs: string
    messageSearchProjectionDelta: MessageSearchProjectionDelta
    metadata: CheckpointMetadata
    runId: string | null
    threadId: string
  }): Promise<void> {
    this.messageSearchProjectionCoordinator.enqueueDelta(
      input.threadId,
      input.messageSearchProjectionDelta
    )
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
