import { extractMessageText, type AgentInvokeMessage } from "@shared/message-content"
import {
  JingleStreamingToolCallAccumulator,
  selectJingleValuesAssistantForCurrentStream,
  type AppliedAgentSteer,
  type JingleLangGraphToolCallChunk
} from "@jingle/langchain-agent-harness/transitional"
import type { AgentThreadDataSnapshot, HITLDecision, Message, ToolCall } from "@shared/app-types"
import { getFileMutationReview, isFileMutationToolName } from "@shared/file-mutation-review"
import {
  mergeJingleSteeringAppliedMarkerMetadata,
  mergeJingleSteeringStatusMetadata,
  readJingleSteeringAppliedMarker,
  readJingleSteeringStatus
} from "@shared/message-steering"
import {
  FILE_MUTATION_RESULT_METADATA_KEY,
  type FileMutationResultMetadata
} from "@shared/file-mutation-result"
import type {
  JingleRuntimeStatus,
  JingleToolExecutionError,
  JingleActiveAgentToolCall,
  JingleActiveAgentRun,
  JingleAgentRunPhase,
  JingleAgentFollowUpQueueItem,
  JingleAgentFollowUpQueueSummary,
  JingleAgentRuntimeReplayOptions,
  JingleRuntimeEventBatch
} from "@jingle/agent-client"
import {
  createEmptyJingleAgentFollowUpQueueSummary,
  JINGLE_TOOL_EXECUTION_METADATA_KEY,
  readJingleToolExecutionTiming,
  reduceJingleAgentThreadRuntimeEvent,
  summarizeJingleAgentFollowUpQueue
} from "@jingle/agent-client"
import {
  createDefaultAgentThreadRuntimeState,
  type AgentThreadEvent,
  type AgentThreadEventDraft,
  type AgentThreadRuntimeState
} from "@shared/agent-thread-contract"
import { deriveThreadBootstrapState } from "@shared/agent-thread-bootstrap"
import { parseCompleteToolCallArgsObject } from "@shared/tool-call-args"
import type { AgentStreamPayload } from "./service"
import { parseAgentRunFailure, type AgentRunFailure } from "@shared/agent-run-failure"
import {
  appendAssistantMessageContent,
  createUserRuntimeMessage,
  decodeMessagesStreamPayload,
  decodeValuesStreamPayload,
  sanitizeAssistantHistoryMessages,
  selectExecutionValuesToolMessages,
  toTokenUsage,
  type DecodedToolMessageChunk,
  type DecodedValuesToolMessageChunk
} from "./agent-stream-codec"

type TerminalRuntimeStatus = "idle" | "interrupted" | "error" | "cancelled"
type ToolResultFinalization = "applied" | "duplicate" | "unmatched"
type JingleAppliedAgentSteer = AppliedAgentSteer<
  AgentInvokeMessage["content"],
  NonNullable<AgentInvokeMessage["refs"]>
>

interface AgentHubEntry {
  eventSubscribers: Map<string, (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void>
  hydrated: boolean
  hydratePromise: Promise<void> | null
  projector: ThreadRuntimeProjector
  replayEvents: AgentThreadEvent[]
}

interface AgentThreadHistoryReader {
  getPersistedAgentThreadData(threadId: string): Promise<AgentThreadDataSnapshot>
}

function toThreadSnapshotStatus(
  status: JingleRuntimeStatus
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

function hasRuntimeSnapshotDiverged(
  runtimeState: AgentThreadRuntimeState,
  persistedThreadData: AgentThreadDataSnapshot
): boolean {
  const persistedMessages = persistedThreadData.messages.messages
  if (runtimeState.messagesPage.length !== persistedMessages.length) {
    return true
  }

  return runtimeState.messagesPage.some((message, index) => {
    return message.id !== persistedMessages[index]?.id
  })
}

class ThreadRuntimeProjector {
  private readonly pendingRuntimeEvents: AgentThreadEvent[] = []
  private readonly startedToolCallIds = new Set<string>()
  private readonly toolCallAccumulator = new JingleStreamingToolCallAccumulator()
  private currentMessageId: string | null = null
  private pendingValuesAssistantToolMessage: Message | null = null
  private readonly pendingValuesToolResults = new Map<
    string,
    { result: DecodedValuesToolMessageChunk; turnId: string }
  >()
  private pendingResumeDecision: HITLDecision | null = null
  private runtimeState: AgentThreadRuntimeState
  private terminalSettled = true

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
      contextInclusions: bootstrap.contextInclusions,
      error: bootstrap.error,
      hasMoreBefore: false,
      latestRunId: bootstrap.latestRunId,
      followUpQueue: createEmptyJingleAgentFollowUpQueueSummary(),
      messagesPage: messages,
      pendingApproval: bootstrap.pendingApproval,
      revision: 0,
      status: bootstrap.status,
      threadId: this.runtimeState.threadId,
      todos: bootstrap.todos,
      tokenUsage: null
    }
  }

  prepareInvoke(message: AgentInvokeMessage): void {
    this.resetStreamingState()
    this.terminalSettled = false
    this.pendingResumeDecision = null
    const userMessage = createUserRuntimeMessage(message)
    this.upsertMessage(userMessage, { appendAssistantText: false })
    this.commitRuntimeEvent({
      run: this.createActiveRun(message.id, null),
      type: "run.started"
    })
  }

  applyFollowUpQueueSummary(summary: JingleAgentFollowUpQueueSummary): void {
    this.commitRuntimeEvent({
      summary,
      type: "followUp.queueChanged"
    })
  }

  prepareEditLastUserMessageAndInvoke(message: AgentInvokeMessage): void {
    this.resetStreamingState()
    this.terminalSettled = false
    this.pendingResumeDecision = null
    const userMessage = createUserRuntimeMessage(message)
    this.upsertMessage(userMessage, { appendAssistantText: false })
    this.commitRuntimeEvent({
      messageId: userMessage.id,
      type: "message.truncatedAfter"
    })
    this.commitRuntimeEvent({
      run: this.createActiveRun(userMessage.id, null),
      type: "run.started"
    })
  }

  async prepareSteeringMessage(message: AgentInvokeMessage, acceptedAt: Date): Promise<void> {
    const existing = this.runtimeState.messagesPage.find((entry) => entry.id === message.id)
    if (readJingleSteeringStatus(existing?.metadata) === "applied") {
      return
    }

    const userMessage = createUserRuntimeMessage(message, {
      createdAt: acceptedAt,
      metadata: mergeJingleSteeringStatusMetadata(undefined, "pending")
    })
    this.upsertMessage(userMessage, { appendAssistantText: false })
  }

  async markSteeringApplied(steers: readonly JingleAppliedAgentSteer[]): Promise<void> {
    if (steers.length === 0) {
      return
    }

    const messagesById = new Map(
      this.runtimeState.messagesPage.map((message) => [message.id, message])
    )

    for (const steer of steers) {
      const appliedAt = new Date()
      const appliedMetadata = mergeJingleSteeringStatusMetadata(undefined, "applied")
      const existing = messagesById.get(steer.messageId)
      if (!existing) {
        this.upsertMessage(
          createUserRuntimeMessage(
            {
              content: steer.content,
              id: steer.messageId,
              refs: steer.refs
            },
            {
              createdAt: steer.acceptedAt,
              metadata: appliedMetadata
            }
          ),
          { appendAssistantText: false }
        )
      } else {
        this.upsertMessage(
          {
            ...existing,
            metadata: mergeJingleSteeringStatusMetadata(existing.metadata, "applied")
          },
          { appendAssistantText: false }
        )
      }

      this.upsertMessage(
        {
          content: "",
          created_at: appliedAt,
          id: `steer-applied:${steer.messageId}`,
          metadata: mergeJingleSteeringAppliedMarkerMetadata(undefined, {
            kind: "applied",
            messageId: steer.messageId,
            runId: steer.runId
          }),
          role: "system"
        },
        { appendAssistantText: false }
      )
      this.commitRuntimeEvent({
        appliedAt,
        messageId: steer.messageId,
        runId: steer.runId,
        type: "steer.applied"
      })
    }
  }

  prepareResume(decision?: HITLDecision): void {
    this.resetStreamingState()
    this.terminalSettled = false
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

      case "context_inclusions":
        this.commitRuntimeEvent({
          inclusions: payload.inclusions,
          type: "context.inclusionsReplaced"
        })
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

      case "error": {
        const error = parseAgentRunFailure(payload.failure)
        if (!error) {
          throw new Error("[AgentThreadRunner] Received an invalid agent run failure payload.")
        }
        if (this.terminalSettled) {
          return
        }
        if (this.runtimeState.pendingApproval) {
          this.terminalSettled = true
          this.commitRuntimeEvent({
            error,
            status: "interrupted",
            type: "thread.statusChanged"
          })
          return
        }
        this.terminalSettled = true
        this.commitRuntimeEvent({
          error,
          status: "error",
          type: "thread.statusChanged"
        })
        this.finishActiveRun("error", error, { terminalClaimed: true })
        return
      }
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
        this.flushPendingValuesToolResults()

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
        this.finalizeToolResult(decoded.tool, { requireCurrentTurnToolCall: false })
        this.currentMessageId = null
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

      const activeTurnId = this.runtimeState.activeRun?.turnId ?? null
      const valuesToolMessages = decoded.messages
        ? selectExecutionValuesToolMessages({
            messages: decoded.messages,
            targetTurnId: activeTurnId,
            toolMessages: decoded.toolMessages
          })
        : []
      for (const toolMessage of valuesToolMessages) {
        if (
          this.finalizeToolResult(toolMessage, { requireCurrentTurnToolCall: true }) ===
            "unmatched" &&
          activeTurnId
        ) {
          this.rememberPendingValuesToolResult(toolMessage, activeTurnId)
        }
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

      if (decoded.contextInclusions) {
        this.commitRuntimeEvent({
          inclusions: decoded.contextInclusions,
          type: "context.inclusionsReplaced"
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
    const nextRuntimeState = reduceJingleAgentThreadRuntimeEvent(this.runtimeState, event)
    if (nextRuntimeState === this.runtimeState) {
      return null
    }

    this.runtimeState = nextRuntimeState
    this.pendingRuntimeEvents.push(structuredClone(event))
    return event
  }

  private commitToolCallChunkEvents(
    messageId: string,
    chunks: readonly JingleLangGraphToolCallChunk[]
  ): void {
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

  private commitToolFactsFromAssistantMessage(message: Message): void {
    if (!message.tool_calls?.length) {
      return
    }

    this.commitToolStartedEvents(message.id, message.tool_calls)
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

  private createActiveRun(userMessageId: string, runId: string | null): JingleActiveAgentRun {
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
  ): JingleActiveAgentRun | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.role === "user") {
        return this.createActiveRun(message.id, this.runtimeState.latestRunId)
      }
    }

    return null
  }

  private finishActiveRun(
    status: TerminalRuntimeStatus,
    error: AgentRunFailure | null = null,
    options: { terminalClaimed?: boolean } = {}
  ): void {
    if (status === "interrupted" && this.runtimeState.activeRun?.status === "waiting_approval") {
      this.terminalSettled = true
      if (this.runtimeState.status !== "interrupted") {
        this.commitRuntimeEvent({
          error: this.runtimeState.error,
          status: "interrupted",
          type: "thread.statusChanged"
        })
      }
      return
    }
    if (!options.terminalClaimed) {
      if (this.terminalSettled) {
        return
      }
      this.terminalSettled = true
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

    const phase: JingleAgentRunPhase =
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

    const assistantIds = new Set<string>()
    for (const message of this.getVisibleMessagesForTurn(activeRun.turnId)) {
      if (message.role === "assistant") {
        assistantIds.add(message.id)
      }
    }

    return assistantIds
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
      const toolCalls = message.tool_calls ?? []
      const changed = this.upsertMessage(
        {
          ...existingMessage,
          metadata: message.metadata ?? existingMessage.metadata,
          tool_calls: toolCalls
        },
        { appendAssistantText: false }
      )
      const backfilled = changed
        ? this.backfillFileMutationResultMetadataForToolCalls(toolCalls)
        : false
      return changed || backfilled
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

    const toolCalls = message.tool_calls
    const changed = this.upsertMessage(
      {
        ...existingMessage,
        metadata: message.metadata ?? existingMessage.metadata,
        tool_calls: toolCalls
      },
      { appendAssistantText: false }
    )
    const backfilled = changed
      ? this.backfillFileMutationResultMetadataForToolCalls(toolCalls)
      : false
    return changed || backfilled
  }

  private backfillFileMutationResultMetadataForToolCalls(toolCalls: readonly ToolCall[]): boolean {
    let changed = false
    for (const toolCall of toolCalls) {
      if (this.backfillFileMutationResultMetadataForToolCall(toolCall)) {
        changed = true
      }
    }
    return changed
  }

  private backfillFileMutationResultMetadataForToolCall(toolCall: ToolCall): boolean {
    if (!isFileMutationToolName(toolCall.name)) {
      return false
    }

    const toolMessage = this.runtimeState.messagesPage.find(
      (message) => message.role === "tool" && message.tool_call_id === toolCall.id
    )
    if (!toolMessage || toolMessage.metadata?.[FILE_MUTATION_RESULT_METADATA_KEY]) {
      return false
    }

    const timing = readJingleToolExecutionTiming(toolMessage)
    const status =
      timing?.status === "completed" ? "completed" : timing?.status === "failed" ? "failed" : null
    if (!status) {
      return false
    }

    const fileMutationResult = this.createFileMutationResultMetadata({
      content: toolMessage.content,
      status,
      toolCallId: toolCall.id,
      toolName: toolCall.name
    })
    if (!fileMutationResult) {
      return false
    }

    return this.upsertMessage(
      {
        ...toolMessage,
        metadata: {
          ...(toolMessage.metadata ?? {}),
          [FILE_MUTATION_RESULT_METADATA_KEY]: fileMutationResult
        },
        name: toolCall.name
      },
      { appendAssistantText: false }
    )
  }

  private findValuesAssistantForCurrentStream(messages: readonly Message[]): Message | null {
    const activeRun = this.runtimeState.activeRun
    if (!activeRun) {
      return null
    }

    return selectJingleValuesAssistantForCurrentStream({
      activeAssistantMessageId: activeRun.assistantMessageId,
      activeTurnId: activeRun.turnId,
      currentTurnMessages: this.getVisibleMessagesForTurn(activeRun.turnId),
      getId: (message) => message.id,
      getRole: (message) => message.role,
      getToolCallIds: (message) => message.tool_calls?.map((toolCall) => toolCall.id) ?? [],
      valuesMessages: messages
    })
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
      this.flushPendingValuesToolResults()
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

    const materialized =
      this.mergeValuesAssistantIntoCurrentStream(valuesAssistant) ||
      this.currentAssistantOwnsValuesToolCalls(valuesAssistant)
    if (!materialized) {
      return
    }

    this.commitToolFactsFromAssistantMessage({
      ...valuesAssistant,
      id: activeAssistantId
    })
    this.pendingValuesAssistantToolMessage = null
    this.flushPendingValuesToolResults()
  }

  private currentAssistantOwnsValuesToolCalls(valuesAssistant: Message): boolean {
    const activeAssistantId = this.runtimeState.activeRun?.assistantMessageId
    const valuesToolCalls = valuesAssistant.tool_calls ?? []
    if (!activeAssistantId || valuesToolCalls.length === 0) {
      return false
    }

    const activeAssistant = this.runtimeState.messagesPage.find(
      (message) => message.role === "assistant" && message.id === activeAssistantId
    )
    const activeToolCallIds = new Set(
      activeAssistant?.tool_calls?.map((toolCall) => toolCall.id) ?? []
    )
    return valuesToolCalls.every((toolCall) => activeToolCallIds.has(toolCall.id))
  }

  private rememberPendingValuesToolResult(
    toolMessage: DecodedValuesToolMessageChunk,
    turnId: string
  ): void {
    this.pendingValuesToolResults.set(toolMessage.toolCallId, {
      result: toolMessage,
      turnId
    })
  }

  private flushPendingValuesToolResults(): void {
    const activeTurnId = this.runtimeState.activeRun?.turnId ?? null
    for (const [toolCallId, pending] of this.pendingValuesToolResults) {
      if (!activeTurnId || pending.turnId !== activeTurnId) {
        this.pendingValuesToolResults.delete(toolCallId)
        continue
      }

      if (
        this.finalizeToolResult(pending.result, { requireCurrentTurnToolCall: true }) !==
        "unmatched"
      ) {
        this.pendingValuesToolResults.delete(toolCallId)
      }
    }
  }

  private getVisibleMessagesForTurn(
    turnId: string,
    messages = this.runtimeState.messagesPage
  ): Message[] {
    const visibleMessages = messages.filter(
      (message) =>
        message.role !== "tool" && readJingleSteeringAppliedMarker(message.metadata) === null
    )
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

  private findCurrentTurnToolCallMessageId(toolCallId: string): string | null {
    const activeRun = this.runtimeState.activeRun
    if (!activeRun) {
      return null
    }

    for (const message of this.getVisibleMessagesForTurn(activeRun.turnId)) {
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

  private findActiveToolCall(toolCallId: string): JingleActiveAgentToolCall | null {
    return (
      this.runtimeState.activeRun?.toolCalls.find((toolCall) => toolCall.id === toolCallId) ?? null
    )
  }

  private findCompletedToolCall(toolCallId: string): ToolCall | null {
    for (const message of this.runtimeState.messagesPage) {
      for (const toolCall of message.tool_calls ?? []) {
        if (toolCall.id === toolCallId) {
          return toolCall
        }
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

  private getCanonicalToolCallName(
    toolCallId: string,
    fallbackName: string | undefined
  ): string | null {
    const completedToolCall = this.findCompletedToolCall(toolCallId)
    if (completedToolCall?.name) {
      return completedToolCall.name
    }

    const activeToolCall = this.toolCallAccumulator.readToolCall(toolCallId)
    if (activeToolCall?.name) {
      return activeToolCall.name
    }

    return fallbackName ?? null
  }

  private finalizeToolResult(
    toolMessage: DecodedToolMessageChunk,
    options: { requireCurrentTurnToolCall: boolean }
  ): ToolResultFinalization {
    const existingResult = this.runtimeState.messagesPage.find(
      (message) => message.role === "tool" && message.tool_call_id === toolMessage.toolCallId
    )
    if (existingResult) {
      return "duplicate"
    }

    const toolCallMessageId = options.requireCurrentTurnToolCall
      ? this.findCurrentTurnToolCallMessageId(toolMessage.toolCallId)
      : this.ensureCanonicalAssistantToolCallForToolResult(toolMessage.toolCallId)
    if (options.requireCurrentTurnToolCall && !toolCallMessageId) {
      return "unmatched"
    }

    const completedAt = new Date()
    const toolName = this.getCanonicalToolCallName(toolMessage.toolCallId, toolMessage.name)
    const toolExecution = this.createToolExecutionUpdate({
      completedAt,
      messageId: toolMessage.id,
      status: toolMessage.status === "error" ? "failed" : "completed",
      toolCallId: toolMessage.toolCallId,
      toolName,
      ...(toolMessage.status === "error"
        ? {
            error: {
              message: extractMessageText(toolMessage.content).trim() || "Tool execution failed"
            }
          }
        : {})
    })
    const fileMutationResult = this.createFileMutationResultMetadata({
      content: toolMessage.content,
      status: toolExecution.event.status,
      toolCallId: toolMessage.toolCallId,
      toolName: toolExecution.event.toolName
    })
    this.upsertMessage(
      {
        content: toolMessage.content,
        created_at: completedAt,
        id: toolMessage.id,
        metadata: {
          ...(toolMessage.metadata ?? {}),
          [JINGLE_TOOL_EXECUTION_METADATA_KEY]: toolExecution.metadata,
          ...(fileMutationResult ? { [FILE_MUTATION_RESULT_METADATA_KEY]: fileMutationResult } : {})
        },
        name: toolName ?? toolMessage.name,
        role: "tool",
        tool_call_id: toolMessage.toolCallId
      },
      { appendAssistantText: false }
    )
    this.commitRuntimeEvent({
      messageId: toolCallMessageId,
      runId: this.runtimeState.activeRun?.runId ?? this.runtimeState.latestRunId,
      ...toolExecution.event,
      toolCallId: toolMessage.toolCallId,
      type: "tool.updated"
    })
    if (options.requireCurrentTurnToolCall && this.currentMessageId === toolCallMessageId) {
      this.currentMessageId = null
    }
    return "applied"
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
    error?: JingleToolExecutionError
    messageId: string
    status: "completed" | "failed"
    toolCallId: string
    toolName: string | null
  }): {
    event: {
      completedAt: Date
      durationMs: number | null
      error: JingleToolExecutionError | null
      startedAt: Date | null
      status: "completed" | "failed"
      toolName: string | null
    }
    metadata: {
      completedAt: Date
      durationMs?: number
      error?: JingleToolExecutionError
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
    this.toolCallAccumulator.reset()
    this.currentMessageId = null
    this.pendingValuesAssistantToolMessage = null
    this.pendingValuesToolResults.clear()
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
  private readonly eventListeners = new Map<
    string,
    (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void
  >()

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

  async prepareEditLastUserMessageAndInvoke(
    threadId: string,
    message: AgentInvokeMessage
  ): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.replayEvents = []
    entry.projector.prepareEditLastUserMessageAndInvoke(message)
    this.notify(threadId)
  }

  async prepareResume(threadId: string, decision?: HITLDecision): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.replayEvents = []
    entry.projector.prepareResume(decision)
    this.notify(threadId)
  }

  async markSteeringApplied(
    threadId: string,
    steers: readonly JingleAppliedAgentSteer[]
  ): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    await entry.projector.markSteeringApplied(steers)
    this.notify(threadId)
  }

  async prepareSteeringMessage(
    threadId: string,
    message: AgentInvokeMessage,
    acceptedAt: Date
  ): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    await entry.projector.prepareSteeringMessage(message, acceptedAt)
    this.notify(threadId)
  }

  async applyFollowUpQueueSummary(
    threadId: string,
    summary: JingleAgentFollowUpQueueSummary
  ): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.projector.applyFollowUpQueueSummary(summary)
    this.notify(threadId)
  }

  async enqueueFollowUp(
    threadId: string,
    input: { messageInput: JingleAgentFollowUpQueueItem["messageInput"] }
  ): Promise<JingleAgentFollowUpQueueItem> {
    const entry = await this.ensureEntry(threadId)
    const item: JingleAgentFollowUpQueueItem = {
      messageInput: input.messageInput,
      requestId: crypto.randomUUID(),
      text: input.messageInput.text.trim()
    }
    const state = entry.projector.readState()
    entry.projector.applyFollowUpQueueSummary(
      summarizeJingleAgentFollowUpQueue([...state.followUpQueue.items, item])
    )
    this.notify(threadId)
    return item
  }

  async removeFollowUp(threadId: string, requestId: string): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    const state = entry.projector.readState()
    entry.projector.applyFollowUpQueueSummary(
      summarizeJingleAgentFollowUpQueue(
        state.followUpQueue.items.filter((item) => item.requestId !== requestId)
      )
    )
    this.notify(threadId)
  }

  async restoreFollowUp(threadId: string, item: JingleAgentFollowUpQueueItem): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    const state = entry.projector.readState()
    if (state.followUpQueue.items.some((entryItem) => entryItem.requestId === item.requestId)) {
      return
    }

    entry.projector.applyFollowUpQueueSummary(
      summarizeJingleAgentFollowUpQueue([item, ...state.followUpQueue.items])
    )
    this.notify(threadId)
  }

  async takeFollowUp(
    threadId: string,
    requestId: string
  ): Promise<JingleAgentFollowUpQueueItem | null> {
    const entry = await this.ensureEntry(threadId)
    const state = entry.projector.readState()
    const item = state.followUpQueue.items.find((entryItem) => entryItem.requestId === requestId)
    if (!item) {
      return null
    }

    entry.projector.applyFollowUpQueueSummary(
      summarizeJingleAgentFollowUpQueue(
        state.followUpQueue.items.filter((entryItem) => entryItem.requestId !== requestId)
      )
    )
    this.notify(threadId)
    return item
  }

  async connectThreadEvents(
    threadId: string,
    subscriberId: string,
    listener: (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void,
    options: JingleAgentRuntimeReplayOptions = {}
  ): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    entry.eventSubscribers.set(subscriberId, listener)
    this.replayThreadEvents(threadId, entry, listener, options)
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
    listener: (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void
  ): () => void {
    this.eventListeners.set(subscriberId, listener)

    return () => {
      this.eventListeners.delete(subscriberId)
    }
  }

  readLiveThreadDataSnapshot(
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
    const isInactive =
      runtimeState.status === "idle" &&
      runtimeState.activeRun === null &&
      runtimeState.pendingApproval === null
    if (isInactive && !hasRuntimeSnapshotDiverged(runtimeState, persistedThreadData)) {
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
        error: runtimeState.error,
        contextInclusions: runtimeState.contextInclusions,
        forkState: toRuntimeForkState(runtimeState, persistedThreadData.runState.forkState),
        pendingApproval: runtimeState.pendingApproval,
        runId: runtimeState.latestRunId ?? persistedThreadData.runState.runId,
        todos: runtimeState.todos,
        workspacePath: persistedThreadData.runState.workspacePath
      }
    }
  }

  async handlePayload(threadId: string, payload: AgentStreamPayload): Promise<void> {
    const entry = await this.ensureEntry(threadId)
    const previousRevision = entry.projector.readState().revision
    entry.projector.applyPayload(payload)
    this.notify(threadId)
    if (payload.type === "done" || payload.type === "cancelled" || payload.type === "error") {
      entry.replayEvents = entry.replayEvents.filter((event) => event.revision > previousRevision)
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
    listener: (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void,
    options: JingleAgentRuntimeReplayOptions = {}
  ): void {
    const fromRevision = options.fromRevision ?? 0
    const replayEvents = entry.replayEvents.filter((event) => event.revision > fromRevision)
    if (replayEvents.length === 0) {
      return
    }

    listener({
      events: structuredClone(replayEvents),
      latestRevision: entry.projector.readState().revision,
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
      const batch: JingleRuntimeEventBatch<AgentThreadEvent> = {
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
