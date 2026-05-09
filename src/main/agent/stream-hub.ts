import { EventType, type BaseEvent, type Message as AGUIMessage } from "@ag-ui/core"
import type { ToolCall as LangChainToolCall, ToolCallChunk } from "@langchain/core/messages"
import {
  extractComposerMessageRefsMetadata,
  extractMessageText,
  normalizeComposerMessageRefs,
  toDisplayAssistantMessageContent,
  summarizeMessageContent,
  toComposerMessageMetadata,
  toDisplayMessageContent,
  toDisplayUserMessageContent,
  type AgentInvokeMessage,
  type AgentMessageContent
} from "@shared/message-content"
import type {
  ContentBlock,
  Message,
  Subagent,
  ThreadHistoryState,
  ToolCall
} from "@shared/app-types"
import {
  createDefaultAgentThreadProjection,
  type AgentProjectionEnvelope,
  type AgentThreadProjection,
  type AgentTokenUsage
} from "@shared/agent-projection"
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

interface AgentHubEntry {
  hydratePromise: Promise<void> | null
  projector: ThreadProjectionProjector
  subscribers: Map<string, (envelope: AgentProjectionEnvelope) => void>
}

function getRequiredProjectionRunId(runId: string | null): string {
  if (runId) {
    return runId
  }

  throw new Error("[AgentStreamHub] Missing run id for interrupt projection.")
}

function toProjectionError(
  payload: Extract<AgentStreamPayload, { type: "error" }>
): IpcErrorPayload {
  const code = isIpcErrorCode(payload.code) ? payload.code : "INTERNAL"

  return {
    code,
    ...(payload.details ? { details: payload.details } : {}),
    message: payload.message ?? payload.error,
    status: typeof payload.status === "number" ? payload.status : getIpcErrorStatus(code)
  }
}

function toAGUIStringContent(content: Message["content"]): string {
  const text = extractMessageText(content).trim()
  if (text.length > 0) {
    return text
  }

  return summarizeMessageContent(content)
}

function stringifyToolArgs(args: unknown): string {
  try {
    return JSON.stringify(args ?? {})
  } catch {
    return "{}"
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

function toAGUIMessage(message: Message): AGUIMessage {
  switch (message.role) {
    case "assistant":
      return {
        ...(message.content ? { content: toAGUIStringContent(message.content) || undefined } : {}),
        id: message.id,
        ...(message.name ? { name: message.name } : {}),
        role: "assistant",
        ...(message.tool_calls?.length
          ? {
              toolCalls: message.tool_calls.map((toolCall) => ({
                function: {
                  arguments: stringifyToolArgs(toolCall.args),
                  name: toolCall.name
                },
                id: toolCall.id,
                type: "function"
              }))
            }
          : {})
      }

    case "tool":
      return {
        content: toAGUIStringContent(message.content),
        id: message.id,
        role: "tool",
        toolCallId: message.tool_call_id ?? message.id,
        ...(message.name ? { name: message.name } : {})
      }

    case "system":
      return {
        content: toAGUIStringContent(message.content),
        id: message.id,
        ...(message.name ? { name: message.name } : {}),
        role: "system"
      }

    case "user":
      return {
        content: toAGUIStringContent(message.content),
        id: message.id,
        ...(message.name ? { name: message.name } : {}),
        role: "user"
      }
  }
}

class ThreadProjectionProjector {
  private readonly accumulatedToolCalls = new Map<string, AccumulatedToolCall>()
  private readonly activeSubagents = new Map<string, Subagent>()
  private currentMessageId: string | null = null
  private projection: AgentThreadProjection

  constructor(threadId: string) {
    this.projection = createDefaultAgentThreadProjection(threadId)
  }

  getEnvelope(event: BaseEvent | null): AgentProjectionEnvelope {
    return {
      event,
      projection: structuredClone(this.projection)
    }
  }

  hydrateFromHistory(history: ThreadHistoryState): void {
    this.resetStreamingState()
    this.projection = {
      ...createDefaultAgentThreadProjection(this.projection.threadId),
      messages: this.sanitizeHistoryMessages(history.messages),
      pendingApproval: history.pendingApproval,
      status: history.pendingApproval ? "interrupted" : "idle",
      todos: history.todos
    }
  }

  prepareInvoke(message: AgentInvokeMessage): BaseEvent {
    this.resetStreamingState()
    this.projection.error = null
    this.projection.isLoading = true
    this.projection.pendingApproval = null
    this.projection.runId = null
    this.projection.status = "running"
    this.projection.subagents = []
    this.projection.tokenUsage = null
    this.upsertMessage(this.createUserMessage(message), { appendAssistantText: false })
    return this.buildMessagesSnapshotEvent()
  }

  prepareResume(): BaseEvent {
    this.resetStreamingState()
    this.projection.error = null
    this.projection.isLoading = true
    this.projection.pendingApproval = null
    this.projection.runId = null
    this.projection.status = "running"
    this.projection.subagents = []
    this.projection.tokenUsage = null
    return this.buildStateSnapshotEvent()
  }

  applyPayload(payload: AgentStreamPayload): BaseEvent[] {
    switch (payload.type) {
      case "run_started":
        this.projection.error = null
        this.projection.isLoading = true
        this.projection.runId = payload.runId
        this.projection.status = "running"
        return [this.buildRunStartedEvent(payload.runId)]

      case "stream":
        return this.applyStreamPayload(payload.mode, payload.data)

      case "done":
        this.projection.isLoading = false
        this.projection.status = this.projection.pendingApproval ? "interrupted" : "idle"
        return [this.buildRunFinishedEvent()]

      case "cancelled":
        this.projection.isLoading = false
        this.projection.pendingApproval = null
        this.projection.status = "cancelled"
        return [this.buildRunFinishedEvent({ cancelled: true })]

      case "error":
        this.projection.error = toProjectionError(payload)
        this.projection.isLoading = false
        this.projection.status = "error"
        return [this.buildRunErrorEvent(this.projection.error.message, this.projection.error.code)]
    }
  }

  private applyStreamPayload(mode: string, data: unknown): BaseEvent[] {
    let messagesChanged = false
    let stateChanged = false

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
          messagesChanged =
            this.upsertMessage(
              {
                content: content || "",
                created_at: this.getCreatedAt(messageId),
                id: messageId,
                ...(messageMetadata ? { metadata: messageMetadata } : {}),
                role: "assistant",
                ...(kwargs.tool_calls?.length
                  ? { tool_calls: kwargs.tool_calls as ToolCall[] }
                  : {})
              },
              { appendAssistantText: true }
            ) || messagesChanged
        }

        if (kwargs.tool_call_chunks?.length) {
          stateChanged = this.processToolCallChunks(kwargs.tool_call_chunks) || stateChanged
        }

        if (kwargs.tool_calls?.length) {
          stateChanged = this.processCompletedToolCalls(kwargs.tool_calls) || stateChanged
        }

        const usageMetadata = kwargs.usage_metadata || kwargs.response_metadata?.usage
        if (
          usageMetadata &&
          usageMetadata.input_tokens !== undefined &&
          usageMetadata.input_tokens > 0
        ) {
          this.projection.tokenUsage = this.toTokenUsage(usageMetadata)
          stateChanged = true
        }
      }

      if (isToolMessage && kwargs.tool_call_id) {
        const content = this.extractContent(kwargs.content)
        const messageMetadata = toComposerMessageMetadata({
          refs: extractComposerMessageRefsMetadata(kwargs.additional_kwargs)
        })
        const messageId = kwargs.id || crypto.randomUUID()
        messagesChanged =
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
          ) || messagesChanged

        if (kwargs.name === "task") {
          stateChanged = this.processToolMessage(kwargs.tool_call_id) || stateChanged
        }
      }
    }

    if (mode === "values") {
      const state = data as ValuesInterruptState

      if (state.messages) {
        stateChanged = this.syncSubagentsFromValues(state.messages) || stateChanged
        messagesChanged = this.applyValuesMessages(state.messages) || messagesChanged
      }

      if (state.todos !== undefined) {
        this.projection.todos = state.todos.map((todo) => ({
          content: todo.content || "",
          id: todo.id || crypto.randomUUID(),
          status: (todo.status || "pending") as AgentThreadProjection["todos"][number]["status"]
        }))
        stateChanged = true
      }

      const pendingApproval = this.extractPendingApproval(state)
      if (pendingApproval) {
        this.projection.isLoading = false
        this.projection.pendingApproval = pendingApproval
        this.projection.status = "interrupted"
        stateChanged = true
      }
    }

    const events: BaseEvent[] = []
    if (messagesChanged) {
      events.push(this.buildMessagesSnapshotEvent())
    }
    if (stateChanged) {
      events.push(this.buildStateSnapshotEvent())
    }
    return events
  }

  private buildMessagesSnapshotEvent(): BaseEvent {
    return {
      messages: this.projection.messages.map((message) => toAGUIMessage(message)),
      timestamp: Date.now(),
      type: EventType.MESSAGES_SNAPSHOT
    }
  }

  private buildRunErrorEvent(message: string, code?: string): BaseEvent {
    return {
      ...(code ? { code } : {}),
      message,
      timestamp: Date.now(),
      type: EventType.RUN_ERROR
    }
  }

  private buildRunFinishedEvent(result?: unknown): BaseEvent {
    return {
      ...(result !== undefined ? { result } : {}),
      runId: this.projection.runId ?? "unknown",
      threadId: this.projection.threadId,
      timestamp: Date.now(),
      type: EventType.RUN_FINISHED
    }
  }

  private buildRunStartedEvent(runId: string): BaseEvent {
    return {
      runId,
      threadId: this.projection.threadId,
      timestamp: Date.now(),
      type: EventType.RUN_STARTED
    }
  }

  private buildStateSnapshotEvent(): BaseEvent {
    return {
      snapshot: {
        error: this.projection.error,
        isLoading: this.projection.isLoading,
        pendingApproval: this.projection.pendingApproval,
        runId: this.projection.runId,
        status: this.projection.status,
        subagents: this.projection.subagents,
        todos: this.projection.todos,
        tokenUsage: this.projection.tokenUsage
      },
      timestamp: Date.now(),
      type: EventType.STATE_SNAPSHOT
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

  private extractPendingApproval(
    state: ValuesInterruptState
  ): AgentThreadProjection["pendingApproval"] {
    if (!state.__interrupt__?.length) {
      return null
    }

    return extractHitlRequestFromValuesState(
      this.projection.threadId,
      getRequiredProjectionRunId(this.projection.runId),
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
    const existingMessage = this.projection.messages.find((message) => message.id === messageId)
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
      this.projection.subagents = Array.from(this.activeSubagents.values())
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
      this.projection.subagents = Array.from(this.activeSubagents.values())
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
    this.projection.subagents = Array.from(this.activeSubagents.values())
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

    const existingMessages = this.projection.messages
    const incomingIds = new Set(incomingMessages.map((message) => message.id))
    const isFullSnapshot = existingMessages.every((message) => incomingIds.has(message.id))

    if (isFullSnapshot) {
      this.projection.messages = incomingMessages
      return true
    }

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

    this.projection.messages = nextMessages
    return true
  }

  private upsertMessage(message: Message, options: { appendAssistantText: boolean }): boolean {
    const existingIndex = this.projection.messages.findIndex((entry) => entry.id === message.id)
    if (existingIndex < 0) {
      this.projection.messages = [...this.projection.messages, message]
      return true
    }

    const existingMessage = this.projection.messages[existingIndex]
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

    this.projection.messages = this.projection.messages.map((entry, index) =>
      index === existingIndex ? nextMessage : entry
    )
    return true
  }
}

export class AgentStreamHub {
  private readonly entries = new Map<string, AgentHubEntry>()

  constructor(private readonly threadsService: ThreadsService) {}

  async getProjectionEnvelope(threadId: string): Promise<AgentProjectionEnvelope> {
    const entry = await this.ensureEntry(threadId)
    return entry.projector.getEnvelope(null)
  }

  async prepareInvoke(threadId: string, message: AgentInvokeMessage): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    this.notify(threadId, [entry.projector.prepareInvoke(message)])
  }

  async prepareResume(threadId: string): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    this.notify(threadId, [entry.projector.prepareResume()])
  }

  async subscribe(
    threadId: string,
    subscriberId: string,
    listener: (envelope: AgentProjectionEnvelope) => void
  ): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.subscribers.set(subscriberId, listener)
  }

  unsubscribe(threadId: string, subscriberId: string): void {
    const entry = this.entries.get(threadId)
    if (!entry) {
      return
    }

    entry.subscribers.delete(subscriberId)
  }

  async handlePayload(threadId: string, payload: AgentStreamPayload): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    this.notify(threadId, entry.projector.applyPayload(payload))
  }

  private async ensureEntry(threadId: string): Promise<AgentHubEntry> {
    let entry = this.entries.get(threadId)
    if (!entry) {
      entry = {
        hydratePromise: null,
        projector: new ThreadProjectionProjector(threadId),
        subscribers: new Map()
      }
      this.entries.set(threadId, entry)
    }

    if (
      !entry.hydratePromise &&
      entry.projector.getEnvelope(null).projection.messages.length === 0
    ) {
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
    } catch (error) {
      console.error("[AgentStreamHub] Failed to hydrate thread history:", { error, threadId })
    } finally {
      entry.hydratePromise = null
    }
  }

  private notify(threadId: string, events: BaseEvent[]): void {
    const entry = this.entries.get(threadId)
    if (!entry) {
      return
    }

    for (const event of events) {
      const envelope = entry.projector.getEnvelope(event)
      for (const listener of entry.subscribers.values()) {
        listener(envelope)
      }
    }
  }
}
