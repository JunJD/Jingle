import { v4 as uuid } from "uuid"
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint"
import {
  cloneThread as dbCloneThread,
  cloneThreadUntilCheckpoint as dbCloneThreadUntilCheckpoint,
  createThread as dbCreateThread,
  deleteThread as dbDeleteThread,
  getAllThreads,
  getLatestHitlRequest,
  getLatestRun,
  getThread,
  hasPendingHitlRequest,
  updateThread as dbUpdateThread,
  type ThreadRow
} from "../db"
import { closeCheckpointer, getCheckpointer } from "../agent/runtime"
import {
  checkpointHasInterrupt,
  extractHitlRequestFromCheckpoint,
  extractMessagesFromCheckpoint,
  extractTodosFromCheckpoint,
  mapHitlRowToRequest
} from "../agent/runtime-state"
import { ThreadLifecycleGate } from "../agent/thread-lifecycle-gate"
import { ArtifactsService } from "../artifacts/service"
import type { ArtifactRecord } from "@shared/artifacts"
import { OpenworkIpcError } from "../ipc/error"
import { ModelProviderService } from "../model-provider/service"
import { SettingsService } from "../settings/service"
import { WorkspaceService } from "../workspace/service"
import { syncMessageSearchIndexFromSnapshot } from "../db/message-search"
import { formatDefaultThreadTitle } from "@shared/i18n"
import {
  toDisplayAssistantMessageContent,
  toDisplayUserMessageContent
} from "@shared/message-content"
import type {
  AgentThreadDataSnapshot,
  HITLRequest,
  Message,
  Thread,
  ThreadForkState,
  Todo,
  ThreadUpdateParams
} from "../types"

async function resolvePendingHitlRequest(
  latestHitl: Awaited<ReturnType<typeof getLatestHitlRequest>>
): Promise<HITLRequest | null> {
  if (!latestHitl || latestHitl.status !== "pending") {
    return null
  }

  return mapHitlRowToRequest(latestHitl)
}

function mapThreadRowToThread(row: ThreadRow, fallbackTitle?: string): Thread {
  return {
    thread_id: row.thread_id,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    status: row.status as Thread["status"],
    thread_values: row.thread_values ? JSON.parse(row.thread_values) : undefined,
    title: row.title ?? fallbackTitle
  }
}

function mapCheckpointMessagesToThreadMessages(
  checkpointMessages: ReturnType<typeof extractMessagesFromCheckpoint>
): Message[] {
  return checkpointMessages.map((row) => {
    let content: Message["content"] = ""
    let tool_calls: Message["tool_calls"] | undefined
    let metadata: Message["metadata"] | undefined

    try {
      content = JSON.parse(row.content) as Message["content"]
    } catch {
      content = row.content
    }

    if (row.tool_calls) {
      try {
        tool_calls = JSON.parse(row.tool_calls) as Message["tool_calls"]
      } catch {
        tool_calls = undefined
      }
    }

    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata) as Message["metadata"]
      } catch {
        metadata = undefined
      }
    }

    return {
      id: row.message_id,
      role: row.role as Message["role"],
      content:
        row.role === "user"
          ? toDisplayUserMessageContent(content, metadata)
          : row.role === "assistant"
            ? toDisplayAssistantMessageContent(content, {
                toolNames: tool_calls?.map((toolCall) => toolCall.name)
              })
            : content,
      tool_calls,
      metadata,
      ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
      ...(row.name ? { name: row.name } : {}),
      created_at: new Date(row.created_at)
    }
  })
}

function checkpointIncludesMessage(
  threadId: string,
  tuple: CheckpointTuple | undefined,
  messageId: string
): boolean {
  return extractMessagesFromCheckpoint(threadId, tuple).some(
    (message) => message.message_id === messageId
  )
}

async function computeThreadForkState(input: {
  checkpoint: CheckpointTuple | undefined
  thread: ThreadRow
  threadId: string
}): Promise<ThreadForkState> {
  if (input.thread.status === "busy") {
    return {
      canFork: false,
      reason: "busy"
    }
  }

  if (await hasPendingHitlRequest(input.threadId)) {
    return {
      canFork: false,
      reason: "pending_hitl"
    }
  }

  if (checkpointHasInterrupt(input.checkpoint)) {
    return {
      canFork: false,
      reason: "checkpoint_interrupt"
    }
  }

  return {
    canFork: true
  }
}

async function assertThreadCanFork(input: {
  channel: string
  checkpoint: CheckpointTuple | undefined
  thread: ThreadRow
  threadId: string
}): Promise<void> {
  const forkState = await computeThreadForkState(input)
  if (!forkState.canFork) {
    const message =
      forkState.reason === "busy"
        ? "Cannot fork a thread while it is running."
        : forkState.reason === "pending_hitl"
          ? "Cannot fork a thread while human approval is pending."
          : "Cannot fork from a message that is waiting for human approval."

    throw new OpenworkIpcError({
      channel: input.channel,
      code: "FAILED_PRECONDITION",
      message,
      details: forkState.reason ? [`reason: ${forkState.reason}`] : undefined
    })
  }
}

interface LoadedThreadRuntimeFacts {
  artifacts: ArtifactRecord[]
  checkpoint: CheckpointTuple | undefined
  forkState: ThreadForkState
  messages: Message[]
  pendingApproval: HITLRequest | null
  thread: Thread
  todos: Todo[]
}

export class ThreadsService {
  constructor(
    private readonly artifactsService: ArtifactsService,
    private readonly modelProviderService: ModelProviderService,
    private readonly settingsService: SettingsService,
    private readonly workspaceService: WorkspaceService,
    private readonly threadLifecycleGate = new ThreadLifecycleGate()
  ) {}

  async getLatestRunSummary(threadId: string): Promise<{
    error: string | null
    runId: string | null
  }> {
    const latestRun = await getLatestRun(threadId)
    if (!latestRun) {
      return {
        error: null,
        runId: null
      }
    }

    let error: string | null = null
    if (latestRun.metadata) {
      try {
        const metadata = JSON.parse(latestRun.metadata) as { error?: unknown }
        error = typeof metadata.error === "string" ? metadata.error : null
      } catch {
        error = null
      }
    }

    return {
      error,
      runId: latestRun.run_id
    }
  }

  private async loadThreadRuntimeFacts(threadId: string): Promise<LoadedThreadRuntimeFacts> {
    const [checkpointer, latestHitl, artifacts, row, thread] = await Promise.all([
      getCheckpointer(threadId),
      getLatestHitlRequest(threadId),
      this.artifactsService.list(threadId),
      getThread(threadId),
      this.get(threadId)
    ])
    if (!row || !thread) {
      throw new Error("Thread not found")
    }

    const checkpoint = await checkpointer.getTuple({
      configurable: {
        thread_id: threadId
      }
    })

    const messages = mapCheckpointMessagesToThreadMessages(
      extractMessagesFromCheckpoint(threadId, checkpoint)
    )
    const todos = extractTodosFromCheckpoint(checkpoint)
    const checkpointRequest = extractHitlRequestFromCheckpoint(threadId, checkpoint)
    const pendingApproval = await resolvePendingHitlRequest(latestHitl)
    const forkState = await computeThreadForkState({
      checkpoint,
      thread: row,
      threadId
    })

    return {
      artifacts,
      checkpoint,
      forkState,
      messages,
      pendingApproval: latestHitl ? pendingApproval : checkpointRequest,
      thread,
      todos
    }
  }

  async list(): Promise<Thread[]> {
    const threads = await getAllThreads()
    return threads.map((row) => mapThreadRowToThread(row))
  }

  async get(threadId: string): Promise<Thread | null> {
    const row = await getThread(threadId)
    return row ? mapThreadRowToThread(row) : null
  }

  async create(metadata?: Record<string, unknown>): Promise<Thread> {
    const threadId = uuid()
    const nextMetadata: Record<string, unknown> = {
      model: this.modelProviderService.getDefaultModel("llm"),
      workspacePath: await this.workspaceService.resolveGlobalWorkspacePath(),
      ...metadata
    }
    const requestedTitle = nextMetadata.title
    const title =
      typeof requestedTitle === "string" && requestedTitle.length > 0
        ? requestedTitle
        : formatDefaultThreadTitle(this.settingsService.getAgentConfig().locale)
    const { title: _ignoredTitle, ...threadMetadata } = nextMetadata
    void _ignoredTitle

    const thread = await dbCreateThread(threadId, {
      metadata: threadMetadata,
      title
    })

    return mapThreadRowToThread(thread, title)
  }

  async update(params: ThreadUpdateParams): Promise<Thread> {
    const updateData: Parameters<typeof dbUpdateThread>[1] = {}

    if (params.updates.title !== undefined) updateData.title = params.updates.title
    if (params.updates.status !== undefined) updateData.status = params.updates.status
    if (params.updates.metadata !== undefined)
      updateData.metadata = JSON.stringify(params.updates.metadata)
    if (params.updates.thread_values !== undefined)
      updateData.thread_values = JSON.stringify(params.updates.thread_values)

    const row = await dbUpdateThread(params.threadId, updateData)
    if (!row) throw new Error("Thread not found")

    return mapThreadRowToThread(row)
  }

  async clone(sourceThreadId: string): Promise<Thread> {
    const sourceThread = await getThread(sourceThreadId)
    if (!sourceThread) {
      throw new Error("Thread not found")
    }

    const sourceCheckpointer = await getCheckpointer(sourceThreadId)
    const sourceLatest = await sourceCheckpointer.getTuple({
      configurable: {
        thread_id: sourceThreadId
      }
    })
    await assertThreadCanFork({
      channel: "threads:clone",
      checkpoint: sourceLatest,
      thread: sourceThread,
      threadId: sourceThreadId
    })

    const threadId = uuid()
    const nextMetadata = sourceThread.metadata
      ? (JSON.parse(sourceThread.metadata) as Record<string, unknown>)
      : {}
    const clonedThread = await dbCloneThread(sourceThreadId, threadId, {
      metadata: nextMetadata,
      threadValues: sourceThread.thread_values
        ? (JSON.parse(sourceThread.thread_values) as Record<string, unknown>)
        : undefined,
      title: sourceThread.title
    })

    try {
      const checkpointer = await getCheckpointer(threadId)
      const latest = await checkpointer.getTuple({
        configurable: {
          thread_id: threadId
        }
      })

      await syncMessageSearchIndexFromSnapshot(
        threadId,
        extractMessagesFromCheckpoint(threadId, latest)
      )
    } catch (error) {
      console.warn("[Threads] Failed to sync cloned thread message search index:", error)
    }

    return mapThreadRowToThread(clonedThread)
  }

  async cloneUntilMessage(sourceThreadId: string, messageId: string): Promise<Thread> {
    const sourceThread = await getThread(sourceThreadId)
    if (!sourceThread) {
      throw new Error("Thread not found")
    }

    const checkpointer = await getCheckpointer(sourceThreadId)
    const latest = await checkpointer.getTuple({
      configurable: {
        thread_id: sourceThreadId
      }
    })
    await assertThreadCanFork({
      channel: "threads:cloneUntilMessage",
      checkpoint: latest,
      thread: sourceThread,
      threadId: sourceThreadId
    })

    if (!latest || !checkpointIncludesMessage(sourceThreadId, latest, messageId)) {
      throw new Error("Message not found")
    }

    let targetCheckpoint: CheckpointTuple = latest
    let cursor: CheckpointTuple = latest
    while (cursor.parentConfig) {
      const parent = await checkpointer.getTuple(cursor.parentConfig)
      if (!parent) {
        throw new Error("Checkpoint parent not found")
      }

      if (!checkpointIncludesMessage(sourceThreadId, parent, messageId)) {
        break
      }

      targetCheckpoint = parent
      cursor = parent
    }

    const targetCheckpointId = targetCheckpoint.config.configurable?.checkpoint_id
    if (!targetCheckpointId) {
      throw new Error("Checkpoint not found")
    }

    const threadId = uuid()
    const nextMetadata = sourceThread.metadata
      ? (JSON.parse(sourceThread.metadata) as Record<string, unknown>)
      : {}
    const clonedThread = await dbCloneThreadUntilCheckpoint(sourceThreadId, threadId, {
      checkpointId: targetCheckpointId,
      checkpointNs: targetCheckpoint.config.configurable?.checkpoint_ns,
      metadata: nextMetadata,
      threadValues: sourceThread.thread_values
        ? (JSON.parse(sourceThread.thread_values) as Record<string, unknown>)
        : undefined,
      title: sourceThread.title
    })

    try {
      const targetCheckpointer = await getCheckpointer(threadId)
      const clonedLatest = await targetCheckpointer.getTuple({
        configurable: {
          thread_id: threadId
        }
      })

      await syncMessageSearchIndexFromSnapshot(
        threadId,
        extractMessagesFromCheckpoint(threadId, clonedLatest)
      )
    } catch (error) {
      console.warn("[Threads] Failed to sync message-limited cloned thread search index:", error)
    }

    return mapThreadRowToThread(clonedThread)
  }

  async delete(threadId: string): Promise<void> {
    console.log("[Threads] Deleting thread:", threadId)

    await this.threadLifecycleGate.withDeletion(threadId, async () => {
      await closeCheckpointer(threadId)
      console.log("[Threads] Closed checkpointer")

      await dbDeleteThread(threadId)
      console.log("[Threads] Deleted from metadata store")
    })

    try {
      await this.artifactsService.deleteManagedFilesForThread(threadId)
      console.log("[Threads] Deleted managed artifacts")
    } catch (e) {
      console.warn("[Threads] Failed to delete managed artifacts:", e)
    }
  }

  async getPersistedAgentThreadData(threadId: string): Promise<AgentThreadDataSnapshot> {
    const [facts, latestRun] = await Promise.all([
      this.loadThreadRuntimeFacts(threadId),
      this.getLatestRunSummary(threadId)
    ])

    return {
      thread: facts.thread,
      messages: {
        artifacts: facts.artifacts,
        messages: facts.messages
      },
      runState: {
        forkState: facts.forkState,
        pendingApproval: facts.pendingApproval,
        todos: facts.todos,
        error: latestRun.error,
        runId: latestRun.runId
      }
    }
  }

  async getAgentThreadData(threadId: string): Promise<AgentThreadDataSnapshot> {
    return this.getPersistedAgentThreadData(threadId)
  }
}
