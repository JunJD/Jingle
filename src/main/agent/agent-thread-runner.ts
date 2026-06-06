import type { AgentInvokeMessage } from "@shared/message-content"
import type {
  AgentThreadDataSnapshot,
  Message,
  Subagent,
  ToolCall
} from "@shared/app-types"
import {
  createDefaultAgentThreadRuntimeState,
  reduceAgentThreadRuntimeEvent,
  type ActiveAgentRun,
  type AgentRunPhase,
  type AgentThreadEvent,
  type AgentThreadEventBatch,
  type AgentThreadEventDraft,
  type AgentThreadRuntimeState,
  type AgentThreadRuntimeStatus
} from "@shared/agent-thread-runtime"
import { deriveThreadBootstrapState } from "@shared/agent-thread-bootstrap"
import { getIpcErrorStatus, isIpcErrorCode, type IpcErrorPayload } from "@shared/ipc-error"
import type { AgentStreamPayload } from "./service"
import {
  appendAssistantMessageContent,
  createUserRuntimeMessage,
  decodeMessagesStreamPayload,
  decodeValuesStreamPayload,
  sanitizeAssistantHistoryMessages,
  toTokenUsage
} from "./agent-stream-codec"
import { TaskToolCallTracker } from "./task-tool-call-tracker"

type TerminalRuntimeStatus = "idle" | "interrupted" | "error" | "cancelled"

interface AgentHubEntry {
  eventSubscribers: Map<string, (batch: AgentThreadEventBatch) => void>
  hydrated: boolean
  hydratePromise: Promise<void> | null
  projector: ThreadRuntimeProjector
  replayEvents: AgentThreadEvent[]
}

interface AgentThreadHistoryReader {
  getPersistedAgentThreadData(threadId: string): Promise<AgentThreadDataSnapshot>
}

function toRuntimeError(payload: Extract<AgentStreamPayload, { type: "error" }>): IpcErrorPayload {
  const code = isIpcErrorCode(payload.code) ? payload.code : "INTERNAL"

  return {
    code,
    ...(payload.details ? { details: payload.details } : {}),
    message: payload.message ?? payload.error,
    status: typeof payload.status === "number" ? payload.status : getIpcErrorStatus(code)
  }
}

function toThreadSnapshotStatus(
  status: AgentThreadRuntimeStatus
): AgentThreadDataSnapshot["thread"]["status"] {
  if (status === "running") {
    return "busy"
  }

  if (status === "interrupted" || status === "cancelled") {
    return "interrupted"
  }

  if (status === "error") {
    return "error"
  }

  return "idle"
}

function toRuntimeForkState(
  runtimeState: AgentThreadRuntimeState,
  persistedForkState: AgentThreadDataSnapshot["runState"]["forkState"]
): AgentThreadDataSnapshot["runState"]["forkState"] {
  if (runtimeState.status === "running") {
    return {
      canFork: false,
      reason: "busy"
    }
  }

  if (runtimeState.pendingApproval) {
    return {
      canFork: false,
      reason: "pending_hitl"
    }
  }

  return persistedForkState
}

class ThreadRuntimeProjector {
  private readonly pendingRuntimeEvents: AgentThreadEvent[] = []
  private readonly taskToolCallTracker = new TaskToolCallTracker()
  private currentMessageId: string | null = null
  private runtimeState: AgentThreadRuntimeState

  constructor(threadId: string) {
    this.runtimeState = createDefaultAgentThreadRuntimeState(threadId)
  }

  consumeRuntimeEvents(): AgentThreadEvent[] {
    return this.pendingRuntimeEvents.splice(0)
  }

  readState(): AgentThreadRuntimeState {
    return structuredClone(this.runtimeState)
  }

  hydrateFromThreadData(threadData: AgentThreadDataSnapshot): void {
    this.resetStreamingState()
    const messages = sanitizeAssistantHistoryMessages(threadData.messages.messages)
    const bootstrap = deriveThreadBootstrapState({
      ...threadData,
      messages: {
        ...threadData.messages,
        messages
      }
    })
    this.runtimeState = {
      activeRun: bootstrap.activeRun,
      error: bootstrap.error,
      hasMoreBefore: false,
      latestRunId: bootstrap.latestRunId,
      messagesPage: messages,
      pendingApproval: bootstrap.pendingApproval,
      revision: 0,
      status: bootstrap.status,
      subagents: [],
      threadId: this.runtimeState.threadId,
      todos: bootstrap.todos,
      tokenUsage: null
    }
  }

  prepareInvoke(message: AgentInvokeMessage): void {
    this.resetStreamingState()
    const userMessage = createUserRuntimeMessage(message)
    this.upsertMessage(userMessage, { appendAssistantText: false })
    this.commitRuntimeEvent({
      run: this.createActiveRun(message.id, null),
      type: "run.started"
    })
  }

  prepareResume(): void {
    this.resetStreamingState()
    const activeRun = this.createActiveRunFromLatestUserMessage()
    if (activeRun) {
      this.commitRuntimeEvent({
        run: activeRun,
        type: "run.resumed"
      })
    }
    this.syncActiveRunFromMessages()
  }

  applyPayload(payload: AgentStreamPayload): void {
    switch (payload.type) {
      case "run_started":
        if (this.runtimeState.pendingApproval) {
          this.commitRuntimeEvent({ type: "approval.cleared" })
        }
        this.commitRuntimeEvent({ runId: payload.runId, type: "run.idAssigned" })
        return

      case "stream":
        this.applyStreamPayload(payload.mode, payload.data)
        return

      case "done":
        this.finishActiveRun(this.runtimeState.pendingApproval ? "interrupted" : "idle")
        return

      case "cancelled":
        this.finishActiveRun("cancelled")
        return

      case "error":
        this.commitRuntimeEvent({
          error: toRuntimeError(payload),
          status: "error",
          type: "thread.statusChanged"
        })
        this.finishActiveRun("error")
        return
    }
  }

  private applyStreamPayload(mode: string, data: unknown): void {
    if (mode === "messages") {
      const decoded = decodeMessagesStreamPayload(data, this.currentMessageId)
      if (decoded.assistant) {
        this.currentMessageId = decoded.assistant.id

        if (decoded.assistant.content || decoded.assistant.toolCalls.length > 0) {
          this.upsertMessage(
            this.createAssistantRuntimeMessage({
              content: decoded.assistant.content || "",
              ...(decoded.assistant.metadata ? { metadata: decoded.assistant.metadata } : {}),
              id: decoded.assistant.id,
              ...(decoded.assistant.toolCalls.length > 0
                ? { tool_calls: decoded.assistant.toolCalls }
                : {})
            }),
            { appendAssistantText: true }
          )
        }

        if (decoded.assistant.toolCallChunks.length > 0) {
          this.commitToolStartedEvents(decoded.assistant.id, decoded.assistant.toolCallChunks)
          const subagents = this.taskToolCallTracker.readSubagentsFromToolCallChunks(
            decoded.assistant.toolCallChunks
          )
          if (subagents) {
            this.commitSubagentsReplaced(subagents)
          }
        }

        if (decoded.assistant.toolCalls.length > 0) {
          this.commitToolStartedEvents(decoded.assistant.id, decoded.assistant.toolCalls)
          const subagents = this.taskToolCallTracker.readSubagentsFromCompletedToolCalls(
            decoded.assistant.toolCalls
          )
          if (subagents) {
            this.commitSubagentsReplaced(subagents)
          }
        }

        if (
          decoded.assistant.usageMetadata &&
          decoded.assistant.usageMetadata.input_tokens !== undefined &&
          decoded.assistant.usageMetadata.input_tokens > 0
        ) {
          this.commitRuntimeEvent({
            tokenUsage: toTokenUsage(decoded.assistant.usageMetadata),
            type: "run.tokenUsageUpdated"
          })
        }
      }

      if (decoded.tool) {
        this.commitRuntimeEvent({
          messageId: this.runtimeState.activeRun?.assistantMessageId ?? this.currentMessageId,
          runId: this.runtimeState.activeRun?.runId ?? this.runtimeState.latestRunId,
          toolCallId: decoded.tool.toolCallId,
          type: "tool.updated"
        })
        this.upsertMessage(
          {
            content: decoded.tool.content,
            created_at: this.getCreatedAt(decoded.tool.id),
            id: decoded.tool.id,
            ...(decoded.tool.metadata ? { metadata: decoded.tool.metadata } : {}),
            name: decoded.tool.name,
            role: "tool",
            tool_call_id: decoded.tool.toolCallId
          },
          { appendAssistantText: false }
        )

        if (decoded.tool.name === "task") {
          const subagents = this.taskToolCallTracker.completeSubagent(decoded.tool.toolCallId)
          if (subagents) {
            this.commitSubagentsReplaced(subagents)
          }
        }
      }
    }

    if (mode === "values") {
      const decoded = decodeValuesStreamPayload(data, {
        runId: this.runtimeState.latestRunId,
        threadId: this.runtimeState.threadId
      })
      if (decoded.todos) {
        this.commitRuntimeEvent({
          todos: decoded.todos,
          type: "todos.replaced"
        })
      }

      if (decoded.pendingApproval) {
        this.commitRuntimeEvent({
          approval: decoded.pendingApproval,
          runId: this.runtimeState.activeRun?.runId ?? this.runtimeState.latestRunId,
          type: "approval.requested"
        })
      }
    }
  }

  private commitRuntimeEvent(draft: AgentThreadEventDraft): AgentThreadEvent | null {
    const revision = this.runtimeState.revision + 1
    const event = {
      ...draft,
      revision
    } as AgentThreadEvent
    const nextRuntimeState = reduceAgentThreadRuntimeEvent(this.runtimeState, event)
    if (nextRuntimeState === this.runtimeState) {
      return null
    }

    this.runtimeState = nextRuntimeState
    this.pendingRuntimeEvents.push(structuredClone(event))
    return event
  }

  private commitToolStartedEvents(messageId: string, toolCalls: readonly { id?: string }[]): void {
    for (const toolCall of toolCalls) {
      if (!toolCall.id) {
        continue
      }

      this.commitRuntimeEvent({
        messageId,
        runId: this.runtimeState.activeRun?.runId ?? this.runtimeState.latestRunId,
        toolCallId: toolCall.id,
        type: "tool.started"
      })
    }
  }

  private commitSubagentsReplaced(subagents: Subagent[]): void {
    this.commitRuntimeEvent({
      subagents,
      type: "subagents.replaced"
    })
  }

  private createAssistantRuntimeMessage(input: {
    content: Message["content"]
    id: string
    metadata?: Message["metadata"]
    tool_calls?: ToolCall[]
  }): Message {
    return {
      content: input.content,
      created_at: this.getCreatedAt(input.id),
      id: input.id,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      role: "assistant",
      ...(input.tool_calls ? { tool_calls: input.tool_calls } : {})
    }
  }

  private createActiveRun(userMessageId: string, runId: string | null): ActiveAgentRun {
    return {
      assistantMessageId: null,
      phase: "thinking",
      runId,
      status: "running",
      threadId: this.runtimeState.threadId,
      turnId: userMessageId,
      userMessageId
    }
  }

  private createActiveRunFromLatestUserMessage(
    messages = this.runtimeState.messagesPage
  ): ActiveAgentRun | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.role === "user") {
        return this.createActiveRun(message.id, this.runtimeState.latestRunId)
      }
    }

    return null
  }

  private finishActiveRun(status: TerminalRuntimeStatus): void {
    if (status === "interrupted" && this.runtimeState.activeRun?.status === "waiting_approval") {
      return
    }

    const terminalStatus =
      status === "cancelled" ? "cancelled" : status === "error" ? "failed" : "completed"
    this.commitRuntimeEvent({
      runId: this.runtimeState.activeRun?.runId ?? this.runtimeState.latestRunId,
      status: terminalStatus,
      type: "run.finished"
    })
  }

  private syncActiveRunFromMessages(): boolean {
    const activeRun = this.runtimeState.activeRun
    if (!activeRun) {
      return false
    }

    const activeTurnMessages = this.getVisibleMessagesForTurn(activeRun.turnId)
    const lastAssistant = activeTurnMessages.findLast((message) => message.role === "assistant")
    if (!lastAssistant) {
      return false
    }

    const phase: AgentRunPhase =
      (lastAssistant.tool_calls?.length ?? 0) > 0 ? "tool_running" : "streaming"
    if (activeRun.assistantMessageId === lastAssistant.id && activeRun.phase === phase) {
      return false
    }

    this.commitRuntimeEvent({
      message: lastAssistant,
      type: "message.upserted"
    })
    return true
  }

  private getVisibleMessagesForTurn(
    turnId: string,
    messages = this.runtimeState.messagesPage
  ): Message[] {
    const visibleMessages = messages.filter((message) => message.role !== "tool")
    const turnStartIndex = visibleMessages.findIndex(
      (message) => message.role === "user" && message.id === turnId
    )
    if (turnStartIndex < 0) {
      return []
    }

    const nextTurnStartIndex = visibleMessages.findIndex(
      (message, index) => index > turnStartIndex && message.role === "user"
    )
    const turnEndIndex = nextTurnStartIndex < 0 ? visibleMessages.length : nextTurnStartIndex
    return visibleMessages.slice(turnStartIndex, turnEndIndex)
  }

  private getCreatedAt(messageId: string): Date {
    const existingMessage = this.runtimeState.messagesPage.find(
      (message) => message.id === messageId
    )
    return existingMessage?.created_at ?? new Date()
  }

  private resetStreamingState(): void {
    this.taskToolCallTracker.reset()
    this.currentMessageId = null
  }

  private upsertMessage(message: Message, options: { appendAssistantText: boolean }): boolean {
    const existingIndex = this.runtimeState.messagesPage.findIndex(
      (entry) => entry.id === message.id
    )
    if (existingIndex < 0) {
      this.commitRuntimeEvent({
        message,
        type: "message.upserted"
      })
      return true
    }

    const existingMessage = this.runtimeState.messagesPage[existingIndex]
    if (
      options.appendAssistantText &&
      existingMessage.role === "assistant" &&
      message.role === "assistant" &&
      typeof existingMessage.content === "string" &&
      typeof message.content === "string" &&
      !message.metadata &&
      !message.tool_calls?.length
    ) {
      this.commitRuntimeEvent({
        delta: message.content,
        field: "text",
        messageId: message.id,
        partId: "content",
        type: "message.part.delta"
      })
      return true
    }

    let nextMessage = message
    if (
      options.appendAssistantText &&
      existingMessage.role === "assistant" &&
      message.role === "assistant"
    ) {
      nextMessage = {
        ...message,
        content: appendAssistantMessageContent(existingMessage.content, message.content),
        created_at: existingMessage.created_at
      }
    }

    this.commitRuntimeEvent({
      message: nextMessage,
      type: "message.upserted"
    })
    return true
  }
}

export class AgentThreadRunner {
  private readonly entries = new Map<string, AgentHubEntry>()
  private readonly eventListeners = new Map<string, (batch: AgentThreadEventBatch) => void>()

  constructor(private readonly threadsService: AgentThreadHistoryReader) {}

  async readThreadState(threadId: string): Promise<AgentThreadRuntimeState> {
    const entry = await this.ensureEntry(threadId)
    return entry.projector.readState()
  }

  async prepareInvoke(threadId: string, message: AgentInvokeMessage): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.replayEvents = []
    entry.projector.prepareInvoke(message)
    this.notify(threadId)
  }

  async prepareResume(threadId: string): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.replayEvents = []
    entry.projector.prepareResume()
    this.notify(threadId)
  }

  async connectThreadEvents(
    threadId: string,
    subscriberId: string,
    listener: (batch: AgentThreadEventBatch) => void
  ): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.eventSubscribers.set(subscriberId, listener)
    this.replayThreadEvents(threadId, entry, listener)
  }

  disconnectThreadEvents(threadId: string, subscriberId: string): void {
    const entry = this.entries.get(threadId)
    if (!entry) {
      return
    }

    entry.eventSubscribers.delete(subscriberId)
  }

  connectAllThreadEvents(
    subscriberId: string,
    listener: (batch: AgentThreadEventBatch) => void
  ): () => void {
    this.eventListeners.set(subscriberId, listener)

    return () => {
      this.eventListeners.delete(subscriberId)
    }
  }

  readThreadDataOverlay(
    threadId: string,
    persistedThreadData: AgentThreadDataSnapshot
  ): AgentThreadDataSnapshot | null {
    const entry = this.entries.get(threadId)
    if (!entry) {
      return null
    }

    const runtimeState = entry.projector.readState()
    if (runtimeState.revision === 0) {
      return null
    }

    return {
      thread: {
        ...persistedThreadData.thread,
        status: toThreadSnapshotStatus(runtimeState.status)
      },
      messages: {
        artifacts: persistedThreadData.messages.artifacts,
        messages: runtimeState.messagesPage
      },
      runState: {
        error: runtimeState.error?.message ?? persistedThreadData.runState.error,
        forkState: toRuntimeForkState(runtimeState, persistedThreadData.runState.forkState),
        pendingApproval: runtimeState.pendingApproval,
        runId: runtimeState.latestRunId ?? persistedThreadData.runState.runId,
        todos: runtimeState.todos
      }
    }
  }

  async handlePayload(threadId: string, payload: AgentStreamPayload): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.projector.applyPayload(payload)
    this.notify(threadId)
    if (payload.type === "done" || payload.type === "cancelled" || payload.type === "error") {
      entry.replayEvents = []
    }
  }

  private async ensureEntry(threadId: string): Promise<AgentHubEntry> {
    let entry = this.entries.get(threadId)
    if (!entry) {
      entry = {
        eventSubscribers: new Map(),
        hydrated: false,
        hydratePromise: null,
        projector: new ThreadRuntimeProjector(threadId),
        replayEvents: []
      }
      this.entries.set(threadId, entry)
    }

    if (!entry.hydrated && !entry.hydratePromise) {
      entry.hydratePromise = this.hydrateEntry(threadId, entry)
    }

    if (entry.hydratePromise) {
      await entry.hydratePromise
    }

    return entry
  }

  private async hydrateEntry(threadId: string, entry: AgentHubEntry): Promise<void> {
    try {
      const threadData = await this.threadsService.getPersistedAgentThreadData(threadId)
      entry.projector.hydrateFromThreadData(threadData)
      // Hydration seeds the local projector from persisted history; active subscribers replay only run events.
      entry.projector.consumeRuntimeEvents()
      entry.hydrated = true
    } catch (error) {
      console.error("[AgentThreadRunner] Failed to hydrate thread data:", { error, threadId })
    } finally {
      entry.hydratePromise = null
    }
  }

  private replayThreadEvents(
    threadId: string,
    entry: AgentHubEntry,
    listener: (batch: AgentThreadEventBatch) => void
  ): void {
    if (entry.replayEvents.length === 0) {
      return
    }

    listener({
      events: structuredClone(entry.replayEvents),
      latestRevision: entry.replayEvents[entry.replayEvents.length - 1]?.revision ?? 0,
      threadId
    })
  }

  private notify(threadId: string): void {
    const entry = this.entries.get(threadId)
    if (!entry) {
      return
    }

    const runtimeEvents = entry.projector.consumeRuntimeEvents()
    if (runtimeEvents.length > 0) {
      entry.replayEvents.push(...structuredClone(runtimeEvents))
      const batch: AgentThreadEventBatch = {
        events: runtimeEvents,
        latestRevision: runtimeEvents[runtimeEvents.length - 1]?.revision ?? 0,
        threadId
      }
      for (const listener of this.eventListeners.values()) {
        listener(batch)
      }
      for (const listener of entry.eventSubscribers.values()) {
        listener(batch)
      }
    }
  }
}
