import { extractMessageText, resolveImageBlockUrl } from "@shared/message-content"
import type { Message as ThreadMessage } from "@/types"

export interface ToolResultInfo {
  content: string | unknown
}

export interface MessageTurn {
  assistants: ThreadMessage[]
  key: string
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

export interface MessagesProjection {
  activeTurnKey: string | null
  lastAssistantId: string | null
  toolResults: Map<string, ToolResultInfo>
  turns: MessageTurn[]
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

function hasRenderableAssistantContent(content: ThreadMessage["content"]): boolean {
  if (typeof content === "string") {
    return content.trim().length > 0
  }

  if (!Array.isArray(content) || content.length === 0) {
    return false
  }

  return content.some((block) => {
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
        key: message.id,
        user: message
      }
      turns.push(currentTurn)
      continue
    }

    if (!currentTurn) {
      currentTurn = {
        assistants: [],
        key: message.id,
        user: null
      }
      turns.push(currentTurn)
    }

    currentTurn.assistants.push(message)
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

export function projectMessages(messages: ThreadMessage[]): MessagesProjection {
  const toolResults = buildToolResults(messages)
  const visibleMessages = messages.filter((message) => message.role !== "tool")
  const turns = buildMessageTurns(visibleMessages)
  const lastAssistantId =
    [...visibleMessages].reverse().find((message) => message.role === "assistant")?.id ?? null
  const activeTurnKey =
    turns.find((turn) => turn.assistants.some((message) => message.id === lastAssistantId))?.key ??
    null

  return {
    activeTurnKey,
    lastAssistantId,
    toolResults,
    turns
  }
}
