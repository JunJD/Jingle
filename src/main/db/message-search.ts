import {
  extractComposerMessageRefsMetadata,
  extractMessageText,
  parsePersistedMessageContent,
  summarizeMessageContent,
  type MessageContentRole
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
  message: Pick<IndexedCheckpointMessage, "content" | "role"> & {
    message_id?: string
    messageId?: string
    tool_call_id?: string | null
    toolCallId?: string | null
  }
) {
  const role: MessageContentRole =
    message.role === "assistant" || message.role === "system" || message.role === "tool"
      ? message.role
      : "user"
  return parsePersistedMessageContent(message.content, {
    role,
    ...(message.tool_call_id || message.toolCallId
      ? { toolCallId: message.tool_call_id ?? message.toolCallId }
      : {}),
    onInvalid: (reason) => {
      console.warn("[MessageSearch] Invalid persisted message content.", {
        messageId: message.message_id ?? message.messageId,
        reason
      })
    }
  })
}

function buildIndexedMessageSearchText(
  message: IndexedCheckpointMessage,
  parsedContent: ReturnType<typeof parseIndexedMessageContent>
): string {
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
  return messages.map((message, index) => {
    const parsedContent = parseIndexedMessageContent(message)
    return {
      content: JSON.stringify(parsedContent),
      createdAt: message.created_at ?? now + index,
      kind: message.kind ?? "message",
      messageId: message.message_id,
      metadata: message.metadata ?? null,
      name: message.name ?? null,
      role: message.role,
      searchText: buildIndexedMessageSearchText(message, parsedContent),
      toolCallId: message.tool_call_id ?? null,
      toolCalls: message.tool_calls ?? null
    }
  })
}

function buildProjectedRawMessage(message: IndexedProjectedMessage): string {
  return JSON.stringify({
    content: parseIndexedMessageContent(message),
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
    await prisma.$transaction([
      prisma.$executeRaw`DELETE FROM "messages_fts" WHERE thread_id = ${threadId}`,
      prisma.$executeRaw`DELETE FROM "messages_fts_trigram" WHERE thread_id = ${threadId}`,
      prisma.$executeRaw(
        Prisma.sql`INSERT INTO "messages_fts" ("thread_id", "message_id", "role", "search_text")
          SELECT "thread_id", "message_id", "role", "search_text"
          FROM "messages"
          WHERE "thread_id" = ${threadId} AND length("search_text") > 0`
      ),
      prisma.$executeRaw(
        Prisma.sql`INSERT INTO "messages_fts_trigram" ("thread_id", "message_id", "role", "search_text")
          SELECT "thread_id", "message_id", "role", "search_text"
          FROM "messages"
          WHERE "thread_id" = ${threadId} AND length("search_text") > 0`
      )
    ])
    return
  }

  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM "messages_fts"`,
    prisma.$executeRaw`DELETE FROM "messages_fts_trigram"`,
    prisma.$executeRaw(
      Prisma.sql`INSERT INTO "messages_fts" ("thread_id", "message_id", "role", "search_text")
        SELECT "thread_id", "message_id", "role", "search_text"
        FROM "messages"
        WHERE length("search_text") > 0`
    ),
    prisma.$executeRaw(
      Prisma.sql`INSERT INTO "messages_fts_trigram" ("thread_id", "message_id", "role", "search_text")
        SELECT "thread_id", "message_id", "role", "search_text"
        FROM "messages"
        WHERE length("search_text") > 0`
    )
  ])
}

export async function syncMessageSearchIndexEntriesFromMessages(input: {
  messageIds: readonly string[]
  threadId: string
}): Promise<void> {
  const messageIds = Array.from(new Set(input.messageIds)).sort()
  if (messageIds.length === 0) return

  const prisma = getPrismaClient()
  const ids = Prisma.join(messageIds)
  await prisma.$transaction([
    prisma.$executeRaw(
      Prisma.sql`DELETE FROM "messages_fts"
        WHERE "thread_id" = ${input.threadId} AND "message_id" IN (${ids})`
    ),
    prisma.$executeRaw(
      Prisma.sql`DELETE FROM "messages_fts_trigram"
        WHERE "thread_id" = ${input.threadId} AND "message_id" IN (${ids})`
    ),
    prisma.$executeRaw(
      Prisma.sql`INSERT INTO "messages_fts" ("thread_id", "message_id", "role", "search_text")
        SELECT "thread_id", "message_id", "role", "search_text"
        FROM "messages"
        WHERE "thread_id" = ${input.threadId}
          AND "message_id" IN (${ids})
          AND length("search_text") > 0`
    ),
    prisma.$executeRaw(
      Prisma.sql`INSERT INTO "messages_fts_trigram" ("thread_id", "message_id", "role", "search_text")
        SELECT "thread_id", "message_id", "role", "search_text"
        FROM "messages"
        WHERE "thread_id" = ${input.threadId}
          AND "message_id" IN (${ids})
          AND length("search_text") > 0`
    )
  ])
}

export async function findMessageSearchProjectionDriftThreadIds(): Promise<string[]> {
  const rows = await getPrismaClient().$queryRaw<Array<{ threadId: string }>>`
    WITH "message_search_projection_rows" AS (
      SELECT "thread_id", "message_id", "role", "search_text", 'canonical' AS "source"
      FROM "messages"
      WHERE length("search_text") > 0
      UNION ALL
      SELECT "thread_id", "message_id", "role", "search_text", 'unicode' AS "source"
      FROM "messages_fts"
      UNION ALL
      SELECT "thread_id", "message_id", "role", "search_text", 'trigram' AS "source"
      FROM "messages_fts_trigram"
    ),
    "message_search_projection_counts" AS (
      SELECT
        "thread_id",
        "message_id",
        "role",
        "search_text",
        SUM(CASE WHEN "source" = 'canonical' THEN 1 ELSE 0 END) AS "canonical_count",
        SUM(CASE WHEN "source" = 'unicode' THEN 1 ELSE 0 END) AS "unicode_count",
        SUM(CASE WHEN "source" = 'trigram' THEN 1 ELSE 0 END) AS "trigram_count"
      FROM "message_search_projection_rows"
      GROUP BY "thread_id", "message_id", "role", "search_text"
    )
    SELECT DISTINCT "thread_id" AS "threadId"
    FROM "message_search_projection_counts"
    WHERE "canonical_count" <> "unicode_count"
       OR "canonical_count" <> "trigram_count"
    ORDER BY "thread_id" ASC
  `
  return rows.map((row) => row.threadId)
}
