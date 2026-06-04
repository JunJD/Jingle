import type { ToolCall as LangChainToolCall, ToolCallChunk } from "@langchain/core/messages"
import {
  extractComposerMessageRefsMetadata,
  normalizeComposerMessageRefs,
  toDisplayAssistantMessageContent,
  toComposerMessageMetadata,
  toDisplayMessageContent,
  toDisplayUserMessageContent,
  type AgentInvokeMessage,
  type AgentMessageContent
} from "@shared/message-content"
import type {
  ContentBlock,
  HITLRequest,
  Message,
  Subagent,
  ThreadHistoryState,
  Todo,
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
  type AgentThreadSnapshot,
  type AgentThreadRuntimeState,
  type AgentTokenUsage
} from "@shared/agent-thread-runtime"
import { getIpcErrorStatus, isIpcErrorCode, type IpcErrorPayload } from "@shared/ipc-error"
import { extractHitlRequestFromValuesState } from "./runtime-state"
import type { ThreadsService } from "../threads/service"
import type { AgentStreamPayload } from "./service"

interface UsageMetadata {
  input_token_details?: {
    audio?: number
    cache_creation?: number
    cache_read?: number
  }
  input_tokens?: number
  output_token_details?: {
    audio?: number
    reasoning?: number
  }
  output_tokens?: number
  total_tokens?: number
}

interface SerializedMessageChunk {
  id?: string[]
  kwargs?: {
    additional_kwargs?: {
      [key: string]: unknown
      refs?: unknown
      tool_calls?: Array<{
        function?: {
          arguments?: string
          name?: string
        }
        id?: string
      }>
    }
    content?: string | unknown[] | AgentMessageContent
    id?: string
    name?: string
    response_metadata?: {
      [key: string]: unknown
      usage?: UsageMetadata
    }
    tool_call_chunks?: ToolCallChunk[]
    tool_call_id?: string
    tool_calls?: LangChainToolCall[]
    usage_metadata?: UsageMetadata
  }
  lc?: number
  type?: string
}

interface MessageMetadata {
  checkpoint_ns?: string
  langgraph_checkpoint_ns?: string
  langgraph_node?: string
  name?: string
}

interface ValuesInterruptState {
  __interrupt__?: unknown[]
  messages?: SerializedMessageChunk[]
  todos?: Array<{ content?: string; id?: string; status?: string }>
}

interface AccumulatedToolCall {
  args: string
  id: string
  name: string
}

type TerminalRuntimeStatus = "idle" | "interrupted" | "error" | "cancelled"

interface AgentHubEntry {
  eventSubscribers: Map<string, (batch: AgentThreadEventBatch) => void>
  hydrated: boolean
  hydratePromise: Promise<void> | null
  projector: ThreadRuntimeProjector
}

function getRequiredRuntimeRunId(runId: string | null): string {
  if (runId) {
    return runId
  }

  throw new Error("[AgentStreamHub] Missing run id for interrupt state.")
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

function getToolCallNames(toolCalls: readonly { name?: string }[] | undefined): string[] {
  return Array.from(
    new Set(
      (toolCalls ?? [])
        .map((toolCall) => toolCall.name)
        .filter((name): name is string => typeof name === "string" && name.length > 0)
    )
  )
}

function getContentBlockText(block: ContentBlock): string {
  return block.text ?? block.content ?? ""
}

function getContentBlockReasoning(block: ContentBlock): string {
  return block.reasoning ?? block.text ?? block.content ?? ""
}

function toContentBlocks(content: Message["content"]): ContentBlock[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ text: content, type: "text" }] : []
  }

  return content
}

function appendContentBlocks(existing: ContentBlock[], incoming: ContentBlock[]): ContentBlock[] {
  const next = [...existing]

  for (const block of incoming) {
    const lastIndex = next.length - 1
    const last = lastIndex >= 0 ? next[lastIndex] : null

    if (block.type === "text") {
      const text = getContentBlockText(block)
      if (text.length === 0) {
        continue
      }

      if (last?.type === "text") {
        next[lastIndex] = {
          ...last,
          text: `${getContentBlockText(last)}${text}`
        }
        continue
      }
    }

    if (block.type === "reasoning") {
      const reasoning = getContentBlockReasoning(block)
      if (reasoning.length === 0) {
        continue
      }

      if (last?.type === "reasoning") {
        next[lastIndex] = {
          ...last,
          ...(block.signature ? { signature: block.signature } : {}),
          reasoning: `${getContentBlockReasoning(last)}${reasoning}`
        }
        continue
      }
    }

    next.push(block)
  }

  return next
}

function appendAssistantMessageContent(
  existing: Message["content"],
  incoming: Message["content"]
): Message["content"] {
  if (typeof existing === "string" && typeof incoming === "string") {
    return `${existing}${incoming}`
  }

  return appendContentBlocks(toContentBlocks(existing), toContentBlocks(incoming))
}

class ThreadRuntimeProjector {
  private readonly accumulatedToolCalls = new Map<string, AccumulatedToolCall>()
  private readonly activeSubagents = new Map<string, Subagent>()
  private readonly pendingRuntimeEvents: AgentThreadEvent[] = []
  private currentMessageId: string | null = null
  private runtimeState: AgentThreadRuntimeState

  constructor(threadId: string) {
    this.runtimeState = createDefaultAgentThreadRuntimeState(threadId)
  }

  consumeRuntimeEvents(): AgentThreadEvent[] {
    return this.pendingRuntimeEvents.splice(0)
  }

  getSnapshot(): AgentThreadSnapshot {
    return structuredClone(this.runtimeState)
  }

  hydrateFromHistory(history: ThreadHistoryState): void {
    this.resetStreamingState()
    const messages = this.sanitizeHistoryMessages(history.messages)
    let activeRun: ActiveAgentRun | null = null
    if (history.pendingApproval) {
      activeRun = this.createActiveRunFromLatestUserMessage(messages)
      const activeTurnMessages = activeRun
        ? this.getVisibleMessagesForTurn(activeRun.turnId, messages)
        : []
      const lastAssistant = activeTurnMessages.findLast((message) => message.role === "assistant")
      activeRun = activeRun
        ? {
            ...activeRun,
            assistantMessageId: lastAssistant?.id ?? activeRun.assistantMessageId,
            phase: "waiting_tool_result",
            status: "waiting_approval"
          }
        : null
    }
    this.commitRuntimeEvent({
      snapshot: {
        activeRun,
        error: null,
        hasMoreBefore: false,
        latestRunId: null,
        messagesPage: messages,
        pendingApproval: history.pendingApproval,
        status: history.pendingApproval ? "interrupted" : "idle",
        subagents: [],
        threadId: this.runtimeState.threadId,
        todos: history.todos,
        tokenUsage: null
      },
      type: "thread.snapshot"
    })
  }

  prepareInvoke(message: AgentInvokeMessage): void {
    this.resetStreamingState()
    const userMessage = this.createUserMessage(message)
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
      const [msgChunk] = data as [SerializedMessageChunk, MessageMetadata]
      const kwargs = msgChunk?.kwargs || {}
      const classId = Array.isArray(msgChunk?.id) ? msgChunk.id : []
      const className = classId[classId.length - 1] || ""
      const isToolMessage = className.includes("ToolMessage") && !!kwargs.tool_call_id
      const isAIMessage = className.includes("AI") || className.includes("AIMessageChunk")

      if (isAIMessage) {
        const content = this.extractAssistantContent(kwargs)
        const messageId = kwargs.id || this.currentMessageId || crypto.randomUUID()
        this.currentMessageId = messageId

        if (content || kwargs.tool_calls?.length) {
          const messageMetadata = toComposerMessageMetadata({
            refs: extractComposerMessageRefsMetadata(kwargs.additional_kwargs)
          })
          this.upsertMessage(
            this.createAssistantRuntimeMessage({
              content: content || "",
              ...(messageMetadata ? { metadata: messageMetadata } : {}),
              id: messageId,
              ...(kwargs.tool_calls?.length ? { tool_calls: kwargs.tool_calls as ToolCall[] } : {})
            }),
            { appendAssistantText: true }
          )
        }

        if (kwargs.tool_call_chunks?.length) {
          this.commitToolStartedEvents(messageId, kwargs.tool_call_chunks)
          this.processToolCallChunks(kwargs.tool_call_chunks)
        }

        if (kwargs.tool_calls?.length) {
          this.commitToolStartedEvents(messageId, kwargs.tool_calls)
          this.processCompletedToolCalls(kwargs.tool_calls)
        }

        const usageMetadata = kwargs.usage_metadata || kwargs.response_metadata?.usage
        if (
          usageMetadata &&
          usageMetadata.input_tokens !== undefined &&
          usageMetadata.input_tokens > 0
        ) {
          this.commitRuntimeEvent({
            tokenUsage: this.toTokenUsage(usageMetadata),
            type: "run.tokenUsageUpdated"
          })
        }
      }

      if (isToolMessage && kwargs.tool_call_id) {
        this.commitRuntimeEvent({
          messageId: this.runtimeState.activeRun?.assistantMessageId ?? this.currentMessageId,
          runId: this.runtimeState.activeRun?.runId ?? this.runtimeState.latestRunId,
          toolCallId: kwargs.tool_call_id,
          type: "tool.updated"
        })
        const content = this.extractContent(kwargs.content)
        const messageMetadata = toComposerMessageMetadata({
          refs: extractComposerMessageRefsMetadata(kwargs.additional_kwargs)
        })
        const messageId = kwargs.id || crypto.randomUUID()
        this.upsertMessage(
          {
            content,
            created_at: this.getCreatedAt(messageId),
            id: messageId,
            ...(messageMetadata ? { metadata: messageMetadata } : {}),
            name: kwargs.name,
            role: "tool",
            tool_call_id: kwargs.tool_call_id
          },
          { appendAssistantText: false }
        )

        if (kwargs.name === "task") {
          this.processToolMessage(kwargs.tool_call_id)
        }
      }
    }

    if (mode === "values") {
      const state = data as ValuesInterruptState

      if (state.messages) {
        this.syncSubagentsFromValues(state.messages)
        this.applyValuesMessages(state.messages)
        this.syncActiveRunFromMessages()
      }

      if (state.todos !== undefined) {
        this.commitRuntimeEvent({
          todos: state.todos.map((todo) => ({
            content: todo.content || "",
            id: todo.id || crypto.randomUUID(),
            status: (todo.status || "pending") as Todo["status"]
          })),
          type: "todos.replaced"
        })
      }

      const pendingApproval = this.extractPendingApproval(state)
      if (pendingApproval) {
        this.commitRuntimeEvent({
          approval: pendingApproval,
          runId: this.runtimeState.activeRun?.runId ?? this.runtimeState.latestRunId,
          type: "approval.requested"
        })
      }
    }
  }

  private commitRuntimeEvent(draft: AgentThreadEventDraft): AgentThreadEvent | null {
    const revision = this.runtimeState.revision + 1
    const event =
      draft.type === "thread.snapshot"
        ? ({
            ...draft,
            revision,
            snapshot: {
              ...draft.snapshot,
              revision
            }
          } as AgentThreadEvent)
        : ({
            ...draft,
            revision
          } as AgentThreadEvent)
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

  private createSubagentFromTask(toolCallId: string, args: Record<string, unknown>): Subagent {
    const subagentType = (args.subagent_type as string) || "general-purpose"
    const description = (args.description as string) || "Executing task..."
    const nameMap: Record<string, string> = {
      "code-reviewer": "Code Reviewer",
      "correctness-checker": "Correctness Checker",
      "final-reviewer": "Final Reviewer",
      "general-purpose": "General Purpose Agent",
      research: "Research Agent"
    }

    return {
      description,
      id: toolCallId,
      name: nameMap[subagentType] || this.formatSubagentName(subagentType),
      startedAt: new Date(),
      status: "running",
      subagentType,
      toolCallId
    }
  }

  private createUserMessage(message: AgentInvokeMessage): Message {
    const refs = normalizeComposerMessageRefs(message.additional_kwargs?.refs)
    const metadata = toComposerMessageMetadata({ refs })

    return {
      content: toDisplayUserMessageContent(message.content, metadata),
      created_at: new Date(),
      id: message.id,
      ...(metadata ? { metadata } : {}),
      role: "user"
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

  private extractContent(
    content: string | unknown[] | AgentMessageContent | undefined
  ): string | ContentBlock[] {
    return toDisplayMessageContent(content)
  }

  private extractAssistantContent(
    kwargs: SerializedMessageChunk["kwargs"],
    toolNames: readonly string[] = getToolCallNames(kwargs?.tool_calls)
  ): string | ContentBlock[] {
    return toDisplayAssistantMessageContent(kwargs?.content, {
      additional_kwargs: kwargs?.additional_kwargs,
      response_metadata: kwargs?.response_metadata,
      toolNames
    })
  }

  private extractPendingApproval(state: ValuesInterruptState): HITLRequest | null {
    if (!state.__interrupt__?.length) {
      return null
    }

    return extractHitlRequestFromValuesState(
      this.runtimeState.threadId,
      getRequiredRuntimeRunId(this.runtimeState.latestRunId),
      state
    )
  }

  private formatSubagentName(subagentType: string): string {
    return subagentType
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  }

  private getCreatedAt(messageId: string): Date {
    const existingMessage = this.runtimeState.messagesPage.find(
      (message) => message.id === messageId
    )
    return existingMessage?.created_at ?? new Date()
  }

  private mapSerializedMessages(messages: SerializedMessageChunk[]): Message[] {
    return messages.map((msg) => {
      const kwargs = msg.kwargs || {}
      const classId = Array.isArray(msg.id) ? msg.id : []
      const className = classId[classId.length - 1] || ""
      const role: Message["role"] = className.includes("Human")
        ? "user"
        : className.includes("Tool")
          ? "tool"
          : "assistant"
      const metadata = toComposerMessageMetadata({
        refs: extractComposerMessageRefsMetadata(kwargs.additional_kwargs)
      })
      const content =
        role === "user"
          ? toDisplayUserMessageContent(this.extractContent(kwargs.content), metadata)
          : role === "assistant"
            ? this.extractAssistantContent(kwargs)
            : this.extractContent(kwargs.content)
      const messageId = kwargs.id || crypto.randomUUID()

      return {
        content,
        created_at: this.getCreatedAt(messageId),
        id: messageId,
        ...(metadata ? { metadata } : {}),
        ...(role === "assistant" && kwargs.tool_calls
          ? { tool_calls: kwargs.tool_calls as ToolCall[] }
          : {}),
        ...(role === "tool" && kwargs.name ? { name: kwargs.name } : {}),
        role,
        ...(role === "tool" && kwargs.tool_call_id ? { tool_call_id: kwargs.tool_call_id } : {})
      }
    })
  }

  private processCompletedToolCalls(
    toolCalls: Array<{ args?: Record<string, unknown>; id?: string; name?: string }>
  ): boolean {
    let changed = false

    for (const toolCall of toolCalls) {
      if (!toolCall.id || !toolCall.name) {
        continue
      }

      if (toolCall.name !== "task" || this.activeSubagents.has(toolCall.id)) {
        continue
      }

      const args = toolCall.args || {}
      if (!args.subagent_type && !args.description) {
        continue
      }

      this.activeSubagents.set(toolCall.id, this.createSubagentFromTask(toolCall.id, args))
      changed = true
    }

    if (changed) {
      this.commitRuntimeEvent({
        subagents: Array.from(this.activeSubagents.values()),
        type: "subagents.replaced"
      })
    }

    return changed
  }

  private processToolCallChunks(
    chunks: Array<{ args?: string; id?: string; name?: string }>
  ): boolean {
    let changed = false

    for (const chunk of chunks) {
      if (!chunk.id) {
        continue
      }

      let accumulated = this.accumulatedToolCalls.get(chunk.id)
      if (!accumulated) {
        accumulated = { args: "", id: chunk.id, name: chunk.name || "" }
        this.accumulatedToolCalls.set(chunk.id, accumulated)
      }

      if (chunk.name) {
        accumulated.name = chunk.name
      }

      if (chunk.args) {
        accumulated.args += chunk.args
      }

      if (accumulated.name !== "task" || this.activeSubagents.has(chunk.id)) {
        continue
      }

      try {
        const parsedArgs = JSON.parse(accumulated.args) as Record<string, unknown>
        if (!parsedArgs.subagent_type) {
          continue
        }

        this.activeSubagents.set(chunk.id, this.createSubagentFromTask(chunk.id, parsedArgs))
        changed = true
      } catch {
        continue
      }
    }

    if (changed) {
      this.commitRuntimeEvent({
        subagents: Array.from(this.activeSubagents.values()),
        type: "subagents.replaced"
      })
    }

    return changed
  }

  private processToolMessage(toolCallId: string): boolean {
    const subagent = this.activeSubagents.get(toolCallId)
    if (!subagent) {
      return false
    }

    subagent.completedAt = new Date()
    subagent.status = "completed"
    this.commitRuntimeEvent({
      subagents: Array.from(this.activeSubagents.values()),
      type: "subagents.replaced"
    })
    return true
  }

  private resetStreamingState(): void {
    this.accumulatedToolCalls.clear()
    this.activeSubagents.clear()
    this.currentMessageId = null
  }

  private sanitizeHistoryMessages(messages: Message[]): Message[] {
    return messages.map((message) => {
      if (message.role !== "assistant") {
        return message
      }

      return {
        ...message,
        content: toDisplayAssistantMessageContent(message.content, {
          toolNames: getToolCallNames(message.tool_calls)
        })
      }
    })
  }

  private syncSubagentsFromValues(messages: SerializedMessageChunk[]): boolean {
    let changed = false

    for (const message of messages) {
      const kwargs = message.kwargs || {}
      const classId = Array.isArray(message.id) ? message.id : []
      const className = classId[classId.length - 1] || ""

      if (kwargs.tool_calls?.length) {
        changed = this.processCompletedToolCalls(kwargs.tool_calls) || changed
      }

      if (className.includes("ToolMessage") && kwargs.tool_call_id && kwargs.name === "task") {
        changed = this.processToolMessage(kwargs.tool_call_id) || changed
      }
    }

    return changed
  }

  private toTokenUsage(usageMetadata: UsageMetadata): AgentTokenUsage {
    return {
      cacheCreationTokens: usageMetadata.input_token_details?.cache_creation,
      cacheReadTokens: usageMetadata.input_token_details?.cache_read,
      inputTokens: usageMetadata.input_tokens || 0,
      lastUpdated: new Date(),
      outputTokens: usageMetadata.output_tokens || 0,
      totalTokens: usageMetadata.total_tokens || 0
    }
  }

  private applyValuesMessages(messages: SerializedMessageChunk[]): boolean {
    const incomingMessages = this.mapSerializedMessages(messages)
    if (incomingMessages.length === 0) {
      return false
    }

    const existingMessages = this.runtimeState.messagesPage
    const nextMessages = [...existingMessages]
    const existingIndices = new Map(existingMessages.map((message, index) => [message.id, index]))

    for (const incomingMessage of incomingMessages) {
      const existingIndex = existingIndices.get(incomingMessage.id)
      if (existingIndex === undefined) {
        existingIndices.set(incomingMessage.id, nextMessages.length)
        nextMessages.push(incomingMessage)
        continue
      }

      nextMessages[existingIndex] = incomingMessage
    }

    this.commitRuntimeEvent({
      messages: nextMessages,
      type: "messages.replaced"
    })
    return true
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

export class AgentStreamHub {
  private readonly entries = new Map<string, AgentHubEntry>()
  private readonly eventListeners = new Map<string, (batch: AgentThreadEventBatch) => void>()

  constructor(private readonly threadsService: ThreadsService) {}

  async getThreadSnapshot(threadId: string): Promise<AgentThreadSnapshot> {
    const entry = await this.ensureEntry(threadId)
    return entry.projector.getSnapshot()
  }

  async prepareInvoke(threadId: string, message: AgentInvokeMessage): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.projector.prepareInvoke(message)
    this.notify(threadId)
  }

  async prepareResume(threadId: string): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.projector.prepareResume()
    this.notify(threadId)
  }

  async subscribeThreadEvents(
    threadId: string,
    subscriberId: string,
    listener: (batch: AgentThreadEventBatch) => void
  ): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.eventSubscribers.set(subscriberId, listener)
  }

  unsubscribeThreadEvents(threadId: string, subscriberId: string): void {
    const entry = this.entries.get(threadId)
    if (!entry) {
      return
    }

    entry.eventSubscribers.delete(subscriberId)
  }

  subscribeAllThreadEvents(
    subscriberId: string,
    listener: (batch: AgentThreadEventBatch) => void
  ): () => void {
    this.eventListeners.set(subscriberId, listener)

    return () => {
      this.eventListeners.delete(subscriberId)
    }
  }

  async handlePayload(threadId: string, payload: AgentStreamPayload): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.projector.applyPayload(payload)
    this.notify(threadId)
  }

  private async ensureEntry(threadId: string): Promise<AgentHubEntry> {
    let entry = this.entries.get(threadId)
    if (!entry) {
      entry = {
        eventSubscribers: new Map(),
        hydrated: false,
        hydratePromise: null,
        projector: new ThreadRuntimeProjector(threadId)
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
      const history = await this.threadsService.getHistory(threadId)
      entry.projector.hydrateFromHistory(history)
      // Hydration seeds state for getSnapshot/subscribe returns; it is not a future delta.
      entry.projector.consumeRuntimeEvents()
      entry.hydrated = true
    } catch (error) {
      console.error("[AgentStreamHub] Failed to hydrate thread history:", { error, threadId })
    } finally {
      entry.hydratePromise = null
    }
  }

  private notify(threadId: string): void {
    const entry = this.entries.get(threadId)
    if (!entry) {
      return
    }

    const runtimeEvents = entry.projector.consumeRuntimeEvents()
    if (runtimeEvents.length > 0) {
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
