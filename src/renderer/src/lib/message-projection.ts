import { extractMessageText, resolveImageBlockUrl } from "@shared/message-content"
import { isExtensionToolCallPresentation } from "@shared/tool-presentation"
import { stabilizeReferences } from "@/lib/stabilize-references"
import {
  readAgentToolExecutionTiming,
  type ActiveAgentToolCall,
  type AgentRunPhase,
  type AgentToolExecutionTiming
} from "@shared/agent-thread-runtime"
import type { HITLRequest, Message as ThreadMessage, ToolCall } from "@/types"

export interface ToolResultInfo {
  content: ThreadMessage["content"]
  execution: AgentToolExecutionTiming | null
}

export interface MessageTurn {
  assistants: ThreadMessage[]
  branchMessageId: string | null
  key: string
  toolResults: Map<string, ToolResultInfo>
  user: ThreadMessage | null
}

export type TurnAssistantEntry =
  | {
      kind: "assistant-content"
      key: string
      message: ThreadMessage
    }
  | {
      kind: "thinking"
      key: string
      messageId: string
      text: string
    }
  | {
      kind: "agent-activity"
      items: AgentActivityItem[]
      key: string
    }

export type AgentActivityItem = {
  kind: "tool"
  key: string
  messageId: string
  toolCall: ToolCall
}

export function shouldDefaultExpandToolEntries(
  turn: MessageTurn,
  options: { isStreaming: boolean }
): boolean {
  if (options.isStreaming) {
    return true
  }

  const lastAssistantMessage = turn.assistants[turn.assistants.length - 1]
  return !lastAssistantMessage || !hasNarrativeAssistantContent(lastAssistantMessage.content)
}

export interface MessagesProjection {
  activeAssistantId: string | null
  activeTurnKey: string | null
  displayRows: MessageDisplayRow[]
  turns: MessageTurn[]
}

export type AgentToolExecutionViewStatus =
  | "approval"
  | "arguments_streaming"
  | "complete"
  | "failed"
  | "running"
  | "waiting_result"

export interface AgentToolExecutionView {
  activeToolCall?: ActiveAgentToolCall
  execution?: AgentToolExecutionTiming | null
  status: AgentToolExecutionViewStatus
  toolCallId: string
}

export type AgentToolExecutionsView = Record<string, AgentToolExecutionView>

export type ActiveTurnStatusProjectionKind = "thinking" | "waiting_approval"

export interface ActiveTurnStatusProjection {
  kind: ActiveTurnStatusProjectionKind
  placement: "after_entries" | "before_entries"
  toolCallId: string | null
}

export type TurnElapsedProjection =
  | {
      completedAt: null
      durationMs: null
      startedAt: Date
      status: "working"
    }
  | {
      completedAt: Date
      durationMs: number
      startedAt: Date
      status: "worked"
    }

export type AgentActivitySummaryCategory = "command" | "file" | "list" | "search" | "web_search"

export interface AgentActivitySummaryToolInput {
  status: AgentToolExecutionViewStatus
  toolCall: ToolCall
}

export interface AgentActivitySummaryProjection {
  activeCategory: AgentActivitySummaryCategory | null
  counts: Partial<Record<AgentActivitySummaryCategory, number>>
  status: "complete" | "running"
}

export type MessageDisplayRow =
  | {
      kind: "turn"
      key: string
      turnKey: string
    }
  | {
      kind: "footer"
      key: "__chat_footer__"
    }

const FOOTER_DISPLAY_ROW: MessageDisplayRow = {
  kind: "footer",
  key: "__chat_footer__"
}
const EMPTY_AGENT_TOOL_EXECUTIONS_VIEW: AgentToolExecutionsView = {}
const AGENT_ACTIVITY_SUMMARY_CATEGORIES: readonly AgentActivitySummaryCategory[] = [
  "file",
  "list",
  "search",
  "web_search",
  "command"
]

export interface MessageProjectionOptions {
  activeAssistantId?: string | null
  activeTurnKey?: string | null
}

export type ProjectedMessageFastPathMissReason = "message_role_not_assistant" | "turn_not_found"

export type ProjectedMessageFastPathResult =
  | {
      projection: MessagesProjection
      type: "hit"
    }
  | {
      reason: ProjectedMessageFastPathMissReason
      type: "miss"
    }

export function createDefaultMessagesProjection(): MessagesProjection {
  return {
    activeAssistantId: null,
    activeTurnKey: null,
    displayRows: [FOOTER_DISPLAY_ROW],
    turns: []
  }
}

export function buildToolResults(messages: ThreadMessage[]): Map<string, ToolResultInfo> {
  const results = new Map<string, ToolResultInfo>()

  for (const message of messages) {
    if (message.role !== "tool" || !message.tool_call_id) {
      continue
    }

    results.set(message.tool_call_id, {
      content: message.content,
      execution: readAgentToolExecutionTiming(message)
    })
  }

  return results
}

function toFiniteTimestamp(value: Date | null | undefined): number | null {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function getCompletedExecutionRange(
  execution: AgentToolExecutionTiming | null
): { completedAtMs: number; startedAtMs: number } | null {
  if (!execution || (execution.status !== "completed" && execution.status !== "failed")) {
    return null
  }

  const startedAtMs = toFiniteTimestamp(execution.startedAt)
  if (startedAtMs === null) {
    return null
  }

  const completedAtMs =
    toFiniteTimestamp(execution.completedAt) ??
    (typeof execution.durationMs === "number" && Number.isFinite(execution.durationMs)
      ? startedAtMs + execution.durationMs
      : null)

  if (completedAtMs === null) {
    return null
  }

  return {
    completedAtMs,
    startedAtMs
  }
}

export function projectTurnElapsedDivider(input: {
  activeRunStartedAt?: Date | null
  isStreaming: boolean
  turn: MessageTurn
}): TurnElapsedProjection | null {
  if (input.isStreaming) {
    return input.activeRunStartedAt
      ? {
          completedAt: null,
          durationMs: null,
          startedAt: input.activeRunStartedAt,
          status: "working"
        }
      : null
  }

  let startedAtMs: number | null = null
  let completedAtMs: number | null = null

  for (const result of input.turn.toolResults.values()) {
    const range = getCompletedExecutionRange(result.execution)
    if (!range) {
      continue
    }

    startedAtMs =
      startedAtMs === null ? range.startedAtMs : Math.min(startedAtMs, range.startedAtMs)
    completedAtMs =
      completedAtMs === null ? range.completedAtMs : Math.max(completedAtMs, range.completedAtMs)
  }

  if (startedAtMs === null || completedAtMs === null) {
    return null
  }

  return {
    completedAt: new Date(completedAtMs),
    durationMs: Math.max(0, completedAtMs - startedAtMs),
    startedAt: new Date(startedAtMs),
    status: "worked"
  }
}

function getStringArg(args: Record<string, unknown>, names: readonly string[]): string | null {
  for (const name of names) {
    const value = args[name]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }

  return null
}

function getToolCallSummaryCategory(toolCall: ToolCall): AgentActivitySummaryCategory | null {
  switch (toolCall.name) {
    case "execute":
      return "command"
    case "read_file":
      return "file"
    case "ls":
      return "list"
    case "glob":
    case "grep":
      return "search"
    case "web_search":
      return "web_search"
    default:
      return null
  }
}

function getToolCallSummaryFactKey(
  category: AgentActivitySummaryCategory,
  toolCall: ToolCall
): string | null {
  const args = toolCall.args ?? {}

  switch (category) {
    case "command":
      return getStringArg(args, ["command"])
    case "file":
      return getStringArg(args, ["path", "file_path"])
    case "list":
      return getStringArg(args, ["path"])
    case "search":
      return getStringArg(args, ["pattern", "query", "glob"])
    case "web_search":
      return getStringArg(args, ["query", "pattern"])
  }
}

function isPendingToolExecutionStatus(status: AgentToolExecutionViewStatus): boolean {
  return status !== "complete" && status !== "failed"
}

export function projectAgentActivitySummary(
  tools: readonly AgentActivitySummaryToolInput[]
): AgentActivitySummaryProjection | null {
  if (
    tools.length === 0 ||
    tools.some((tool) => tool.status === "approval" || tool.status === "failed")
  ) {
    return null
  }

  const categorizedTools = tools.map((tool) => ({
    ...tool,
    category: getToolCallSummaryCategory(tool.toolCall)
  }))
  if (categorizedTools.some((tool) => tool.category === null)) {
    return null
  }

  const factKeysByCategory = new Map<AgentActivitySummaryCategory, Set<string>>()
  for (const category of AGENT_ACTIVITY_SUMMARY_CATEGORIES) {
    factKeysByCategory.set(category, new Set())
  }

  for (const tool of categorizedTools) {
    const category = tool.category!
    const factKey = getToolCallSummaryFactKey(category, tool.toolCall)
    if (!factKey) {
      return null
    }

    factKeysByCategory.get(category)!.add(factKey)
  }

  const counts: Partial<Record<AgentActivitySummaryCategory, number>> = {}
  for (const category of AGENT_ACTIVITY_SUMMARY_CATEGORIES) {
    const count = factKeysByCategory.get(category)?.size ?? 0
    if (count > 0) {
      counts[category] = count
    }
  }

  const latestPendingTool = [...categorizedTools]
    .reverse()
    .find((tool) => isPendingToolExecutionStatus(tool.status))

  return {
    activeCategory: latestPendingTool?.category ?? null,
    counts,
    status: latestPendingTool ? "running" : "complete"
  }
}

function shouldProjectToolActivity(toolCall: Pick<ToolCall, "name" | "presentation">): boolean {
  if (
    toolCall.name === "loadExtension" ||
    toolCall.name === "write_todos"
  ) {
    return false
  }

  if (toolCall.name === "callExtension") {
    // callExtension is the execution wrapper; renderer activity starts after projection adds extension UI facts.
    return isExtensionToolCallPresentation(toolCall.presentation)
  }

  return true
}

function stabilizeToolResultInfo(
  previous: ToolResultInfo | undefined,
  next: ToolResultInfo
): ToolResultInfo {
  if (!previous) {
    return next
  }

  const content = stabilizeReferences(previous.content, next.content)
  const execution = isSameToolExecutionTiming(previous.execution, next.execution)
    ? previous.execution
    : next.execution

  return Object.is(content, previous.content) && Object.is(execution, previous.execution)
    ? previous
    : { content, execution }
}

function isSameToolExecutionTiming(
  previous: AgentToolExecutionTiming | null,
  next: AgentToolExecutionTiming | null
): boolean {
  if (previous === next) {
    return true
  }

  if (!previous || !next) {
    return false
  }

  return (
    previous.completedAt?.getTime() === next.completedAt?.getTime() &&
    previous.durationMs === next.durationMs &&
    previous.error?.message === next.error?.message &&
    previous.error?.type === next.error?.type &&
    previous.messageId === next.messageId &&
    previous.runId === next.runId &&
    previous.startedAt?.getTime() === next.startedAt?.getTime() &&
    previous.status === next.status &&
    previous.toolCallId === next.toolCallId &&
    previous.toolName === next.toolName
  )
}

function stabilizeToolResults(
  previous: Map<string, ToolResultInfo> | undefined,
  next: Map<string, ToolResultInfo>
): Map<string, ToolResultInfo> {
  if (!previous) {
    return next
  }

  let isEqual = previous.size === next.size
  const stableResults = new Map<string, ToolResultInfo>()

  for (const [toolCallId, nextInfo] of next) {
    const previousInfo = previous.get(toolCallId)
    const stableInfo = stabilizeToolResultInfo(previousInfo, nextInfo)

    if (!Object.is(stableInfo, previousInfo)) {
      isEqual = false
    }

    stableResults.set(toolCallId, stableInfo)
  }

  return isEqual ? previous : stableResults
}

function getPreviousToolResults(
  previousProjection: MessagesProjection | null | undefined
): Map<string, ToolResultInfo> | undefined {
  if (!previousProjection) {
    return undefined
  }

  const previousToolResults = new Map<string, ToolResultInfo>()

  for (const turn of previousProjection.turns) {
    for (const [toolCallId, info] of turn.toolResults) {
      previousToolResults.set(toolCallId, info)
    }
  }

  return previousToolResults
}

function buildTurnToolResults(
  turn: MessageTurn,
  toolResults: Map<string, ToolResultInfo>
): Map<string, ToolResultInfo> {
  const turnToolResults = new Map<string, ToolResultInfo>()

  for (const message of turn.assistants) {
    for (const toolCall of message.tool_calls ?? []) {
      if (!shouldProjectToolActivity(toolCall)) {
        continue
      }

      const result = toolResults.get(toolCall.id)

      if (result) {
        turnToolResults.set(toolCall.id, result)
      }
    }
  }

  return turnToolResults
}

function stabilizeTurnToolResults(
  previous: Map<string, ToolResultInfo> | undefined,
  next: Map<string, ToolResultInfo>
): Map<string, ToolResultInfo> {
  if (!previous) {
    return next
  }

  let isEqual = previous.size === next.size

  for (const [toolCallId, nextInfo] of next) {
    if (!Object.is(previous.get(toolCallId), nextInfo)) {
      isEqual = false
      break
    }
  }

  return isEqual ? previous : next
}

function reuseMessageList(
  previous: ThreadMessage[] | undefined,
  next: ThreadMessage[]
): ThreadMessage[] {
  if (!previous || previous.length !== next.length) {
    return next
  }

  return next.every((message, index) => Object.is(message, previous[index])) ? previous : next
}

function attachTurnToolResults(
  turns: MessageTurn[],
  toolResults: Map<string, ToolResultInfo>
): MessageTurn[] {
  return turns.map((turn) => ({
    ...turn,
    toolResults: buildTurnToolResults(turn, toolResults)
  }))
}

function stabilizeTurns(previous: MessageTurn[] | undefined, next: MessageTurn[]): MessageTurn[] {
  if (!previous) {
    return next
  }

  const previousByKey = new Map(previous.map((turn) => [turn.key, turn]))
  let isEqual = previous.length === next.length

  const stableTurns = next.map((nextTurn, index) => {
    const previousTurn = previousByKey.get(nextTurn.key)

    if (!previousTurn) {
      isEqual = false
      return nextTurn
    }

    const assistants = reuseMessageList(previousTurn.assistants, nextTurn.assistants)
    const toolResults = stabilizeTurnToolResults(previousTurn.toolResults, nextTurn.toolResults)
    const stableTurn =
      previousTurn.user === nextTurn.user &&
      previousTurn.branchMessageId === nextTurn.branchMessageId &&
      previousTurn.assistants === assistants &&
      previousTurn.toolResults === toolResults
        ? previousTurn
        : {
            ...nextTurn,
            assistants,
            toolResults
          }

    if (!Object.is(stableTurn, previous[index])) {
      isEqual = false
    }

    return stableTurn
  })

  return isEqual ? previous : stableTurns
}

function buildDisplayRows(turns: MessageTurn[]): MessageDisplayRow[] {
  return [
    ...turns.map(
      (turn): MessageDisplayRow => ({
        kind: "turn",
        key: turn.key,
        turnKey: turn.key
      })
    ),
    FOOTER_DISPLAY_ROW
  ]
}

function stabilizeDisplayRows(
  previous: MessageDisplayRow[] | undefined,
  turns: MessageTurn[]
): MessageDisplayRow[] {
  const next = buildDisplayRows(turns)
  if (!previous) {
    return next
  }

  const previousByKey = new Map(previous.map((row) => [row.key, row]))
  let isEqual = previous.length === next.length
  const stableRows = next.map((nextRow) => {
    const previousRow = previousByKey.get(nextRow.key)
    if (!previousRow || previousRow.kind !== nextRow.kind || previousRow.key !== nextRow.key) {
      isEqual = false
      return nextRow
    }

    if (nextRow.kind === "footer") {
      return previousRow
    }

    return previousRow
  })

  return isEqual ? previous : stableRows
}

function getReasoningText(content: ThreadMessage["content"]): string {
  if (typeof content === "string" || !Array.isArray(content)) {
    return ""
  }

  return content
    .filter((block) => block.type === "reasoning")
    .map((block) => block.reasoning ?? block.text ?? block.content ?? "")
    .join("")
}

function hasNarrativeAssistantContent(content: ThreadMessage["content"]): boolean {
  if (typeof content === "string") {
    return content.trim().length > 0
  }

  if (!Array.isArray(content) || content.length === 0) {
    return false
  }

  return content.some((block) => {
    if (block.type === "reasoning") {
      return false
    }

    if (block.type === "image" || block.type === "image_url") {
      return Boolean(resolveImageBlockUrl(block))
    }

    if (block.type === "file") {
      return Boolean((block.name ?? block.content ?? "").trim())
    }

    return Boolean((block.text ?? block.content ?? "").trim())
  })
}

function createToolActivityItem(
  message: ThreadMessage,
  toolCall: ToolCall,
  index: number
): AgentActivityItem {
  return {
    key: `tool:${toolCall.id || `${message.id}:${index}`}`,
    kind: "tool",
    messageId: message.id,
    toolCall
  }
}

function flushAgentActivities(
  entries: TurnAssistantEntry[],
  pendingActivities: AgentActivityItem[]
): AgentActivityItem[] {
  if (pendingActivities.length === 0) {
    return pendingActivities
  }

  entries.push({
    items: pendingActivities,
    key: `activity:${pendingActivities[0].key}`,
    kind: "agent-activity"
  })

  return []
}

export function buildMessageTurns(messages: ThreadMessage[]): MessageTurn[] {
  const turns: MessageTurn[] = []
  let currentTurn: MessageTurn | null = null

  for (const message of messages) {
    if (message.role === "user") {
      currentTurn = {
        assistants: [],
        branchMessageId: message.id,
        key: message.id,
        toolResults: new Map(),
        user: message
      }
      turns.push(currentTurn)
      continue
    }

    if (!currentTurn) {
      currentTurn = {
        assistants: [],
        branchMessageId: null,
        key: message.id,
        toolResults: new Map(),
        user: null
      }
      turns.push(currentTurn)
    }

    currentTurn.assistants.push(message)
    currentTurn.branchMessageId = message.id
  }

  return turns
}

export function buildTurnAssistantEntries(turn: MessageTurn): TurnAssistantEntry[] {
  const entries: TurnAssistantEntry[] = []
  let pendingActivities: AgentActivityItem[] = []

  for (const message of turn.assistants) {
    const reasoningText = getReasoningText(message.content)

    if (reasoningText.trim()) {
      pendingActivities = flushAgentActivities(entries, pendingActivities)
      entries.push({
        key: `thinking:${message.id}`,
        kind: "thinking",
        messageId: message.id,
        text: reasoningText
      })
    }

    if (hasNarrativeAssistantContent(message.content)) {
      pendingActivities = flushAgentActivities(entries, pendingActivities)
      entries.push({
        key: `assistant:${message.id}`,
        kind: "assistant-content",
        message
      })
    }

    for (const [index, toolCall] of (message.tool_calls ?? []).entries()) {
      if (!shouldProjectToolActivity(toolCall)) {
        continue
      }

      pendingActivities.push(createToolActivityItem(message, toolCall, index))
    }
  }

  flushAgentActivities(entries, pendingActivities)

  return entries
}

function assistantEntriesContainToolCall(
  assistantEntries: readonly TurnAssistantEntry[],
  toolCallId: string
): boolean {
  return assistantEntries.some((entry) =>
    entry.kind === "agent-activity"
      ? entry.items.some((item) => item.kind === "tool" && item.toolCall.id === toolCallId)
      : false
  )
}

export function projectActiveTurnStatus(input: {
  activeRunPhase?: AgentRunPhase | null
  assistantEntries: readonly TurnAssistantEntry[]
  isStreaming: boolean
  pendingApproval?: HITLRequest | null
  streamingAssistantId?: string | null
}): ActiveTurnStatusProjection | null {
  if (!input.isStreaming) {
    return null
  }

  const activeRunPhase = input.activeRunPhase ?? null
  const placement = input.assistantEntries.length > 0 ? "after_entries" : "before_entries"
  const latestEntry = input.assistantEntries.at(-1)

  if (
    latestEntry?.kind === "thinking" &&
    latestEntry.messageId === input.streamingAssistantId
  ) {
    return null
  }

  const pendingApprovalToolCallId = input.pendingApproval?.tool_call.id ?? null
  if (activeRunPhase === "waiting_tool_result" && pendingApprovalToolCallId) {
    if (assistantEntriesContainToolCall(input.assistantEntries, pendingApprovalToolCallId)) {
      return null
    }

    return {
      kind: "waiting_approval",
      placement,
      toolCallId: pendingApprovalToolCallId
    }
  }

  if (activeRunPhase !== "thinking" || latestEntry?.kind === "agent-activity") {
    return null
  }

  return {
    kind: "thinking",
    placement,
    toolCallId: null
  }
}

export function getTurnCopyText(turn: MessageTurn): string {
  return turn.assistants
    .map((message) => extractMessageText(message.content).trim())
    .filter(Boolean)
    .join("\n\n")
}

export function getTurnPendingApproval(
  turn: MessageTurn,
  pendingApproval: HITLRequest | null | undefined
): HITLRequest | null {
  if (!pendingApproval) {
    return null
  }

  const pendingToolCallId = pendingApproval.tool_call.id
  const belongsToTurn = turn.assistants.some((message) =>
    message.tool_calls?.some((toolCall) => toolCall.id === pendingToolCallId)
  )

  return belongsToTurn ? pendingApproval : null
}

export function projectTurnToolExecutionsView(input: {
  activeToolCallId: string | null
  activeToolCalls?: readonly ActiveAgentToolCall[]
  isActiveTurnRunning: boolean
  pendingApproval: HITLRequest | null
  turn: MessageTurn | null
}): AgentToolExecutionsView {
  if (!input.turn) {
    return EMPTY_AGENT_TOOL_EXECUTIONS_VIEW
  }

  const nextToolExecutions = new Map<string, AgentToolExecutionView>()

  for (const activeToolCall of input.activeToolCalls ?? []) {
    nextToolExecutions.set(activeToolCall.id, {
      activeToolCall,
      status: activeToolCall.status,
      toolCallId: activeToolCall.id
    })
  }

  for (const assistant of input.turn.assistants) {
    for (const toolCall of assistant.tool_calls ?? []) {
      if (input.turn.toolResults.has(toolCall.id)) {
        const result = input.turn.toolResults.get(toolCall.id)!
        nextToolExecutions.set(toolCall.id, {
          ...(result.execution ? { execution: result.execution } : {}),
          status: result.execution?.status === "failed" ? "failed" : "complete",
          toolCallId: toolCall.id
        })
        continue
      }

      const activeExecution = nextToolExecutions.get(toolCall.id)
      if (activeExecution) {
        nextToolExecutions.set(toolCall.id, activeExecution)
        continue
      }

      if (
        input.activeToolCallId ? toolCall.id === input.activeToolCallId : input.isActiveTurnRunning
      ) {
        nextToolExecutions.set(toolCall.id, {
          status: "running",
          toolCallId: toolCall.id
        })
      }
    }
  }

  const pendingApprovalToolCallId = getTurnPendingApproval(input.turn, input.pendingApproval)
    ?.tool_call.id
  if (pendingApprovalToolCallId) {
    nextToolExecutions.set(pendingApprovalToolCallId, {
      status: "approval",
      toolCallId: pendingApprovalToolCallId
    })
  }

  return nextToolExecutions.size === 0
    ? EMPTY_AGENT_TOOL_EXECUTIONS_VIEW
    : Object.fromEntries(nextToolExecutions)
}

export function updateProjectedMessage(
  previousProjection: MessagesProjection,
  message: ThreadMessage,
  options: MessageProjectionOptions = {}
): ProjectedMessageFastPathResult {
  if (message.role !== "assistant") {
    return {
      reason: "message_role_not_assistant",
      type: "miss"
    }
  }

  const turnIndex = previousProjection.turns.findIndex((turn) =>
    turn.assistants.some((assistant) => assistant.id === message.id)
  )
  if (turnIndex < 0) {
    return {
      reason: "turn_not_found",
      type: "miss"
    }
  }

  const previousTurn = previousProjection.turns[turnIndex]
  if (!previousTurn) {
    return {
      reason: "turn_not_found",
      type: "miss"
    }
  }

  const assistantIndex = previousTurn.assistants.findIndex(
    (assistant) => assistant.id === message.id
  )
  if (assistantIndex < 0) {
    return {
      reason: "turn_not_found",
      type: "miss"
    }
  }

  const nextAssistants = [...previousTurn.assistants]
  nextAssistants[assistantIndex] = message
  const nextTurn: MessageTurn = {
    ...previousTurn,
    assistants: nextAssistants,
    branchMessageId:
      previousTurn.branchMessageId === previousTurn.assistants[assistantIndex]?.id
        ? message.id
        : previousTurn.branchMessageId
  }
  const turns = [...previousProjection.turns]
  turns[turnIndex] = nextTurn

  const displayRows = previousProjection.displayRows
  const hasRuntimeActiveTurn = options.activeTurnKey !== undefined
  const activeTurnKey = hasRuntimeActiveTurn
    ? (options.activeTurnKey ?? null)
    : previousProjection.activeTurnKey
  const hasRuntimeActiveAssistant = options.activeAssistantId !== undefined
  const activeAssistantId = hasRuntimeActiveAssistant
    ? (options.activeAssistantId ?? null)
    : previousProjection.activeAssistantId

  return {
    projection: {
      activeAssistantId,
      activeTurnKey,
      displayRows,
      turns
    },
    type: "hit"
  }
}

export function projectMessages(
  messages: ThreadMessage[],
  previousProjection?: MessagesProjection | null,
  options: MessageProjectionOptions = {}
): MessagesProjection {
  const toolResults = stabilizeToolResults(
    getPreviousToolResults(previousProjection),
    buildToolResults(messages)
  )
  const visibleMessages = messages.filter((message) => message.role !== "tool")
  const turns = stabilizeTurns(
    previousProjection?.turns,
    attachTurnToolResults(buildMessageTurns(visibleMessages), toolResults)
  )
  const displayRows = stabilizeDisplayRows(previousProjection?.displayRows, turns)
  let latestAssistantId: string | null = null
  for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
    const message = visibleMessages[index]
    if (message?.role === "assistant") {
      latestAssistantId = message.id
      break
    }
  }
  const hasRuntimeActiveTurn = options.activeTurnKey !== undefined
  const runtimeActiveTurnKey =
    hasRuntimeActiveTurn &&
    options.activeTurnKey !== null &&
    turns.some((turn) => turn.key === options.activeTurnKey)
      ? (options.activeTurnKey ?? null)
      : null
  const activeTurnKey = hasRuntimeActiveTurn
    ? runtimeActiveTurnKey
    : (turns.find((turn) => turn.assistants.some((message) => message.id === latestAssistantId))
        ?.key ?? null)
  const hasRuntimeActiveAssistant = options.activeAssistantId !== undefined
  const runtimeActiveAssistantId =
    hasRuntimeActiveAssistant &&
    options.activeAssistantId !== null &&
    turns.some((turn) =>
      turn.assistants.some((message) => message.id === options.activeAssistantId)
    )
      ? (options.activeAssistantId ?? null)
      : null
  const activeAssistantId = hasRuntimeActiveAssistant
    ? runtimeActiveAssistantId
    : activeTurnKey
      ? (turns
          .find((turn) => turn.key === activeTurnKey)
          ?.assistants.findLast((message) => message.id === latestAssistantId)?.id ?? null)
      : null

  if (
    previousProjection &&
    previousProjection.activeAssistantId === activeAssistantId &&
    previousProjection.activeTurnKey === activeTurnKey &&
    previousProjection.displayRows === displayRows &&
    previousProjection.turns === turns
  ) {
    return previousProjection
  }

  return {
    activeAssistantId,
    activeTurnKey,
    displayRows,
    turns
  }
}
