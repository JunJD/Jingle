import { extractMessageText, resolveImageBlockUrl } from "@shared/message-content"
import { stabilizeReferences } from "@/lib/stabilize-references"
import type { HITLRequest, Message as ThreadMessage } from "@/types"

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
      kind: "tool-cluster"
      key: string
      messages: ThreadMessage[]
    }

export function countToolCalls(messages: ThreadMessage[]): number {
  return messages.reduce((count, message) => count + (message.tool_calls?.length ?? 0), 0)
}

export function shouldDefaultExpandToolEntries(
  turn: MessageTurn,
  options: { isStreaming: boolean }
): boolean {
  if (options.isStreaming) {
    return true
  }

  const lastAssistantMessage = turn.assistants[turn.assistants.length - 1]
  return !lastAssistantMessage || !hasRenderableAssistantContent(lastAssistantMessage.content)
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
  activeTurnKey: string | null
  displayRows: MessageDisplayRow[]
  lastAssistantId: string | null
  turns: MessageTurn[]
}

export type MessageDisplayRow =
  | {
      kind: "turn"
      key: string
      turn: MessageTurn
    }
  | {
      kind: "footer"
      key: "__chat_footer__"
    }

const FOOTER_DISPLAY_ROW: MessageDisplayRow = {
  kind: "footer",
  key: "__chat_footer__"
}

export function createDefaultMessagesProjection(): MessagesProjection {
  return {
    activeTurnKey: null,
    displayRows: [FOOTER_DISPLAY_ROW],
    lastAssistantId: null,
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
        turn
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
  const stableRows = next.map((nextRow, index) => {
    const previousRow = previousByKey.get(nextRow.key)
    if (!previousRow || previousRow.kind !== nextRow.kind || previousRow.key !== nextRow.key) {
      isEqual = false
      return nextRow
    }

    if (nextRow.kind === "footer") {
      return previousRow
    }

    if (previousRow.kind === "turn" && previousRow.turn === nextRow.turn) {
      if (!Object.is(previousRow, previous[index])) {
        isEqual = false
      }

      return previousRow
    }

    isEqual = false
    return nextRow
  })

  return isEqual ? previous : stableRows
}

function hasRenderableAssistantContent(content: ThreadMessage["content"]): boolean {
  if (typeof content === "string") {
    return content.trim().length > 0
  }

  if (!Array.isArray(content) || content.length === 0) {
    return false
  }

  return content.some((block) => {
    if (block.type === "reasoning") {
      return Boolean((block.reasoning ?? block.text ?? block.content ?? "").trim())
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

  for (const message of turn.assistants) {
    const hasContent = hasRenderableAssistantContent(message.content)
    const hasTools = (message.tool_calls?.length ?? 0) > 0

    if (hasContent) {
      entries.push({
        key: `assistant:${message.id}`,
        kind: "assistant-content",
        message
      })
    }

    if (hasTools) {
      entries.push({
        key: `tools:${message.id}`,
        kind: "tool-cluster",
        messages: [message]
      })
    }
  }

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

export function projectMessages(
  messages: ThreadMessage[],
  previousProjection?: MessagesProjection | null
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
  let lastAssistantId: string | null = null
  for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
    const message = visibleMessages[index]
    if (message?.role === "assistant") {
      lastAssistantId = message.id
      break
    }
  }
  const activeTurnKey =
    turns.find((turn) => turn.assistants.some((message) => message.id === lastAssistantId))?.key ??
    null

  if (
    previousProjection &&
    previousProjection.activeTurnKey === activeTurnKey &&
    previousProjection.displayRows === displayRows &&
    previousProjection.lastAssistantId === lastAssistantId &&
    previousProjection.turns === turns
  ) {
    return previousProjection
  }

  return {
    activeTurnKey,
    displayRows,
    lastAssistantId,
    turns
  }
}
