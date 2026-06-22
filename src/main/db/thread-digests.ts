import {
  buildSegmentedSearchText,
  buildTrigramFtsQuery,
  buildUnicodeFtsQuery
} from "../search-text"
import { getPrismaClient } from "./client"
import type {
  ThreadDigestRecord,
  ThreadDigestSearchMatch,
  ThreadDigestStatus
} from "@shared/thread-digest"

interface ThreadDigestRowInput {
  createdAt: bigint
  decisions: string | null
  generatedAt: bigint | null
  messageCount: number
  openQuestions: string | null
  projectedThroughSeq: number
  projectionError: string | null
  sourceHash: string | null
  status: string
  summary: string | null
  threadId: string
  topics: string | null
  updatedAt: bigint
}

interface ThreadDigestSearchQueryRow extends ThreadDigestRowInput {
  rank: number
  search_text: string | null
  thread_title: string | null
  thread_updated_at: bigint | number
}

export interface UpsertReadyThreadDigestInput {
  decisions: string[]
  messageCount: number
  openQuestions: string[]
  projectedThroughSeq: number
  sourceHash: string
  summary: string
  threadId: string
  topics: string[]
}

function parseStringArray(value: string | null): string[] {
  if (!value) {
    return []
  }

  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error("[ThreadDigest] Expected stored list field to be a JSON array.")
  }

  return parsed.map((item) => {
    if (typeof item !== "string") {
      throw new Error("[ThreadDigest] Expected stored list item to be a string.")
    }

    return item
  })
}

function serializeStringArray(value: string[]): string {
  return JSON.stringify(value)
}

function mapThreadDigestRow(row: ThreadDigestRowInput): ThreadDigestRecord {
  return {
    decisions: parseStringArray(row.decisions),
    generatedAt: row.generatedAt === null ? null : Number(row.generatedAt),
    messageCount: row.messageCount,
    openQuestions: parseStringArray(row.openQuestions),
    projectedThroughSeq: row.projectedThroughSeq,
    projectionError: row.projectionError,
    sourceHash: row.sourceHash,
    status: row.status as ThreadDigestStatus,
    summary: row.summary,
    threadId: row.threadId,
    topics: parseStringArray(row.topics),
    updatedAt: Number(row.updatedAt)
  }
}

function mapThreadDigestSearchRow(row: ThreadDigestSearchQueryRow): ThreadDigestSearchMatch {
  return {
    ...mapThreadDigestRow(row),
    rank: row.rank,
    searchText: row.search_text,
    threadTitle: row.thread_title,
    threadUpdatedAt: Number(row.thread_updated_at)
  }
}

function buildThreadDigestSearchText(input: {
  decisions: string[]
  openQuestions: string[]
  summary: string
  topics: string[]
}): string {
  const exactText = [
    input.summary.trim(),
    ...input.topics.map((topic) => topic.trim()),
    ...input.decisions.map((decision) => decision.trim()),
    ...input.openQuestions.map((question) => question.trim())
  ]
    .filter(Boolean)
    .join("\n")
  const segmentedText = buildSegmentedSearchText(exactText)?.trim() ?? ""

  return Array.from(new Set([exactText, segmentedText].filter(Boolean))).join("\n")
}

async function replaceThreadDigestSearchIndex(input: {
  searchText: string
  threadId: string
}): Promise<void> {
  const prisma = getPrismaClient()
  await prisma.$executeRawUnsafe(
    `DELETE FROM "thread_digests_fts" WHERE thread_id = ?`,
    input.threadId
  )
  await prisma.$executeRawUnsafe(
    `DELETE FROM "thread_digests_fts_trigram" WHERE thread_id = ?`,
    input.threadId
  )

  if (input.searchText.length === 0) {
    return
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "thread_digests_fts" ("thread_id", "search_text") VALUES (?, ?)`,
    input.threadId,
    input.searchText
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO "thread_digests_fts_trigram" ("thread_id", "search_text") VALUES (?, ?)`,
    input.threadId,
    input.searchText
  )
}

export async function getThreadDigest(threadId: string): Promise<ThreadDigestRecord | null> {
  const row = await getPrismaClient().threadDigest.findUnique({
    where: { threadId }
  })

  return row ? mapThreadDigestRow(row) : null
}

export async function upsertReadyThreadDigest(input: UpsertReadyThreadDigestInput): Promise<void> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const searchText = buildThreadDigestSearchText(input)

  await prisma.threadDigest.upsert({
    create: {
      decisions: serializeStringArray(input.decisions),
      generatedAt: now,
      messageCount: input.messageCount,
      openQuestions: serializeStringArray(input.openQuestions),
      projectedThroughSeq: input.projectedThroughSeq,
      projectionError: null,
      sourceHash: input.sourceHash,
      status: "ready",
      summary: input.summary,
      threadId: input.threadId,
      topics: serializeStringArray(input.topics),
      createdAt: now,
      updatedAt: now
    },
    update: {
      decisions: serializeStringArray(input.decisions),
      generatedAt: now,
      messageCount: input.messageCount,
      openQuestions: serializeStringArray(input.openQuestions),
      projectedThroughSeq: input.projectedThroughSeq,
      projectionError: null,
      sourceHash: input.sourceHash,
      status: "ready",
      summary: input.summary,
      topics: serializeStringArray(input.topics),
      updatedAt: now
    },
    where: { threadId: input.threadId }
  })
  await replaceThreadDigestSearchIndex({
    searchText,
    threadId: input.threadId
  })
}

export async function markThreadDigestProjectionPending(threadId: string): Promise<void> {
  const now = BigInt(Date.now())
  await getPrismaClient().threadDigest.upsert({
    create: {
      decisions: null,
      generatedAt: null,
      messageCount: 0,
      openQuestions: null,
      projectedThroughSeq: 0,
      projectionError: null,
      sourceHash: null,
      status: "pending",
      summary: null,
      threadId,
      topics: null,
      createdAt: now,
      updatedAt: now
    },
    update: {
      decisions: null,
      generatedAt: null,
      messageCount: 0,
      openQuestions: null,
      projectedThroughSeq: 0,
      projectionError: null,
      sourceHash: null,
      status: "pending",
      summary: null,
      topics: null,
      updatedAt: now
    },
    where: { threadId }
  })
  await replaceThreadDigestSearchIndex({
    searchText: "",
    threadId
  })
}

export async function markThreadDigestProjectionError(
  threadId: string,
  message: string
): Promise<void> {
  const now = BigInt(Date.now())
  await getPrismaClient().threadDigest.upsert({
    create: {
      decisions: null,
      generatedAt: null,
      messageCount: 0,
      openQuestions: null,
      projectedThroughSeq: 0,
      projectionError: message,
      sourceHash: null,
      status: "failed",
      summary: null,
      threadId,
      topics: null,
      createdAt: now,
      updatedAt: now
    },
    update: {
      decisions: null,
      generatedAt: null,
      messageCount: 0,
      openQuestions: null,
      projectedThroughSeq: 0,
      projectionError: message,
      sourceHash: null,
      status: "failed",
      summary: null,
      topics: null,
      updatedAt: now
    },
    where: { threadId }
  })
  await replaceThreadDigestSearchIndex({
    searchText: "",
    threadId
  })
}

function dedupeThreadDigestSearchRows(
  rows: ThreadDigestSearchQueryRow[],
  limit: number
): ThreadDigestSearchMatch[] {
  const seen = new Set<string>()
  const matches: ThreadDigestSearchMatch[] = []

  for (const row of rows) {
    if (seen.has(row.threadId)) {
      continue
    }

    seen.add(row.threadId)
    matches.push(mapThreadDigestSearchRow(row))
    if (matches.length >= limit) {
      break
    }
  }

  return matches
}

export async function searchThreadDigests(input: {
  limit: number
  query: string
  threadId?: string
}): Promise<ThreadDigestSearchMatch[]> {
  const query = input.query.trim()
  const limit = Math.min(Math.max(input.limit, 1), 50)
  if (!query) {
    return []
  }

  const ftsQuery = buildUnicodeFtsQuery(query)
  const trigramQuery = buildTrigramFtsQuery(query)
  const threadWhere = input.threadId
    ? " AND thread_digests.thread_id = ?"
    : " AND threads.archived_at IS NULL"
  const threadArgs = input.threadId ? ([input.threadId] as const) : ([] as const)
  const selectColumns = `
    thread_digests.thread_id AS threadId,
    thread_digests.status,
    thread_digests.summary,
    thread_digests.topics,
    thread_digests.decisions,
    thread_digests.open_questions AS openQuestions,
    thread_digests.message_count AS messageCount,
    thread_digests.projected_through_seq AS projectedThroughSeq,
    thread_digests.source_hash AS sourceHash,
    thread_digests.projection_error AS projectionError,
    thread_digests.generated_at AS generatedAt,
    thread_digests.created_at AS createdAt,
    thread_digests.updated_at AS updatedAt,
    threads.title AS thread_title,
    threads.updated_at AS thread_updated_at`
  const prisma = getPrismaClient()
  const [trigramRows, ftsRows] = await Promise.all([
    trigramQuery
      ? prisma.$queryRawUnsafe<ThreadDigestSearchQueryRow[]>(
          `SELECT ${selectColumns}, thread_digests_fts_trigram.search_text, bm25(thread_digests_fts_trigram) AS rank
           FROM thread_digests_fts_trigram
           INNER JOIN thread_digests
             ON thread_digests.thread_id = thread_digests_fts_trigram.thread_id
           INNER JOIN threads ON threads.thread_id = thread_digests.thread_id
           WHERE thread_digests_fts_trigram MATCH ?
           AND thread_digests.status = 'ready'
           ${threadWhere}
           ORDER BY rank
           LIMIT ?`,
          trigramQuery,
          ...threadArgs,
          limit
        )
      : Promise.resolve([]),
    ftsQuery
      ? prisma.$queryRawUnsafe<ThreadDigestSearchQueryRow[]>(
          `SELECT ${selectColumns}, thread_digests_fts.search_text, bm25(thread_digests_fts) AS rank
           FROM thread_digests_fts
           INNER JOIN thread_digests
             ON thread_digests.thread_id = thread_digests_fts.thread_id
           INNER JOIN threads ON threads.thread_id = thread_digests.thread_id
           WHERE thread_digests_fts MATCH ?
           AND thread_digests.status = 'ready'
           ${threadWhere}
           ORDER BY rank
           LIMIT ?`,
          ftsQuery,
          ...threadArgs,
          limit
        )
      : Promise.resolve([])
  ])

  return dedupeThreadDigestSearchRows([...trigramRows, ...ftsRows], limit)
}
