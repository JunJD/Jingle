import type { ContentBlock } from "@shared/app-types"
import {
  extractComposerMessageRefsMetadata,
  extractMessageText,
  summarizeMessageContent,
  type AgentMessageContent
} from "@shared/message-content"
import { Prisma } from "@prisma/client"
import { buildSegmentedSearchText } from "../search-text"
import { getPrismaClient } from "./client"

type IndexedCheckpointMessage = {
  content: string
  created_at?: number
  kind?: string
  message_id: string
  metadata?: string | null
  name?: string | null
  role: string
  tool_call_id?: string | null
  tool_calls?: string | null
}

type IndexedProjectedMessage = {
  content: string
  createdAt: number
  kind: string
  messageId: string
  metadata: string | null
  name: string | null
  role: string
  searchText: string
  toolCallId: string | null
  toolCalls: string | null
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
        return ref.name ?? "Attached image"
      case "assistant-message-selection":
        return ref.selectedText
      default:
        return ""
    }
  })

  const extractedText = extractMessageText(parsedContent).trim()
  const candidateParts = [
    extractedText,
    summarizeMessageContent(parsedContent).trim(),
    buildSegmentedSearchText(extractedText)?.trim() ?? "",
    ...refLabels.map((part) => part.trim())
  ]

  return Array.from(new Set(candidateParts.filter(Boolean))).join("\n")
}

function buildProjectedMessages(messages: IndexedCheckpointMessage[]): IndexedProjectedMessage[] {
  const now = Date.now()
  return messages.map((message, index) => ({
    content: message.content,
    createdAt: message.created_at ?? now + index,
    kind: message.kind ?? "message",
    messageId: message.message_id,
    metadata: message.metadata ?? null,
    name: message.name ?? null,
    role: message.role,
    searchText: buildIndexedMessageSearchText(message),
    toolCallId: message.tool_call_id ?? null,
    toolCalls: message.tool_calls ?? null
  }))
}

function buildProjectedRawMessage(message: IndexedProjectedMessage): string {
  return JSON.stringify({
    content: parseIndexedMessageContent(message.content),
    role: message.role,
    source: "jingle-message-search-projection"
  })
}

export async function syncMessageProjectionFromSnapshot(
  threadId: string,
  messages: IndexedCheckpointMessage[]
): Promise<void> {
  const prisma = getPrismaClient()
  const projectedMessages = buildProjectedMessages(messages)
  const projectedIds = new Set(projectedMessages.map((message) => message.messageId))
  const now = BigInt(Date.now())

  const existingRows = await prisma.message.findMany({
    select: { messageId: true },
    where: { threadId }
  })
  const staleIds: string[] = []
  for (const row of existingRows) {
    if (!projectedIds.has(row.messageId)) {
      staleIds.push(row.messageId)
    }
  }

  if (staleIds.length > 0) {
    await prisma.message.deleteMany({
      where: {
        messageId: { in: staleIds },
        threadId
      }
    })
  }

  await Promise.all(
    projectedMessages.map((message, index) =>
      prisma.message.upsert({
        where: {
          threadId_messageId: {
            messageId: message.messageId,
            threadId
          }
        },
        create: {
          content: message.content,
          createdAt: BigInt(message.createdAt),
          kind: message.kind,
          messageId: message.messageId,
          metadata: message.metadata,
          name: message.name,
          rawHash: message.messageId,
          rawMessage: buildProjectedRawMessage(message),
          role: message.role,
          runId: null,
          searchText: message.searchText,
          seq: index + 1,
          threadId,
          toolCallId: message.toolCallId,
          toolCalls: message.toolCalls,
          updatedAt: now
        },
        update: {
          content: message.content,
          kind: message.kind,
          metadata: message.metadata,
          name: message.name,
          rawHash: message.messageId,
          rawMessage: buildProjectedRawMessage(message),
          role: message.role,
          searchText: message.searchText,
          seq: index + 1,
          toolCallId: message.toolCallId,
          toolCalls: message.toolCalls,
          updatedAt: now
        }
      })
    )
  )
}

export async function syncMessageSearchIndexFromSnapshot(
  threadId: string,
  messages: IndexedCheckpointMessage[]
): Promise<void> {
  await syncMessageProjectionFromSnapshot(threadId, messages)
  await rebuildMessageSearchIndexFromMessages(threadId)
}

export async function rebuildMessageSearchIndexFromMessages(threadId?: string): Promise<void> {
  const prisma = getPrismaClient()

  if (threadId) {
    await prisma.$executeRaw`DELETE FROM "messages_fts" WHERE thread_id = ${threadId}`
    await prisma.$executeRaw`DELETE FROM "messages_fts_trigram" WHERE thread_id = ${threadId}`
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO "messages_fts" ("thread_id", "message_id", "role", "search_text")
        SELECT "thread_id", "message_id", "role", "search_text"
        FROM "messages"
        WHERE "thread_id" = ${threadId} AND length("search_text") > 0`
    )
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO "messages_fts_trigram" ("thread_id", "message_id", "role", "search_text")
        SELECT "thread_id", "message_id", "role", "search_text"
        FROM "messages"
        WHERE "thread_id" = ${threadId} AND length("search_text") > 0`
    )
    return
  }

  await prisma.$executeRaw`DELETE FROM "messages_fts"`
  await prisma.$executeRaw`DELETE FROM "messages_fts_trigram"`
  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO "messages_fts" ("thread_id", "message_id", "role", "search_text")
      SELECT "thread_id", "message_id", "role", "search_text"
      FROM "messages"
      WHERE length("search_text") > 0`
  )
  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO "messages_fts_trigram" ("thread_id", "message_id", "role", "search_text")
      SELECT "thread_id", "message_id", "role", "search_text"
      FROM "messages"
      WHERE length("search_text") > 0`
  )
}
