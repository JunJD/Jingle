import { v4 as uuid } from "uuid"
import {
  buildJingleCheckpointLookupConfig,
  findEarliestJingleLangGraphCheckpointContainingMessage,
  readJingleLangGraphCheckpointConfig
} from "@jingle/langchain-agent-harness/transitional"
import type { RuntimeApproval } from "@jingle/langchain-agent-harness"
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
import { getLatestPendingHitlRequest, hasPendingHitlRequest } from "../db/hitl"
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
import { listUserMessageCreatedAgentEvents, type AgentEventRow } from "../db/agent-events"
import { closeCheckpointer, getCheckpointer } from "../checkpointer/runtime-checkpointer-manager"
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
import { requirePersistedModelRuntimeSelectionSnapshot } from "../model-provider/runtime-selection-admission"
import { SettingsService } from "../settings/service"
import { ThreadWorkspaceService } from "../thread-workspace/service"
import { ThreadWorkflowService } from "../thread-workflow/service"
import { ThreadDigestService } from "../thread-digest/service"
import { WorkspaceService } from "../workspace/service"
import { rebuildMessageSearchIndexFromMessages } from "../db/message-search"
import { formatDefaultThreadTitle } from "@shared/i18n"
import {
  normalizeComposerMessageRefs,
  toComposerMessageMetadata,
  toDisplayAssistantMessageContent,
  toDisplayMessageContent,
  parsePersistedMessageContent,
  toDisplayUserMessageContent,
  toMessageContent
} from "@shared/message-content"
import { parseAgentEventPayloadFromJson } from "../agent-events/schema"
import { THREAD_PINNED_METADATA_KEY } from "@shared/thread-sidebar"
import {
  MODEL_RUNTIME_SELECTION_METADATA_KEY,
  MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY,
  readThreadModelRuntimeSelection,
  readThreadModelRuntimeSelectionRevision,
  withThreadModelRuntimeSelection
} from "@shared/model-runtime-selection"
import type {
  ModelRuntimeSelection,
  ThreadModelRuntimeSelectionChangedEvent
} from "@shared/app-types"
import type { ArchivedThreadItem, ArchivedThreadsView } from "@shared/thread-archive"
import {
  buildProvidedContextInclusions,
  readJingleMemoryContextSnapshotFromMetadata,
  type AgentContextInclusion,
  type JingleMemoryContextSnapshot
} from "@shared/jingle-memory"
import {
  AGENT_RUN_FAILURE_METADATA_KEY,
  createLegacyAgentRunFailure,
  parseAgentRunFailure,
  type AgentRunFailure
} from "@shared/agent-run-failure"
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

function isFailureBearingRunStatus(status: string | null): boolean {
  return status === "error" || status === "interrupted"
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
    const role =
      row.role === "tool"
        ? "tool"
        : row.role === "system"
          ? "system"
          : row.role === "assistant"
            ? "assistant"
            : "user"
    const content = parsePersistedMessageContent(row.content, {
      role,
      ...(row.tool_call_id ? { toolCallId: row.tool_call_id } : {}),
      onInvalid: (reason) => {
        console.warn("[Threads] Invalid persisted message content.", {
          messageId: row.message_id,
          reason,
          threadId: row.thread_id
        })
      }
    })
    let tool_calls: Message["tool_calls"] | undefined
    let metadata: Message["metadata"] | undefined

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
      role,
      content:
        row.role === "user"
          ? toDisplayUserMessageContent(content, metadata)
          : row.role === "assistant"
            ? toDisplayAssistantMessageContent(content)
            : toDisplayMessageContent(content, {
                role: row.role === "tool" ? "tool" : "system",
                ...(row.tool_call_id ? { toolCallId: row.tool_call_id } : {})
              }),
      tool_calls,
      metadata,
      ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
      ...(row.name ? { name: row.name } : {}),
      created_at: new Date(row.created_at)
    }
  })
}

function mergeDurableUserMessageEvents(messages: Message[], events: AgentEventRow[]): Message[] {
  const admissionSequences = new Set<number>()
  const pendingAdmissions: Array<{
    composerText: string
    createdAt: number
    messageId: string
    refs: ReturnType<typeof normalizeComposerMessageRefs>
    removeMessageIds: string[]
    sequence: number
  }> = []

  for (const event of events) {
    const payload = parseAgentEventPayloadFromJson(event.type, event.payload)
    if (
      typeof payload.admissionSequence !== "number" ||
      typeof payload.composerText !== "string" ||
      typeof payload.userMessageId !== "string" ||
      !Array.isArray(payload.refs) ||
      !event.run_id ||
      event.checkpoint_id !== null
    ) {
      continue
    }
    if (admissionSequences.has(payload.admissionSequence)) {
      throw new Error(
        `[Threads] Duplicate durable user message admission sequence "${payload.admissionSequence}".`
      )
    }
    admissionSequences.add(payload.admissionSequence)
    const refs = normalizeComposerMessageRefs(payload.refs)
    if (refs.length !== payload.refs.length) {
      throw new Error(
        `[Threads] Durable user message "${payload.userMessageId}" has invalid composer refs.`
      )
    }
    const rawRemoveMessageIds = payload.removeMessageIds
    const removeMessageIds = Array.isArray(rawRemoveMessageIds)
      ? rawRemoveMessageIds.filter(
          (messageId): messageId is string => typeof messageId === "string"
        )
      : []
    if (
      (Array.isArray(rawRemoveMessageIds) &&
        removeMessageIds.length !== rawRemoveMessageIds.length) ||
      removeMessageIds.some((messageId) => !messageId)
    ) {
      throw new Error(
        `[Threads] Durable user message "${payload.userMessageId}" has invalid removals.`
      )
    }
    pendingAdmissions.push({
      composerText: payload.composerText,
      createdAt: event.created_at,
      messageId: payload.userMessageId,
      refs,
      removeMessageIds,
      sequence: payload.admissionSequence
    })
  }

  let merged = [...messages]
  for (const admission of pendingAdmissions.toSorted(
    (left, right) => left.sequence - right.sequence
  )) {
    const removedMessageIds = new Set(admission.removeMessageIds)
    merged = merged.filter(
      (message) => message.id !== admission.messageId && !removedMessageIds.has(message.id)
    )
    const metadata = toComposerMessageMetadata({
      refs: admission.refs,
      text: admission.composerText
    })
    merged.push({
      content: toMessageContent({ refs: admission.refs, text: admission.composerText }),
      created_at: new Date(admission.createdAt),
      id: admission.messageId,
      ...(metadata ? { metadata } : {}),
      role: "user"
    })
  }

  return merged.toSorted((left, right) => left.created_at.getTime() - right.created_at.getTime())
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
    checkpointHasInterrupt: extractThreadFactsFromCheckpoint(input.threadId, input.checkpoint)
      .hasInterrupt,
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
  approvals: RuntimeApproval[]
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
  private readonly metadataMutationQueues = new Map<string, Promise<void>>()
  private readonly modelRuntimeSelectionChangedListeners = new Set<
    (event: ThreadModelRuntimeSelectionChangedEvent) => void
  >()

  constructor(
    private readonly artifactsService: ArtifactsService,
    private readonly modelProviderService: ModelProviderService,
    private readonly settingsService: SettingsService,
    private readonly workspaceService: WorkspaceService,
    private readonly threadWorkspaceService: ThreadWorkspaceService,
    private readonly threadDigestService: ThreadDigestService,
    private readonly threadLifecycleGate = new ThreadLifecycleGate(),
    private readonly threadWorkflowService = new ThreadWorkflowService()
  ) {}

  onModelRuntimeSelectionChanged(
    listener: (event: ThreadModelRuntimeSelectionChangedEvent) => void
  ): () => void {
    this.modelRuntimeSelectionChangedListeners.add(listener)
    return () => this.modelRuntimeSelectionChangedListeners.delete(listener)
  }

  async getLatestRunSummary(threadId: string): Promise<{
    error: AgentRunFailure | null
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

    let error: AgentRunFailure | null = null
    let metadata: Record<string, unknown> | null = null
    if (latestRun.metadata) {
      try {
        metadata = JSON.parse(latestRun.metadata) as Record<string, unknown>
      } catch {
        metadata = null
      }
      const canHydrateFailure = isFailureBearingRunStatus(latestRun.status)
      if (metadata && Object.hasOwn(metadata, AGENT_RUN_FAILURE_METADATA_KEY)) {
        const canonicalFailure = parseAgentRunFailure(metadata[AGENT_RUN_FAILURE_METADATA_KEY])
        if (!canonicalFailure) {
          throw new Error(`Run ${latestRun.run_id} has an invalid agent run failure.`)
        }
        error = canHydrateFailure ? canonicalFailure : null
      } else if (canHydrateFailure && metadata && typeof metadata.error === "string") {
        error = createLegacyAgentRunFailure(metadata.error)
      }
    }

    return {
      error,
      metadata,
      runId: latestRun.run_id
    }
  }

  private async loadThreadRuntimeFacts(threadId: string): Promise<LoadedThreadRuntimeFacts> {
    const [checkpointer, latestPendingHitl, artifacts, row, thread, userMessageEvents] =
      await Promise.all([
        getCheckpointer(threadId),
        getLatestPendingHitlRequest(threadId),
        this.artifactsService.list(threadId),
        getThread(threadId),
        this.get(threadId),
        listUserMessageCreatedAgentEvents(threadId)
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
    const [projectedMessages, forkState] = await Promise.all([
      listProjectedThreadMessages(threadId).then(mapProjectedMessagesToThreadMessages),
      computeThreadForkState({
        checkpointHasInterrupt: checkpointFacts.hasInterrupt,
        thread: row,
        threadId
      })
    ])
    const messages = mergeDurableUserMessageEvents(projectedMessages, userMessageEvents)

    return {
      approvals: checkpointFacts.approvals,
      artifacts,
      contextInclusions: checkpointFacts.contextInclusions,
      forkState,
      messages,
      pendingApproval: latestPendingHitl
        ? mapHitlRowToRequest(latestPendingHitl)
        : checkpointFacts.hitlRequest,
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

  private async resolveCreateThreadWorkspacePath(
    input: CreateThreadInput | undefined,
    title: string
  ): Promise<string> {
    if (input?.createDefaultWorkspace && input.workspacePath !== undefined) {
      throw new Error("A default workspace cannot be created with an explicit workspace path.")
    }
    const workspacePath =
      input && "workspacePath" in input && input.workspacePath !== undefined
        ? input.workspacePath
        : input?.createDefaultWorkspace
          ? await this.workspaceService.createDefaultWorkspace({ title })
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
    input: CreateThreadInput | undefined,
    title: string
  ): Promise<ResolvedCreateThreadWorkspace> {
    const workspaceKind = input?.workspaceKind ?? "projectless"
    const workspacePath = await this.resolveCreateThreadWorkspacePath(input, title)

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
    assertMetadataDoesNotOwnModelRuntimeSelection("threads:create", input?.metadata)
    const runtimeSelection = this.resolveThreadModelRuntimeSelection({
      channel: "threads:create",
      selection: input?.modelRuntimeSelection
    })
    const threadSelection = withThreadModelRuntimeSelection(input?.metadata, runtimeSelection)
    const nextMetadata = threadSelection.metadata
    const requestedTitle = nextMetadata.title
    const title =
      typeof requestedTitle === "string" && requestedTitle.length > 0
        ? requestedTitle
        : formatDefaultThreadTitle(this.settingsService.getAgentConfig().locale)
    const { workspaceKind, workspacePath } = await this.resolveCreateThreadWorkspace(input, title)
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
    if (params.updates.metadata !== undefined) {
      const metadataPatch = requireMetadataPatch("threads:update", params.updates.metadata)
      return this.withThreadMetadataMutation(params.threadId, async (current) => {
        const updateData: Parameters<typeof dbUpdateThread>[1] = {
          metadata: JSON.stringify({
            ...(current.metadata ? (JSON.parse(current.metadata) as Record<string, unknown>) : {}),
            ...metadataPatch
          })
        }
        if (params.updates.title !== undefined) updateData.title = params.updates.title
        if (params.updates.status !== undefined) updateData.status = params.updates.status
        if (params.updates.thread_values !== undefined)
          updateData.thread_values = JSON.stringify(params.updates.thread_values)
        const row = await dbUpdateThread(params.threadId, updateData)
        if (!row) throw new Error("Thread not found")
        return mapThreadRowToThread(row)
      })
    }

    const updateData: Parameters<typeof dbUpdateThread>[1] = {}

    if (params.updates.title !== undefined) updateData.title = params.updates.title
    if (params.updates.status !== undefined) updateData.status = params.updates.status
    if (params.updates.thread_values !== undefined)
      updateData.thread_values = JSON.stringify(params.updates.thread_values)

    const row = await dbUpdateThread(params.threadId, updateData)
    if (!row) throw new Error("Thread not found")

    return mapThreadRowToThread(row)
  }

  async setModel(threadId: string, selection: ModelRuntimeSelection): Promise<Thread> {
    const result = await this.threadLifecycleGate.withIdleMutation(threadId, async () => {
      if (await hasPendingHitlRequest(threadId)) {
        throw new JingleIpcError({
          channel: "threads:setModel",
          code: "CONFLICT",
          message: "Resolve the pending approval before changing this thread's model."
        })
      }

      return this.withThreadMetadataMutation(threadId, async (row) => {
        const runtimeSelection = this.resolveThreadModelRuntimeSelection({
          channel: "threads:setModel",
          selection
        })
        const metadata = row.metadata
          ? (JSON.parse(row.metadata) as Record<string, unknown>)
          : undefined
        const nextSelection = withThreadModelRuntimeSelection(metadata, runtimeSelection)
        const updated = await updateThreadMetadata(threadId, nextSelection.metadata)
        this.publishModelRuntimeSelectionChanged({
          revision: nextSelection.revision,
          selection: nextSelection.selection,
          threadId
        })
        return mapThreadRowToThread(updated)
      })
    })
    if (result.status === "accepted") {
      return result.value
    }

    const messages = {
      deleting: "This thread is being deleted and its model cannot be changed.",
      recovery_required: "Restart Jingle before changing this thread's model.",
      running: "Stop the active run before changing this thread's model.",
      shutting_down: "Jingle is shutting down and cannot change this thread's model."
    } satisfies Record<Exclude<typeof result.status, "accepted">, string>
    throw new JingleIpcError({
      channel: "threads:setModel",
      code:
        result.status === "recovery_required" || result.status === "shutting_down"
          ? "UNAVAILABLE"
          : "CONFLICT",
      message: messages[result.status]
    })
  }

  async setPinned(threadId: string, pinned: boolean): Promise<Thread> {
    return this.withThreadMetadataMutation(threadId, async (row) => {
      const metadata = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {}
      const nextMetadata = { ...metadata }
      if (pinned) {
        nextMetadata[THREAD_PINNED_METADATA_KEY] = true
      } else {
        delete nextMetadata[THREAD_PINNED_METADATA_KEY]
      }

      const updated = await updateThreadMetadata(threadId, nextMetadata)
      return mapThreadRowToThread(updated)
    })
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
    requirePersistedModelRuntimeSelectionSnapshot({
      channel: "threads:clone",
      metadata: nextMetadata,
      owner: "thread"
    })
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

    const nextMetadata = sourceThread.metadata
      ? (JSON.parse(sourceThread.metadata) as Record<string, unknown>)
      : {}
    requirePersistedModelRuntimeSelectionSnapshot({
      channel: "threads:cloneUntilMessage",
      metadata: nextMetadata,
      owner: "thread"
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

    await this.threadDigestService.withThreadDeletion(threadId, (waitForDigest) =>
      this.threadLifecycleGate.withDeletion(threadId, async () => {
        await waitForDigest()
        await closeCheckpointer(threadId)
        console.log("[Threads] Closed checkpointer")

        await dbDeleteThread(threadId)
        console.log("[Threads] Deleted from metadata store")
      })
    )

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
      thread: {
        ...facts.thread,
        modelRuntimeSelection: readThreadModelRuntimeSelection(facts.thread.metadata),
        modelRuntimeSelectionRevision: readThreadModelRuntimeSelectionRevision(
          facts.thread.metadata
        )
      },
      messages: {
        artifacts: facts.artifacts,
        messages: facts.messages
      },
      runState: {
        approvals: facts.approvals,
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
        recovery: null,
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

  private resolveThreadModelRuntimeSelection(input: {
    channel: "threads:create" | "threads:setModel"
    selection?: ModelRuntimeSelection
  }): ModelRuntimeSelection {
    try {
      return input.selection === undefined
        ? this.modelProviderService.getDefaultRuntimeSelection()
        : this.modelProviderService.validateRuntimeSelection(input.selection)
    } catch (error) {
      if (error instanceof JingleIpcError) {
        throw error
      }
      throw new JingleIpcError({
        channel: input.channel,
        code: "FAILED_PRECONDITION",
        message:
          error instanceof Error && error.message
            ? error.message
            : "The model runtime selection is not supported. Select the model again."
      })
    }
  }

  private publishModelRuntimeSelectionChanged(
    event: ThreadModelRuntimeSelectionChangedEvent
  ): void {
    for (const listener of this.modelRuntimeSelectionChangedListeners) {
      try {
        listener(event)
      } catch (error) {
        console.warn("[Threads] Model runtime selection listener failed after persistence.", {
          error,
          revision: event.revision,
          threadId: event.threadId
        })
      }
    }
  }

  private async withThreadMetadataMutation<T>(
    threadId: string,
    operation: (row: ThreadRow) => Promise<T>
  ): Promise<T> {
    const previous = this.metadataMutationQueues.get(threadId) ?? Promise.resolve()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => barrier)
    this.metadataMutationQueues.set(threadId, queued)

    await previous.catch(() => undefined)
    try {
      const row = await getThread(threadId)
      if (!row) {
        throw new Error("Thread not found")
      }
      return await operation(row)
    } finally {
      release()
      if (this.metadataMutationQueues.get(threadId) === queued) {
        this.metadataMutationQueues.delete(threadId)
      }
    }
  }
}

function assertMetadataDoesNotOwnModelRuntimeSelection(
  channel: string,
  metadata: Record<string, unknown> | undefined
): void {
  const protectedKey = metadata
    ? [
        MODEL_RUNTIME_SELECTION_METADATA_KEY,
        MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY,
        "model",
        "modelId"
      ].find((key) => Object.hasOwn(metadata, key))
    : undefined
  if (protectedKey) {
    throw new JingleIpcError({
      channel,
      code: "INVALID_ARGUMENT",
      message: `Thread metadata cannot write ${protectedKey}. Use threads:setModel.`
    })
  }
}

function requireMetadataPatch(channel: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JingleIpcError({
      channel,
      code: "INVALID_ARGUMENT",
      message: "Thread metadata update must be an object patch."
    })
  }
  const patch = value as Record<string, unknown>
  assertMetadataDoesNotOwnModelRuntimeSelection(channel, patch)
  return patch
}
