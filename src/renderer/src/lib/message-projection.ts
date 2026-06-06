import { extractMessageText, resolveImageBlockUrl } from "@shared/message-content"
import { stabilizeReferences } from "@/lib/stabilize-references"
import type { HITLRequest, Message as ThreadMessage, ToolCall } from "@/types"

export interface ToolResultInfo {
  content: ThreadMessage["content"]
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
      kind: "agent-activity"
      items: AgentActivityItem[]
      key: string
    }

export type AgentActivityItem =
  | {
      kind: "thinking"
      key: string
      messageId: string
      text: string
    }
  | {
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

export interface TurnToolDisplayPolicy {
  defaultExpanded: boolean
  preferLatestSummary: boolean
}

export function getTurnToolDisplayPolicy(
  turn: MessageTurn,
  options: { isStreaming: boolean }
): TurnToolDisplayPolicy {
  return {
    defaultExpanded: shouldDefaultExpandToolEntries(turn, options),
    preferLatestSummary: options.isStreaming
  }
}

export interface MessagesProjection {
  activeAssistantId: string | null
  activeTurnKey: string | null
  displayRows: MessageDisplayRow[]
  turns: MessageTurn[]
}

export type AgentToolExecutionViewStatus = "approval" | "complete" | "running"

export interface AgentToolExecutionView {
  status: AgentToolExecutionViewStatus
  toolCallId: string
}

export type AgentToolExecutionsView = Record<string, AgentToolExecutionView>

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
const IMPLICIT_DISPLAY_TOOL_RESULT: ToolResultInfo = { content: "" }

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
      content: message.content
    })
  }

  return results
}

function hasImplicitDisplayResult(toolCall: ToolCall): boolean {
  return toolCall.name === "write_todos"
}

function stabilizeToolResultInfo(
  previous: ToolResultInfo | undefined,
  next: ToolResultInfo
): ToolResultInfo {
  if (!previous) {
    return next
  }

  const content = stabilizeReferences(previous.content, next.content)
  return Object.is(content, previous.content) ? previous : { content }
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
      const result = toolResults.get(toolCall.id)

      if (result) {
        turnToolResults.set(toolCall.id, result)
      } else if (hasImplicitDisplayResult(toolCall)) {
        turnToolResults.set(toolCall.id, IMPLICIT_DISPLAY_TOOL_RESULT)
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
      pendingActivities.push({
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
      pendingActivities.push(createToolActivityItem(message, toolCall, index))
    }
  }

  flushAgentActivities(entries, pendingActivities)

  return entries
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

export function projectToolExecutionsView(input: {
  activeRun: { status: string; turnId: string } | null
  messageProjection: MessagesProjection
  pendingApproval: HITLRequest | null
  previous?: AgentToolExecutionsView
}): AgentToolExecutionsView {
  const nextToolExecutions = new Map<string, AgentToolExecutionView>()
  const activeTurnKey = input.activeRun?.status === "running" ? input.activeRun.turnId : null

  for (const turn of input.messageProjection.turns) {
    const isActiveTurn = activeTurnKey === turn.key

    for (const assistant of turn.assistants) {
      for (const toolCall of assistant.tool_calls ?? []) {
        if (turn.toolResults.has(toolCall.id)) {
          nextToolExecutions.set(toolCall.id, {
            status: "complete",
            toolCallId: toolCall.id
          })
          continue
        }

        if (isActiveTurn) {
          nextToolExecutions.set(toolCall.id, {
            status: "running",
            toolCallId: toolCall.id
          })
        }
      }
    }
  }

  const pendingApprovalToolCallId = input.pendingApproval?.tool_call.id ?? null
  if (pendingApprovalToolCallId) {
    nextToolExecutions.set(pendingApprovalToolCallId, {
      status: "approval",
      toolCallId: pendingApprovalToolCallId
    })
  }

  if (!input.previous || nextToolExecutions.size !== Object.keys(input.previous).length) {
    return Object.fromEntries(nextToolExecutions)
  }

  for (const [toolCallId, next] of nextToolExecutions) {
    const previousEntry = input.previous[toolCallId]
    if (!previousEntry || previousEntry.status !== next.status) {
      return Object.fromEntries(nextToolExecutions)
    }
  }

  return input.previous
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
