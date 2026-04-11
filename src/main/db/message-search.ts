import type { ContentBlock } from "../../shared/app-types"
import {
  extractComposerMessageRefsMetadata,
  extractMessageText,
  summarizeMessageContent,
  type AgentMessageContent
} from "../../shared/message-content"
import { getPrismaClient } from "./client"

type IndexedCheckpointMessage = {
  content: string
  message_id: string
  metadata?: string | null
  role: string
}

function parseIndexedMessageContent(
  content: string
): string | ContentBlock[] | AgentMessageContent {
  try {
    const parsed = JSON.parse(content) as unknown
    return typeof parsed === "string" || Array.isArray(parsed)
      ? (parsed as string | ContentBlock[] | AgentMessageContent)
      : content
  } catch {
    return content
  }
}

function buildIndexedMessageSearchText(message: IndexedCheckpointMessage): string {
  const parsedContent = parseIndexedMessageContent(message.content)
  const refs = (() => {
    if (!message.metadata) {
      return []
    }

    try {
      return extractComposerMessageRefsMetadata(JSON.parse(message.metadata) as unknown)
    } catch {
      return []
    }
  })()

  const refLabels = refs.map((ref) => {
    switch (ref.type) {
      case "file":
        return ref.name
      case "image":
        return ref.name || ref.url
      default:
        return ""
    }
  })

  const candidateParts = [
    extractMessageText(parsedContent).trim(),
    summarizeMessageContent(parsedContent).trim(),
    ...refLabels.map((part) => part.trim())
  ]

  return Array.from(new Set(candidateParts.filter(Boolean))).join("\n")
}

export async function syncMessageSearchIndexFromSnapshot(
  threadId: string,
  messages: IndexedCheckpointMessage[]
): Promise<void> {
  const prisma = getPrismaClient()
  const indexedMessages = messages
    .map((message) => ({
      messageId: message.message_id,
      role: message.role,
      searchText: buildIndexedMessageSearchText(message)
    }))
    .filter((message) => message.searchText.length > 0)

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM "messages_fts" WHERE thread_id = ?`, threadId)

    for (const message of indexedMessages) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "messages_fts" ("thread_id", "message_id", "role", "search_text") VALUES (?, ?, ?, ?)`,
        threadId,
        message.messageId,
        message.role,
        message.searchText
      )
    }
  })
}
