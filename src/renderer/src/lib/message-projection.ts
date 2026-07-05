import { extractMessageText, resolveImageBlockUrl } from "@shared/message-content"
import { isTodoListToolName } from "@shared/todo-tools"
import { isExtensionToolCallPresentation } from "@shared/tool-presentation"
import { parseCompleteToolCallArgsObject } from "@shared/tool-call-args"
import {
  readFileMutationResultMetadata,
  type FileMutationResultMetadata
} from "@shared/file-mutation-result"
import {
  getJingleTurnPendingApproval,
  projectJingleActiveTurnStatus,
  projectJingleRunCoachTip,
  shouldProjectJingleToolActivity,
  projectJingleTurnPendingApproval,
  projectJingleTurnElapsedDivider,
  projectJingleTurnToolExecutionsView,
  type JingleActiveRunCoachStatusKind,
  type JingleActiveTurnStatusEntrySource,
  type JingleActiveTurnStatusProjection,
  type JingleAgentToolExecutionView,
  type JingleAgentToolExecutionViewStatus,
  type JingleAgentToolExecutionsView,
  type JinglePendingApprovalSource,
  type JingleRunCoachTipProjection,
  type JingleTurnElapsedProjection,
  type JingleTurnToolExecutionsSource
} from "@jingle/agent-react"
import { stabilizeJingleReferences } from "@jingle/agent-react"
import {
  readJingleToolExecutionTiming,
  type JingleActiveAgentToolCall,
  type JingleAgentRunPhase,
  type JingleToolExecutionTiming
} from "@jingle/agent-client"
import type { ContentBlock, HITLRequest, Message as ThreadMessage, ToolCall } from "@/types"
import { readJingleSteeringAppliedMarker, readJingleSteeringStatus } from "@shared/message-steering"

export interface ToolResultInfo {
  content: ThreadMessage["content"]
  execution: JingleToolExecutionTiming | null
  fileMutation: FileMutationResultMetadata | null
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
      coachTip: JingleRunCoachTipProjection | null
      isActive: boolean
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

export type AgentToolExecutionViewStatus = JingleAgentToolExecutionViewStatus

export type AgentToolExecutionView = JingleAgentToolExecutionView<
  JingleToolExecutionTiming,
  JingleActiveAgentToolCall
>

export type AgentToolExecutionsView = JingleAgentToolExecutionsView<
  JingleToolExecutionTiming,
  JingleActiveAgentToolCall
>

export type ActiveTurnStatusProjectionKind = JingleActiveRunCoachStatusKind

export type ActiveTurnStatusProjection = JingleActiveTurnStatusProjection

export type TurnElapsedProjection = JingleTurnElapsedProjection

export type MessageDisplayRow =
  | {
      kind: "turn"
      key: string
      turnKey: string
    }
  | {
      kind: "context-compaction"
      key: string
      messageId: string
    }
  | {
      kind: "footer"
      key: "__chat_footer__"
    }

const FOOTER_DISPLAY_ROW: MessageDisplayRow = {
  kind: "footer",
  key: "__chat_footer__"
}

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
    if (!isToolResultMessage(message)) {
      continue
    }

    results.set(message.tool_call_id, {
      content: message.content,
      execution: readJingleToolExecutionTiming(message),
      fileMutation: readFileMutationResultMetadata(message)
    })
  }

  return results
}

function isToolResultMessage(
  message: ThreadMessage
): message is ThreadMessage & { tool_call_id: string } {
  return message.role === "tool" && Boolean(message.tool_call_id)
}

export function projectTurnElapsedDivider(input: {
  activeRunStartedAt?: Date | null
  isStreaming: boolean
  turn: MessageTurn
}): TurnElapsedProjection | null {
  return projectJingleTurnElapsedDivider({
    activeRunStartedAt: input.activeRunStartedAt,
    isStreaming: input.isStreaming,
    toolResults: input.turn.toolResults
  })
}

function shouldProjectToolActivity(toolCall: Pick<ToolCall, "name" | "presentation">): boolean {
  return shouldProjectJingleToolActivity({
    hasExtensionPresentation: isExtensionToolCallPresentation(toolCall.presentation),
    isTodoListTool: isTodoListToolName(toolCall.name),
    name: toolCall.name
  })
}

function stabilizeToolResultInfo(
  previous: ToolResultInfo | undefined,
  next: ToolResultInfo
): ToolResultInfo {
  if (!previous) {
    return next
  }

  const content = stabilizeJingleReferences(previous.content, next.content)
  const execution = isSameToolExecutionTiming(previous.execution, next.execution)
    ? previous.execution
    : next.execution
  const fileMutation = isSameFileMutationResultMetadata(previous.fileMutation, next.fileMutation)
    ? previous.fileMutation
    : next.fileMutation

  return Object.is(content, previous.content) &&
    Object.is(execution, previous.execution) &&
    Object.is(fileMutation, previous.fileMutation)
    ? previous
    : { content, execution, fileMutation }
}

function isSameFileMutationResultMetadata(
  previous: FileMutationResultMetadata | null,
  next: FileMutationResultMetadata | null
): boolean {
  if (previous === next) {
    return true
  }

  if (!previous || !next) {
    return false
  }

  return (
    previous.status === next.status &&
    previous.toolCallId === next.toolCallId &&
    previous.toolName === next.toolName &&
    previous.files.length === next.files.length &&
    previous.files.every((file, index) => {
      const nextFile = next.files[index]
      return (
        nextFile !== undefined &&
        file.after === nextFile.after &&
        file.before === nextFile.before &&
        file.changeType === nextFile.changeType &&
        file.path === nextFile.path
      )
    })
  )
}

function isSameToolExecutionTiming(
  previous: JingleToolExecutionTiming | null,
  next: JingleToolExecutionTiming | null
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

  return previous.length === next.length &&
    next.every((message, index) => Object.is(message, previous[index]))
    ? previous
    : next
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

function isContextCompactionMessage(message: ThreadMessage): boolean {
  return message.role === "user" && message.metadata?.lc_source === "summarization"
}

function readSteeringAppliedMarkerMessage(message: ThreadMessage) {
  if (message.role !== "system") {
    return null
  }

  return readJingleSteeringAppliedMarker(message.metadata)
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

function buildDisplayRows(messages: ThreadMessage[], turns: MessageTurn[]): MessageDisplayRow[] {
  const rows: MessageDisplayRow[] = []
  const turnKeyByMessageId = new Map<string, string>()

  for (const turn of turns) {
    if (turn.user) {
      turnKeyByMessageId.set(turn.user.id, turn.key)
    }

    for (const assistant of turn.assistants) {
      turnKeyByMessageId.set(assistant.id, turn.key)
    }
  }

  const projectedTurnKeys = new Set<string>()

  for (const message of messages) {
    if (isContextCompactionMessage(message)) {
      rows.push({
        kind: "context-compaction",
        key: `context-compaction:${message.id}`,
        messageId: message.id
      })
      continue
    }

    const steeringAppliedMarker = readSteeringAppliedMarkerMessage(message)
    if (steeringAppliedMarker) {
      continue
    }

    const turnKey = turnKeyByMessageId.get(message.id)
    if (!turnKey || projectedTurnKeys.has(turnKey)) {
      continue
    }

    projectedTurnKeys.add(turnKey)
    rows.push({
      kind: "turn",
      key: turnKey,
      turnKey
    })
  }

  for (const turn of turns) {
    if (projectedTurnKeys.has(turn.key)) {
      continue
    }

    rows.push({
      kind: "turn",
      key: turn.key,
      turnKey: turn.key
    })
  }

  rows.push(FOOTER_DISPLAY_ROW)
  return rows
}

function stabilizeDisplayRows(
  previous: MessageDisplayRow[] | undefined,
  messages: ThreadMessage[],
  turns: MessageTurn[]
): MessageDisplayRow[] {
  const next = buildDisplayRows(messages, turns)
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

  return content.reduce((text, block) => {
    return block.type === "reasoning" ? text + getReasoningBlockText(block) : text
  }, "")
}

function getDisplayBlockText(block: ContentBlock): string {
  return block.text ?? block.content ?? ""
}

function getReasoningBlockText(block: ContentBlock): string {
  return block.reasoning ?? getDisplayBlockText(block)
}

function getFileBlockDisplayText(block: ContentBlock): string {
  return block.name ?? block.content ?? ""
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
      return getFileBlockDisplayText(block).trim().length > 0
    }

    return getDisplayBlockText(block).trim().length > 0
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

function createActiveToolActivityItem(
  activeToolCall: JingleActiveAgentToolCall
): AgentActivityItem | null {
  if (!activeToolCall.name) {
    return null
  }

  if (
    !shouldProjectToolActivity({
      name: activeToolCall.name,
      presentation: undefined
    })
  ) {
    return null
  }

  const args = parseCompleteToolCallArgsObject(activeToolCall.argsText)

  return {
    key: `tool:${activeToolCall.id}`,
    kind: "tool",
    messageId: activeToolCall.messageId ?? `active:${activeToolCall.id}`,
    toolCall: {
      args: args ?? {},
      id: activeToolCall.id,
      name: activeToolCall.name,
      type: "tool_call"
    }
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
      const previousTurn = currentTurn
      currentTurn = {
        assistants: [],
        branchMessageId: message.id,
        key: message.id,
        toolResults: new Map(),
        user: message
      }
      turns.push(currentTurn)
      if (readJingleSteeringStatus(message.metadata) === "pending" && previousTurn) {
        currentTurn = previousTurn
      }
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

export function buildTurnAssistantEntries(
  turn: MessageTurn,
  options: {
    activeToolCalls?: readonly JingleActiveAgentToolCall[]
    streamingAssistantId?: string | null
  } = {}
): TurnAssistantEntry[] {
  const entries: TurnAssistantEntry[] = []
  let pendingActivities: AgentActivityItem[] = []
  const projectedToolCallIds = new Set<string>()

  for (const message of turn.assistants) {
    const reasoningText = getReasoningText(message.content)

    if (reasoningText.trim()) {
      pendingActivities = flushAgentActivities(entries, pendingActivities)
      entries.push({
        coachTip: null,
        isActive: false,
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
      projectedToolCallIds.add(toolCall.id)
    }
  }

  for (const activeToolCall of options.activeToolCalls ?? []) {
    if (projectedToolCallIds.has(activeToolCall.id)) {
      continue
    }

    const item = createActiveToolActivityItem(activeToolCall)
    if (!item) {
      continue
    }

    pendingActivities.push(item)
    projectedToolCallIds.add(activeToolCall.id)
  }

  flushAgentActivities(entries, pendingActivities)

  const latestEntry = entries.at(-1)
  if (
    latestEntry?.kind === "thinking" &&
    options.streamingAssistantId &&
    latestEntry.messageId === options.streamingAssistantId
  ) {
    latestEntry.isActive = true
    latestEntry.coachTip = projectJingleRunCoachTip({
      kind: "thinking",
      placement: entries.length === 1 ? "before_entries" : "after_entries"
    })
  }

  return entries
}

function toJingleActiveTurnStatusEntries(
  assistantEntries: readonly TurnAssistantEntry[]
): JingleActiveTurnStatusEntrySource[] {
  return assistantEntries.map((entry) =>
    entry.kind === "agent-activity"
      ? {
          kind: entry.kind,
          toolCallIds: entry.items.map((item) => item.toolCall.id)
        }
      : { kind: entry.kind }
  )
}

export function projectActiveTurnStatus(input: {
  activeRunPhase?: JingleAgentRunPhase | null
  assistantEntries: readonly TurnAssistantEntry[]
  isStreaming: boolean
  pendingApproval?: HITLRequest | null
}): ActiveTurnStatusProjection | null {
  return projectJingleActiveTurnStatus({
    activeRunPhase: input.activeRunPhase,
    entries: toJingleActiveTurnStatusEntries(input.assistantEntries),
    isStreaming: input.isStreaming,
    pendingApprovalToolCallId: input.pendingApproval?.tool_call.id ?? null
  })
}

export function getTurnCopyText(turn: MessageTurn): string {
  return turn.assistants
    .flatMap((message) => {
      const text = extractMessageText(message.content).trim()
      return text ? [text] : []
    })
    .join("\n\n")
}

function toJingleToolExecutionsTurn(
  turn: MessageTurn
): JingleTurnToolExecutionsSource<JingleToolExecutionTiming> {
  return {
    assistants: turn.assistants.map((assistant) => ({
      toolCalls: assistant.tool_calls ?? []
    })),
    toolResults: turn.toolResults
  }
}

function toJinglePendingApproval(
  pendingApproval: HITLRequest | null | undefined
): JinglePendingApprovalSource | null {
  return pendingApproval ? { toolCall: pendingApproval.tool_call } : null
}

export function getTurnPendingApproval(
  turn: MessageTurn,
  pendingApproval: HITLRequest | null | undefined
): HITLRequest | null {
  const jinglePendingApproval = toJinglePendingApproval(pendingApproval)
  if (!jinglePendingApproval) {
    return null
  }

  return getJingleTurnPendingApproval(toJingleToolExecutionsTurn(turn), jinglePendingApproval)
    ? (pendingApproval ?? null)
    : null
}

export function projectTurnPendingApproval(input: {
  activeToolCalls?: readonly JingleActiveAgentToolCall[]
  isActiveTurn: boolean
  pendingApproval: HITLRequest | null | undefined
  turn: MessageTurn | null
}): HITLRequest | null {
  const jinglePendingApproval = toJinglePendingApproval(input.pendingApproval)
  if (!input.turn || !jinglePendingApproval) {
    return null
  }

  return projectJingleTurnPendingApproval({
    activeToolCalls: input.activeToolCalls,
    isActiveTurn: input.isActiveTurn,
    pendingApproval: jinglePendingApproval,
    turn: toJingleToolExecutionsTurn(input.turn)
  })
    ? (input.pendingApproval ?? null)
    : null
}

export function projectTurnToolExecutionsView(input: {
  activeToolCallId: string | null
  activeToolCalls?: readonly JingleActiveAgentToolCall[]
  pendingApproval: HITLRequest | null
  turn: MessageTurn | null
}): AgentToolExecutionsView {
  return projectJingleTurnToolExecutionsView({
    activeToolCallId: input.activeToolCallId,
    activeToolCalls: input.activeToolCalls,
    pendingApproval: toJinglePendingApproval(input.pendingApproval),
    turn: input.turn ? toJingleToolExecutionsTurn(input.turn) : null
  })
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
  const visibleMessages = messages.filter((message) => !isToolResultMessage(message))
  const turnMessages = visibleMessages.filter(
    (message) =>
      !isContextCompactionMessage(message) && readSteeringAppliedMarkerMessage(message) === null
  )
  const turns = stabilizeTurns(
    previousProjection?.turns,
    attachTurnToolResults(buildMessageTurns(turnMessages), toolResults)
  )
  const displayRows = stabilizeDisplayRows(previousProjection?.displayRows, visibleMessages, turns)
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
