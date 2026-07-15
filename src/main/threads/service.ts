import { v4 as uuid } from "uuid"
import {
  buildJingleCheckpointLookupConfig,
  findEarliestJingleLangGraphCheckpointContainingMessage,
  readJingleLangGraphCheckpointConfig
} from "@jingle/langchain-agent-harness/transitional"
import {
  cloneThread as dbCloneThread,
  cloneThreadUntilCheckpoint as dbCloneThreadUntilCheckpoint,
  createThread as dbCreateThread,
  deleteThread as dbDeleteThread,
  getActiveThreads,
  getArchivedThreads,
  getThread,
  setThreadArchived as dbSetThreadArchived,
  updateThread as dbUpdateThread,
  updateThreadMetadata,
  type ThreadRow
} from "../db/threads"
import {
  getLatestHitlRequest,
  hasPendingHitlRequest
} from "../db/hitl"
import { getLatestRun } from "../db/runs"
import {
  getProjects,
  getThreadWorkspaceBindings,
  mapProjectRecord,
  mapThreadWorkspaceBindingRecord
} from "../db/thread-workspace"
import {
  checkpointMessageStateIncludesMessage,
  listProjectedThreadMessages,
  type MessageProjectionRow
} from "../db/message-state"
import {
  closeCheckpointer,
  getCheckpointer
} from "../checkpointer/runtime-checkpointer-manager"
import {
  type JingleCheckpointProjectionSource,
  extractThreadFactsFromCheckpoint,
  mapHitlRowToRequest
} from "../agent/runtime-state"
import { ThreadLifecycleGate } from "../agent/thread-lifecycle-gate"
import { ArtifactsService } from "../artifacts/service"
import type { ArtifactRecord } from "@shared/artifacts"
import { JingleIpcError } from "../ipc/error"
import { ModelProviderService } from "../model-provider/service"
import { SettingsService } from "../settings/service"
import { ThreadWorkspaceService } from "../thread-workspace/service"
import { ThreadWorkflowService } from "../thread-workflow/service"
import { WorkspaceService } from "../workspace/service"
import { rebuildMessageSearchIndexFromMessages } from "../db/message-search"
import { formatDefaultThreadTitle } from "@shared/i18n"
import {
  toDisplayAssistantMessageContent,
  toDisplayUserMessageContent
} from "@shared/message-content"
import { THREAD_PINNED_METADATA_KEY } from "@shared/thread-sidebar"
import type { ArchivedThreadItem, ArchivedThreadsView } from "@shared/thread-archive"
import {
  buildProvidedContextInclusions,
  readJingleMemoryContextSnapshotFromMetadata,
  type AgentContextInclusion,
  type JingleMemoryContextSnapshot
} from "@shared/jingle-memory"
import type {
  AgentThreadDataSnapshot,
  CreateThreadInput,
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
    archived_at: row.archived_at === null ? null : new Date(row.archived_at),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    status: row.status as Thread["status"],
    thread_values: row.thread_values ? JSON.parse(row.thread_values) : undefined,
    title: row.title ?? fallbackTitle
  }
}

function readJingleMemoryContextSnapshot(
  metadata: Record<string, unknown> | null
): JingleMemoryContextSnapshot | null {
  return readJingleMemoryContextSnapshotFromMetadata(metadata)
}

function buildPersistedContextInclusions(input: {
  metadata: Record<string, unknown> | null
  runId: string | null
  threadId: string
}) {
  if (!input.runId) {
    return []
  }

  const snapshot = readJingleMemoryContextSnapshot(input.metadata)
  if (!snapshot) {
    return []
  }

  return buildProvidedContextInclusions({
    contextPack: snapshot,
    runId: input.runId,
    threadId: input.threadId
  })
}

function resolveArchivedAt(thread: ThreadRow): Date {
  if (thread.archived_at === null) {
    throw new Error(`Archived thread ${thread.thread_id} is missing archived_at.`)
  }

  return new Date(thread.archived_at)
}

function mapProjectedMessagesToThreadMessages(
  projectedMessages: MessageProjectionRow[]
): Message[] {
  return projectedMessages.map((row) => {
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
            ? toDisplayAssistantMessageContent(content)
            : content,
      tool_calls,
      metadata,
      ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
      ...(row.name ? { name: row.name } : {}),
      created_at: new Date(row.created_at)
    }
  })
}

async function computeThreadForkState(input: {
  checkpointHasInterrupt: boolean
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

  if (input.checkpointHasInterrupt) {
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
  checkpoint: JingleCheckpointProjectionSource
  thread: ThreadRow
  threadId: string
}): Promise<void> {
  const forkState = await computeThreadForkState({
    checkpointHasInterrupt: extractThreadFactsFromCheckpoint(
      input.threadId,
      input.checkpoint
    ).hasInterrupt,
    thread: input.thread,
    threadId: input.threadId
  })
  if (!forkState.canFork) {
    const message =
      forkState.reason === "busy"
        ? "Cannot fork a thread while it is running."
        : forkState.reason === "pending_hitl"
          ? "Cannot fork a thread while human approval is pending."
          : "Cannot fork from a message that is waiting for human approval."

    throw new JingleIpcError({
      channel: input.channel,
      code: "FAILED_PRECONDITION",
      message,
      details: forkState.reason ? [`reason: ${forkState.reason}`] : undefined
    })
  }
}

interface LoadedThreadRuntimeFacts {
  artifacts: ArtifactRecord[]
  contextInclusions: AgentContextInclusion[]
  forkState: ThreadForkState
  messages: Message[]
  pendingApproval: HITLRequest | null
  thread: Thread
  todos: Todo[]
}

type ResolvedCreateThreadWorkspace =
  | {
      workspaceKind: "project"
      workspacePath: string
    }
  | {
      workspaceKind: "projectless"
      workspacePath: string
    }

export class ThreadsService {
  constructor(
    private readonly artifactsService: ArtifactsService,
    private readonly modelProviderService: ModelProviderService,
    private readonly settingsService: SettingsService,
    private readonly workspaceService: WorkspaceService,
    private readonly threadWorkspaceService: ThreadWorkspaceService,
    private readonly threadLifecycleGate = new ThreadLifecycleGate(),
    private readonly threadWorkflowService = new ThreadWorkflowService()
  ) {}

  async getLatestRunSummary(threadId: string): Promise<{
    error: string | null
    metadata: Record<string, unknown> | null
    runId: string | null
  }> {
    const latestRun = await getLatestRun(threadId)
    if (!latestRun) {
      return {
        error: null,
        metadata: null,
        runId: null
      }
    }

    let error: string | null = null
    let metadata: Record<string, unknown> | null = null
    if (latestRun.metadata) {
      try {
        metadata = JSON.parse(latestRun.metadata) as Record<string, unknown>
        error = typeof metadata.error === "string" ? metadata.error : null
      } catch {
        error = null
        metadata = null
      }
    }

    return {
      error,
      metadata,
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

    const checkpoint = await checkpointer.getTuple(
      buildJingleCheckpointLookupConfig({
        threadId
      })
    )

    const checkpointFacts = extractThreadFactsFromCheckpoint(threadId, checkpoint)
    const [messages, pendingApproval, forkState] = await Promise.all([
      listProjectedThreadMessages(threadId).then(mapProjectedMessagesToThreadMessages),
      resolvePendingHitlRequest(latestHitl),
      computeThreadForkState({
        checkpointHasInterrupt: checkpointFacts.hasInterrupt,
        thread: row,
        threadId
      })
    ])

    return {
      artifacts,
      contextInclusions: checkpointFacts.contextInclusions,
      forkState,
      messages,
      pendingApproval: latestHitl ? pendingApproval : checkpointFacts.hitlRequest,
      thread,
      todos: checkpointFacts.todos
    }
  }

  private async cloneThreadWorkspaceBinding(
    sourceThreadId: string,
    targetThreadId: string
  ): Promise<void> {
    const sourceBinding = await this.threadWorkspaceService.get(sourceThreadId)
    if (!sourceBinding?.workspacePath) {
      throw new Error("Thread workspace path is missing.")
    }

    if (sourceBinding.workspaceKind === "projectless") {
      await this.threadWorkspaceService.markProjectless(targetThreadId, sourceBinding.workspacePath)
      return
    }

    await this.threadWorkspaceService.bindProject(targetThreadId, sourceBinding.workspacePath)
  }

  async list(): Promise<Thread[]> {
    const threads = await getActiveThreads()
    return threads.map((row) => mapThreadRowToThread(row))
  }

  async listArchivedView(): Promise<ArchivedThreadsView> {
    const threads = await getArchivedThreads()
    const [projectRows, bindingRows] = await Promise.all([
      getProjects(),
      getThreadWorkspaceBindings(threads.map((thread) => thread.thread_id))
    ])
    const bindings = new Map(
      bindingRows.map((binding) => [binding.thread_id, mapThreadWorkspaceBindingRecord(binding)])
    )

    return {
      projects: projectRows.map(mapProjectRecord),
      threads: threads.map((thread): ArchivedThreadItem => {
        const binding = bindings.get(thread.thread_id) ?? null
        const title = thread.title?.trim() || "New Chat"

        return {
          archivedAt: resolveArchivedAt(thread),
          createdAt: new Date(thread.created_at),
          projectId: binding?.projectId ?? null,
          threadId: thread.thread_id,
          title,
          updatedAt: new Date(thread.updated_at),
          workspaceKind: binding?.workspaceKind ?? "projectless",
          workspacePath: binding?.workspacePath ?? null
        }
      })
    }
  }

  async get(threadId: string): Promise<Thread | null> {
    const row = await getThread(threadId)
    return row ? mapThreadRowToThread(row) : null
  }

  private async resolveCreateThreadWorkspacePath(input?: CreateThreadInput): Promise<string> {
    const workspacePath =
      input && "workspacePath" in input && input.workspacePath !== undefined
        ? input.workspacePath
        : await this.workspaceService.resolveGlobalWorkspacePath()

    if (workspacePath === null) {
      throw new Error("No workspace root folder linked.")
    }

    if (workspacePath.trim().length === 0) {
      throw new Error("Workspace path cannot be empty.")
    }

    return workspacePath
  }

  private async resolveCreateThreadWorkspace(
    input?: CreateThreadInput
  ): Promise<ResolvedCreateThreadWorkspace> {
    const workspaceKind = input?.workspaceKind ?? "projectless"
    const workspacePath = await this.resolveCreateThreadWorkspacePath(input)

    if (workspaceKind === "project") {
      return {
        workspaceKind,
        workspacePath
      }
    }

    return {
      workspaceKind,
      workspacePath
    }
  }

  async create(input?: CreateThreadInput): Promise<Thread> {
    const threadId = uuid()
    if (input?.workflow && input.workspaceKind !== "project") {
      throw new Error("A classified thread workflow requires workspaceKind=project.")
    }
    const { workspaceKind, workspacePath } = await this.resolveCreateThreadWorkspace(input)
    const nextMetadata: Record<string, unknown> = {
      model: this.modelProviderService.getDefaultModel("llm"),
      ...input?.metadata
    }
    const requestedTitle = nextMetadata.title
    const title =
      typeof requestedTitle === "string" && requestedTitle.length > 0
        ? requestedTitle
        : formatDefaultThreadTitle(this.settingsService.getAgentConfig().locale)
    const { title: _ignoredTitle, ...threadMetadata } = nextMetadata
    void _ignoredTitle

    if (input?.workflow) {
      const project = await this.threadWorkspaceService.addProject(workspacePath)
      const thread = await this.threadWorkflowService.createClassifiedThread({
        metadata: threadMetadata,
        project: {
          canonicalWorkspacePath: project.canonicalWorkspacePath,
          projectId: project.projectId,
          workspaceKey: project.workspaceKey
        },
        threadId,
        title,
        workflow: input.workflow
      })
      return mapThreadRowToThread(thread, title)
    }

    const thread = await dbCreateThread(threadId, {
      metadata: threadMetadata,
      title
    })
    if (workspaceKind === "project") {
      await this.threadWorkspaceService.bindProject(threadId, workspacePath)
    } else {
      await this.threadWorkspaceService.markProjectless(threadId, workspacePath)
    }

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

  async setPinned(threadId: string, pinned: boolean): Promise<Thread> {
    const row = await getThread(threadId)
    if (!row) {
      throw new Error("Thread not found")
    }

    const metadata = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {}
    const nextMetadata = { ...metadata }
    if (pinned) {
      nextMetadata[THREAD_PINNED_METADATA_KEY] = true
    } else {
      delete nextMetadata[THREAD_PINNED_METADATA_KEY]
    }

    const updated = await updateThreadMetadata(threadId, nextMetadata)
    return mapThreadRowToThread(updated)
  }

  async setArchived(threadId: string, archived: boolean): Promise<Thread> {
    const updated = await dbSetThreadArchived(threadId, archived)
    return mapThreadRowToThread(updated)
  }

  async clone(sourceThreadId: string): Promise<Thread> {
    const sourceThread = await getThread(sourceThreadId)
    if (!sourceThread) {
      throw new Error("Thread not found")
    }

    const sourceCheckpointer = await getCheckpointer(sourceThreadId)
    const sourceLatest = await sourceCheckpointer.getTuple(
      buildJingleCheckpointLookupConfig({
        threadId: sourceThreadId
      })
    )
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
    await this.cloneThreadWorkspaceBinding(sourceThreadId, threadId)

    try {
      await rebuildMessageSearchIndexFromMessages(threadId)
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
    const latest = await checkpointer.getTuple(
      buildJingleCheckpointLookupConfig({
        threadId: sourceThreadId
      })
    )
    await assertThreadCanFork({
      channel: "threads:cloneUntilMessage",
      checkpoint: latest,
      thread: sourceThread,
      threadId: sourceThreadId
    })

    const sourceMessages = await listProjectedThreadMessages(sourceThreadId)
    const targetMessage = sourceMessages.find((message) => message.message_id === messageId)

    if (!latest || !targetMessage) {
      throw new Error("Message not found")
    }

    const targetCheckpoint = await findEarliestJingleLangGraphCheckpointContainingMessage({
      latest,
      messageId,
      messageStateIncludesMessage: ({ checkpointNs, messageId, threadId, version }) =>
        checkpointMessageStateIncludesMessage({
          checkpointNs,
          messageId,
          threadId,
          version
        }),
      readCheckpoint: (config) => checkpointer.getTuple(config),
      threadId: sourceThreadId
    })
    if (!targetCheckpoint) {
      throw new Error("Message not found")
    }

    const targetConfig = readJingleLangGraphCheckpointConfig(targetCheckpoint)
    if (!targetConfig.checkpointId) {
      throw new Error("Checkpoint not found")
    }

    const threadId = uuid()
    const nextMetadata = sourceThread.metadata
      ? (JSON.parse(sourceThread.metadata) as Record<string, unknown>)
      : {}
    const clonedThread = await dbCloneThreadUntilCheckpoint(sourceThreadId, threadId, {
      checkpointId: targetConfig.checkpointId,
      checkpointNs: targetConfig.checkpointNs,
      metadata: nextMetadata,
      threadValues: sourceThread.thread_values
        ? (JSON.parse(sourceThread.thread_values) as Record<string, unknown>)
        : undefined,
      title: sourceThread.title
    })
    await this.cloneThreadWorkspaceBinding(sourceThreadId, threadId)

    try {
      await rebuildMessageSearchIndexFromMessages(threadId)
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
    const [facts, latestRun, workspacePath] = await Promise.all([
      this.loadThreadRuntimeFacts(threadId),
      this.getLatestRunSummary(threadId),
      this.threadWorkspaceService.getThreadWorkspacePath(threadId)
    ])

    return {
      thread: facts.thread,
      messages: {
        artifacts: facts.artifacts,
        messages: facts.messages
      },
      runState: {
        contextInclusions:
          facts.contextInclusions.length > 0
            ? facts.contextInclusions
            : buildPersistedContextInclusions({
                metadata: latestRun.metadata,
                runId: latestRun.runId,
                threadId
              }),
        forkState: facts.forkState,
        pendingApproval: facts.pendingApproval,
        todos: facts.todos,
        error: latestRun.error,
        runId: latestRun.runId,
        workspacePath
      }
    }
  }

  async getAgentThreadData(threadId: string): Promise<AgentThreadDataSnapshot> {
    return this.getPersistedAgentThreadData(threadId)
  }
}
