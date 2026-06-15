import { extractMessageText, type AgentInvokeMessage } from "@shared/message-content"
import type { ToolCallChunk } from "@langchain/core/messages"
import type {
  AgentThreadDataSnapshot,
  HITLDecision,
  Message,
  Subagent,
  ToolCall
} from "@shared/app-types"
import { getFileMutationReview, isFileMutationToolName } from "@shared/file-mutation-review"
import {
  FILE_MUTATION_RESULT_METADATA_KEY,
  type FileMutationResultMetadata
} from "@shared/file-mutation-result"
import {
  AGENT_TOOL_EXECUTION_METADATA_KEY,
  createDefaultAgentThreadRuntimeState,
  reduceAgentThreadRuntimeEvent,
  type AgentToolExecutionError,
  type ActiveAgentToolCall,
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
import { parseCompleteToolCallArgsObject } from "@shared/tool-call-args"
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

function mergeToolCallName(existingName: string, incomingName: string | undefined): string {
  if (!incomingName) {
    return existingName
  }

  if (!existingName || incomingName.startsWith(existingName)) {
    return incomingName
  }

  if (existingName === incomingName || existingName.endsWith(incomingName)) {
    return existingName
  }

  return `${existingName}${incomingName}`
}

class StreamingToolCallAccumulator {
  private toolCalls: ActiveAgentToolCall[] = []

  reset(): void {
    this.toolCalls = []
  }

  update(input: {
    chunks: readonly ToolCallChunk[]
    messageId: string
    runId: string | null
  }): ActiveAgentToolCall[] {
    const updatedToolCalls: ActiveAgentToolCall[] = []

    for (const chunk of input.chunks) {
      const index = chunk.index ?? null
      if (!chunk.id && index === null) {
        continue
      }

      const existingIndex = this.toolCalls.findIndex((toolCall) => {
        if (chunk.id && toolCall.id === chunk.id) {
          return true
        }

        return (
          toolCall.messageId === input.messageId &&
          toolCall.index !== null &&
          index !== null &&
          toolCall.index === index
        )
      })
      const existingToolCall = existingIndex >= 0 ? this.toolCalls[existingIndex] : null
      const id = chunk.id ?? existingToolCall?.id ?? `${input.messageId}:tool:${index}`
      const toolCall: ActiveAgentToolCall = {
        argsText: `${existingToolCall?.argsText ?? ""}${chunk.args ?? ""}`,
        id,
        index,
        messageId: input.messageId,
        name: mergeToolCallName(existingToolCall?.name ?? "", chunk.name),
        runId: input.runId,
        startedAt: existingToolCall?.startedAt ?? new Date(),
        status: "arguments_streaming"
      }

      if (existingIndex >= 0) {
        this.toolCalls[existingIndex] = toolCall
      } else {
        this.toolCalls.push(toolCall)
      }

      updatedToolCalls.push(toolCall)
    }

    return updatedToolCalls
  }

  readToolCall(id: string): ActiveAgentToolCall | null {
    return this.toolCalls.find((toolCall) => toolCall.id === id) ?? null
  }
}

class ThreadRuntimeProjector {
  private readonly pendingRuntimeEvents: AgentThreadEvent[] = []
  private readonly startedToolCallIds = new Set<string>()
  private readonly taskToolCallTracker = new TaskToolCallTracker()
  private readonly toolCallAccumulator = new StreamingToolCallAccumulator()
  private currentMessageId: string | null = null
  private pendingValuesAssistantToolMessage: Message | null = null
  private pendingResumeDecision: HITLDecision | null = null
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
    this.pendingResumeDecision = null
    const userMessage = createUserRuntimeMessage(message)
    this.upsertMessage(userMessage, { appendAssistantText: false })
    this.commitRuntimeEvent({
      run: this.createActiveRun(message.id, null),
      type: "run.started"
    })
  }

  prepareResume(decision?: HITLDecision): void {
    this.resetStreamingState()
    this.pendingResumeDecision = decision ?? null
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
          if (this.pendingResumeDecision) {
            this.commitRuntimeEvent({
              decision: this.pendingResumeDecision,
              resolvedAt: new Date(),
              type: "approval.cleared"
            })
            this.pendingResumeDecision = null
          }
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
        const error = toRuntimeError(payload)
        this.commitRuntimeEvent({
          error,
          status: "error",
          type: "thread.statusChanged"
        })
        this.finishActiveRun("error", error)
        return
    }
  }

  private applyStreamPayload(mode: string, data: unknown): void {
    if (mode === "messages") {
      const decoded = decodeMessagesStreamPayload(data, this.currentMessageId)
      if (decoded.assistant) {
        this.currentMessageId = decoded.assistant.id

        if (
          decoded.assistant.content ||
          decoded.assistant.toolCalls.length > 0 ||
          this.pendingValuesAssistantToolMessage
        ) {
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
          this.mergePendingValuesAssistantToolMessage()
        }

        if (decoded.assistant.toolCallChunks.length > 0) {
          this.commitToolCallChunkEvents(decoded.assistant.id, decoded.assistant.toolCallChunks)
          const subagents = this.taskToolCallTracker.readSubagentsFromToolCallChunks(
            decoded.assistant.toolCallChunks
          )
          if (subagents) {
            this.commitSubagentsReplaced(subagents)
          }
        }

        this.commitToolFactsFromAssistantMessage(
          this.createAssistantRuntimeMessage({
            content: decoded.assistant.content || "",
            id: decoded.assistant.id,
            ...(decoded.assistant.toolCalls.length > 0
              ? { tool_calls: decoded.assistant.toolCalls }
              : {})
          })
        )

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
        const completedAt = new Date()
        const toolCallMessageId = this.ensureCanonicalAssistantToolCallForToolResult(
          decoded.tool.toolCallId
        )
        const toolExecution = this.createToolExecutionUpdate({
          completedAt,
          messageId: decoded.tool.id,
          status: decoded.tool.status === "error" ? "failed" : "completed",
          toolCallId: decoded.tool.toolCallId,
          toolName: decoded.tool.name ?? null,
          ...(decoded.tool.status === "error"
            ? {
                error: {
                  message: extractMessageText(decoded.tool.content).trim() || "Tool execution failed"
                }
              }
            : {})
        })
        const fileMutationResult = this.createFileMutationResultMetadata({
          content: decoded.tool.content,
          status: toolExecution.event.status,
          toolCallId: decoded.tool.toolCallId,
          toolName: toolExecution.event.toolName
        })
        this.upsertMessage(
          {
            content: decoded.tool.content,
            created_at: completedAt,
            id: decoded.tool.id,
            metadata: {
              ...(decoded.tool.metadata ?? {}),
              [AGENT_TOOL_EXECUTION_METADATA_KEY]: toolExecution.metadata,
              ...(fileMutationResult
                ? { [FILE_MUTATION_RESULT_METADATA_KEY]: fileMutationResult }
                : {})
            },
            name: decoded.tool.name,
            role: "tool",
            tool_call_id: decoded.tool.toolCallId
          },
          { appendAssistantText: false }
        )
        this.commitRuntimeEvent({
          messageId: toolCallMessageId,
          runId: this.runtimeState.activeRun?.runId ?? this.runtimeState.latestRunId,
          ...toolExecution.event,
          toolCallId: decoded.tool.toolCallId,
          type: "tool.updated"
        })
        this.currentMessageId = null

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
      if (decoded.messages) {
        this.mergeValuesMessages(decoded.messages)
      }

      if (decoded.todos) {
        this.commitRuntimeEvent({
          todos: decoded.todos,
          type: "todos.replaced"
        })
      }

      if (decoded.pendingApproval) {
        this.commitRuntimeEvent({
          approval: decoded.pendingApproval,
          requestedAt: new Date(),
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

  private commitToolCallChunkEvents(messageId: string, chunks: readonly ToolCallChunk[]): void {
    const toolCalls = this.toolCallAccumulator.update({
      chunks,
      messageId,
      runId: this.runtimeState.activeRun?.runId ?? this.runtimeState.latestRunId
    })

    for (const toolCall of toolCalls) {
      this.commitRuntimeEvent({
        toolCall,
        type: "tool.callUpdated"
      })
    }
  }

  private commitToolStartedEvents(messageId: string, toolCalls: readonly { id?: string }[]): void {
    for (const toolCall of toolCalls) {
      if (!toolCall.id) {
        continue
      }
      if (this.startedToolCallIds.has(toolCall.id)) {
        continue
      }

      this.startedToolCallIds.add(toolCall.id)
      const startedAt = this.findActiveToolCall(toolCall.id)?.startedAt ?? new Date()
      this.commitRuntimeEvent({
        messageId,
        runId: this.runtimeState.activeRun?.runId ?? this.runtimeState.latestRunId,
        startedAt,
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

  private commitToolFactsFromAssistantMessage(message: Message): void {
    if (!message.tool_calls?.length) {
      return
    }

    this.commitToolStartedEvents(message.id, message.tool_calls)
    const subagents = this.taskToolCallTracker.readSubagentsFromCompletedToolCalls(
      message.tool_calls
    )
    if (subagents) {
      this.commitSubagentsReplaced(subagents)
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

  private createActiveRun(userMessageId: string, runId: string | null): ActiveAgentRun {
    const startedAt = this.getCreatedAt(userMessageId)
    return {
      assistantMessageId: null,
      currentToolCallId: null,
      phase: "thinking",
      phaseStartedAt: startedAt,
      runId,
      startedAt,
      status: "running",
      threadId: this.runtimeState.threadId,
      toolCalls: [],
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

  private finishActiveRun(status: TerminalRuntimeStatus, error: IpcErrorPayload | null = null): void {
    if (status === "interrupted" && this.runtimeState.activeRun?.status === "waiting_approval") {
      return
    }

    const completedAt = new Date()
    const startedAt = this.runtimeState.activeRun?.startedAt ?? null
    const terminalStatus =
      status === "cancelled" ? "cancelled" : status === "error" ? "failed" : "completed"
    this.commitRuntimeEvent({
      completedAt,
      durationMs: startedAt ? Math.max(0, completedAt.getTime() - startedAt.getTime()) : null,
      error,
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
    const currentToolCallId = lastAssistant.tool_calls?.at(-1)?.id ?? null
    if (
      activeRun.assistantMessageId === lastAssistant.id &&
      activeRun.currentToolCallId === currentToolCallId &&
      activeRun.phase === phase &&
      activeRun.toolCalls.length === 0
    ) {
      return false
    }

    this.commitRuntimeEvent({
      message: lastAssistant,
      type: "message.upserted"
    })
    return true
  }

  private readCurrentTurnAssistantIds(): Set<string> {
    const activeRun = this.runtimeState.activeRun
    if (!activeRun) {
      return new Set()
    }

    return new Set(
      this.getVisibleMessagesForTurn(activeRun.turnId)
        .filter((message) => message.role === "assistant")
        .map((message) => message.id)
    )
  }

  private mergeValuesMessageIntoRuntime(message: Message): boolean {
    const existingMessage = this.runtimeState.messagesPage.find((entry) => entry.id === message.id)
    if (!existingMessage) {
      return false
    }

    if (
      existingMessage.role === "assistant" &&
      message.role === "assistant" &&
      !existingMessage.tool_calls?.length &&
      (message.tool_calls?.length ?? 0) > 0
    ) {
      return this.upsertMessage(
        {
          ...existingMessage,
          metadata: message.metadata ?? existingMessage.metadata,
          tool_calls: message.tool_calls
        },
        { appendAssistantText: false }
      )
    }

    if (existingMessage.role === "tool" && message.role === "tool") {
      return this.upsertMessage(
        {
          ...existingMessage,
          metadata: message.metadata ?? existingMessage.metadata,
          name: message.name ?? existingMessage.name,
          tool_call_id: message.tool_call_id ?? existingMessage.tool_call_id
        },
        { appendAssistantText: false }
      )
    }

    return false
  }

  private mergeValuesAssistantIntoCurrentStream(message: Message): boolean {
    const assistantMessageId = this.runtimeState.activeRun?.assistantMessageId
    if (!assistantMessageId || !message.tool_calls?.length) {
      return false
    }

    const existingMessage = this.runtimeState.messagesPage.find(
      (entry) => entry.id === assistantMessageId && entry.role === "assistant"
    )
    if (!existingMessage || existingMessage.tool_calls?.length) {
      return false
    }

    return this.upsertMessage(
      {
        ...existingMessage,
        metadata: message.metadata ?? existingMessage.metadata,
        tool_calls: message.tool_calls
      },
      { appendAssistantText: false }
    )
  }

  private findValuesAssistantForCurrentStream(messages: readonly Message[]): Message | null {
    const activeRun = this.runtimeState.activeRun
    if (!activeRun) {
      return null
    }

    if (activeRun.assistantMessageId) {
      const currentAssistant = this.runtimeState.messagesPage.find(
        (message) => message.id === activeRun.assistantMessageId && message.role === "assistant"
      )
      if (currentAssistant?.tool_calls?.length) {
        return null
      }
    }

    const existingToolCallIds = new Set<string>()
    for (const message of this.getVisibleMessagesForTurn(activeRun.turnId)) {
      if (message.role !== "assistant") {
        continue
      }

      for (const toolCall of message.tool_calls ?? []) {
        existingToolCallIds.add(toolCall.id)
      }
    }

    const turnStartIndex = messages.findIndex(
      (message) => message.role === "user" && message.id === activeRun.turnId
    )
    if (turnStartIndex < 0) {
      return null
    }

    const nextTurnStartIndex = messages.findIndex(
      (message, index) => index > turnStartIndex && message.role === "user"
    )
    const turnEndIndex = nextTurnStartIndex < 0 ? messages.length : nextTurnStartIndex
    return (
      messages
        .slice(turnStartIndex, turnEndIndex)
        .filter(
          (message) =>
            message.role === "assistant" &&
            (message.tool_calls?.length ?? 0) > 0 &&
            !message.tool_calls?.some((toolCall) => existingToolCallIds.has(toolCall.id))
        )
        .at(-1) ?? null
    )
  }

  private mergeValuesMessages(messages: readonly Message[]): void {
    if (!this.runtimeState.activeRun) {
      return
    }

    const currentTurnAssistantIds = this.readCurrentTurnAssistantIds()
    for (const message of messages) {
      if (message.role === "assistant" && currentTurnAssistantIds.has(message.id)) {
        const changed = this.mergeValuesMessageIntoRuntime(message)
        if (changed) {
          this.commitToolFactsFromAssistantMessage(message)
        }
      }

      if (message.role === "tool") {
        this.mergeValuesMessageIntoRuntime(message)
      }
    }

    const valuesAssistant = this.findValuesAssistantForCurrentStream(messages)
    const activeAssistantId = this.runtimeState.activeRun.assistantMessageId
    if (
      valuesAssistant &&
      activeAssistantId &&
      this.mergeValuesAssistantIntoCurrentStream(valuesAssistant)
    ) {
      this.commitToolFactsFromAssistantMessage({
        ...valuesAssistant,
        id: activeAssistantId
      })
      this.pendingValuesAssistantToolMessage = null
      return
    }

    if (valuesAssistant) {
      this.pendingValuesAssistantToolMessage = valuesAssistant
    }
  }

  private mergePendingValuesAssistantToolMessage(): void {
    const valuesAssistant = this.pendingValuesAssistantToolMessage
    const activeAssistantId = this.runtimeState.activeRun?.assistantMessageId
    if (!valuesAssistant || !activeAssistantId) {
      return
    }

    if (!this.mergeValuesAssistantIntoCurrentStream(valuesAssistant)) {
      return
    }

    this.commitToolFactsFromAssistantMessage({
      ...valuesAssistant,
      id: activeAssistantId
    })
    this.pendingValuesAssistantToolMessage = null
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

  private findToolCallMessageId(toolCallId: string): string | null {
    for (const message of this.runtimeState.messagesPage) {
      if (
        message.role === "assistant" &&
        message.tool_calls?.some((toolCall) => toolCall.id === toolCallId)
      ) {
        return message.id
      }
    }

    return null
  }

  private ensureCanonicalAssistantToolCallForToolResult(toolCallId: string): string | null {
    const existingMessageId = this.findToolCallMessageId(toolCallId)
    if (existingMessageId) {
      return existingMessageId
    }

    return this.materializeAssistantToolCallFromCompleteStreamingArgs(toolCallId)
  }

  private materializeAssistantToolCallFromCompleteStreamingArgs(toolCallId: string): string | null {
    const activeToolCall = this.toolCallAccumulator.readToolCall(toolCallId)
    if (!activeToolCall?.messageId || !activeToolCall.name) {
      return null
    }

    const args = parseCompleteToolCallArgsObject(activeToolCall.argsText)
    if (!args) {
      return null
    }

    const assistantMessage = this.runtimeState.messagesPage.find(
      (message) => message.id === activeToolCall.messageId && message.role === "assistant"
    )
    const toolCall: ToolCall = {
      args,
      id: activeToolCall.id,
      name: activeToolCall.name,
      type: "tool_call"
    }

    const nextMessage: Message = assistantMessage
      ? {
          ...assistantMessage,
          tool_calls: [...(assistantMessage.tool_calls ?? []), toolCall]
        }
      : {
          content: "",
          created_at: activeToolCall.startedAt,
          id: activeToolCall.messageId,
          role: "assistant",
          tool_calls: [toolCall]
        }

    this.upsertMessage(nextMessage, { appendAssistantText: false })
    this.commitToolFactsFromAssistantMessage(nextMessage)
    return activeToolCall.messageId
  }

  private getCreatedAt(messageId: string): Date {
    const existingMessage = this.runtimeState.messagesPage.find(
      (message) => message.id === messageId
    )
    return existingMessage?.created_at ?? new Date()
  }

  private findActiveToolCall(toolCallId: string): ActiveAgentToolCall | null {
    return (
      this.runtimeState.activeRun?.toolCalls.find((toolCall) => toolCall.id === toolCallId) ?? null
    )
  }

  private findCompletedToolCall(toolCallId: string): ToolCall | null {
    for (const message of this.runtimeState.messagesPage) {
      const toolCall = message.tool_calls?.find((entry) => entry.id === toolCallId)
      if (toolCall) {
        return toolCall
      }
    }

    return null
  }

  private readToolCallArgs(toolCallId: string): Record<string, unknown> | null {
    const completedToolCall = this.findCompletedToolCall(toolCallId)
    if (completedToolCall) {
      return completedToolCall.args
    }

    const activeToolCall = this.toolCallAccumulator.readToolCall(toolCallId)
    return activeToolCall ? parseCompleteToolCallArgsObject(activeToolCall.argsText) : null
  }

  private createFileMutationResultMetadata(input: {
    content: Message["content"]
    status: "completed" | "failed"
    toolCallId: string
    toolName: string | null
  }): FileMutationResultMetadata | null {
    const { status, toolCallId, toolName } = input
    if (status !== "completed" || !toolName || !isFileMutationToolName(toolName)) {
      return null
    }

    const text = extractMessageText(input.content).trim()
    const isSuccess =
      toolName === "write_file"
        ? text.startsWith("Successfully wrote to ")
        : text.startsWith("Successfully replaced ")
    if (!isSuccess) {
      return null
    }

    const args = this.readToolCallArgs(toolCallId)
    const review = args ? getFileMutationReview(toolName, args) : null
    if (!review?.path) {
      return null
    }

    if (review.toolName === "write_file" && review.content !== null) {
      return {
        files: [
          {
            after: review.content,
            before: null,
            changeType: null,
            path: review.path
          }
        ],
        status: "completed",
        toolCallId,
        toolName: review.toolName
      }
    }

    if (review.toolName === "edit_file" && (review.oldText !== null || review.newText !== null)) {
      return {
        files: [
          {
            after: review.newText,
            before: review.oldText,
            changeType: "modify",
            path: review.path
          }
        ],
        status: "completed",
        toolCallId,
        toolName: review.toolName
      }
    }

    return null
  }

  private createToolExecutionUpdate(input: {
    completedAt: Date
    error?: AgentToolExecutionError
    messageId: string
    status: "completed" | "failed"
    toolCallId: string
    toolName: string | null
  }): {
    event: {
      completedAt: Date
      durationMs: number | null
      error: AgentToolExecutionError | null
      startedAt: Date | null
      status: "completed" | "failed"
      toolName: string | null
    }
    metadata: {
      completedAt: Date
      durationMs?: number
      error?: AgentToolExecutionError
      messageId: string
      runId: string | null
      startedAt?: Date
      status: "completed" | "failed"
      toolCallId: string
      toolName: string | null
    }
  } {
    const activeToolCall = this.findActiveToolCall(input.toolCallId)
    const startedAt = activeToolCall?.startedAt ?? null
    const durationMs = startedAt
      ? Math.max(0, input.completedAt.getTime() - startedAt.getTime())
      : null
    const toolName = input.toolName ?? activeToolCall?.name ?? null
    const runId =
      activeToolCall?.runId ?? this.runtimeState.activeRun?.runId ?? this.runtimeState.latestRunId

    return {
      event: {
        completedAt: input.completedAt,
        durationMs,
        error: input.error ?? null,
        startedAt,
        status: input.status,
        toolName
      },
      metadata: {
        completedAt: input.completedAt,
        ...(durationMs !== null ? { durationMs } : {}),
        ...(input.error ? { error: input.error } : {}),
        messageId: input.messageId,
        runId,
        ...(startedAt ? { startedAt } : {}),
        status: input.status,
        toolCallId: input.toolCallId,
        toolName
      }
    }
  }

  private resetStreamingState(): void {
    this.startedToolCallIds.clear()
    this.taskToolCallTracker.reset()
    this.toolCallAccumulator.reset()
    this.currentMessageId = null
    this.pendingValuesAssistantToolMessage = null
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
        deltaAt: new Date(),
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

  async prepareResume(threadId: string, decision?: HITLDecision): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.replayEvents = []
    entry.projector.prepareResume(decision)
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
