import { getPrismaClient } from "./client"
import { toNumber } from "./utils"

export interface ThreadRow {
  thread_id: string
  created_at: number
  updated_at: number
  metadata: string | null
  status: string
  thread_values: string | null
  title: string | null
}

export interface ThreadSearchDirectMatchRow {
  thread_id: string
  updated_at: number
  title: string | null
}

export interface ThreadSearchMessageMatchRow {
  thread_id: string
  updated_at: number
  title: string | null
  rank: number
  search_text: string | null
}

export interface ThreadSearchMatches {
  direct: ThreadSearchDirectMatchRow[]
  messages: ThreadSearchMessageMatchRow[]
}

export interface CreateThreadInput {
  metadata?: Record<string, unknown>
  title?: string | null
}

function mapThreadRow(row: {
  threadId: string
  createdAt: bigint
  updatedAt: bigint
  metadata: string | null
  status: string
  threadValues: string | null
  title: string | null
}): ThreadRow {
  return {
    thread_id: row.threadId,
    created_at: toNumber(row.createdAt),
    updated_at: toNumber(row.updatedAt),
    metadata: row.metadata,
    status: row.status,
    thread_values: row.threadValues,
    title: row.title
  }
}

export async function getAllThreads(): Promise<ThreadRow[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.thread.findMany({
    orderBy: {
      updatedAt: "desc"
    }
  })

  return rows.map(mapThreadRow)
}

export async function getThread(threadId: string): Promise<ThreadRow | null> {
  const prisma = getPrismaClient()
  const row = await prisma.thread.findUnique({
    where: {
      threadId
    }
  })

  return row ? mapThreadRow(row) : null
}

export async function searchThreadMatches(params: {
  directLimit: number
  ftsQuery: string | null
  messageLimit: number
  query: string
}): Promise<ThreadSearchMatches> {
  const { directLimit, ftsQuery, messageLimit, query } = params
  const prisma = getPrismaClient()

  const [directRows, messageRows] = await Promise.all([
    prisma.thread.findMany({
      where: {
        OR: [
          {
            threadId: {
              contains: query
            }
          },
          {
            title: {
              contains: query
            }
          }
        ]
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: directLimit
    }),
    ftsQuery
      ? prisma.$queryRawUnsafe<
          {
            rank: number
            search_text: string | null
            title: string | null
            thread_id: string
            updated_at: bigint | number
          }[]
        >(
          `SELECT messages_fts.thread_id, messages_fts.search_text, bm25(messages_fts) AS rank, threads.title, threads.updated_at
           FROM messages_fts
           INNER JOIN threads ON threads.thread_id = messages_fts.thread_id
           WHERE messages_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
          ftsQuery,
          messageLimit
        )
      : Promise.resolve([])
  ])

  return {
    direct: directRows.map((row) => ({
      thread_id: row.threadId,
      title: row.title,
      updated_at: Number(row.updatedAt)
    })),
    messages: messageRows.map((row) => ({
      rank: row.rank,
      search_text: row.search_text,
      thread_id: row.thread_id,
      title: row.title,
      updated_at: toNumber(row.updated_at)
    }))
  }
}

export async function createThread(
  threadId: string,
  input?: CreateThreadInput
): Promise<ThreadRow> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())

  const row = await prisma.thread.create({
    data: {
      threadId,
      createdAt: now,
      updatedAt: now,
      metadata: input?.metadata ? JSON.stringify(input.metadata) : null,
      status: "idle",
      title: input?.title ?? null
    }
  })

  return mapThreadRow(row)
}

export async function updateThread(
  threadId: string,
  updates: Partial<Omit<ThreadRow, "thread_id" | "created_at">>
): Promise<ThreadRow | null> {
  const prisma = getPrismaClient()
  const existing = await prisma.thread.findUnique({
    where: {
      threadId
    }
  })

  if (!existing) {
    return null
  }

  const row = await prisma.thread.update({
    where: {
      threadId
    },
    data: {
      updatedAt: BigInt(Date.now()),
      metadata:
        updates.metadata === undefined
          ? undefined
          : typeof updates.metadata === "string"
            ? updates.metadata
            : JSON.stringify(updates.metadata),
      status: updates.status,
      threadValues: updates.thread_values,
      title: updates.title
    }
  })

  return mapThreadRow(row)
}

export async function deleteThread(threadId: string): Promise<void> {
  const prisma = getPrismaClient()

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM "messages_fts" WHERE thread_id = ?`, threadId)
    await tx.hitlRequest.deleteMany({
      where: { threadId }
    })
    await tx.checkpointWrite.deleteMany({
      where: { threadId }
    })
    await tx.checkpoint.deleteMany({
      where: { threadId }
    })
    await tx.sessionBinding.deleteMany({
      where: { currentThreadId: threadId }
    })
    await tx.run.deleteMany({
      where: { threadId }
    })
    await tx.thread.deleteMany({
      where: { threadId }
    })
  })
}
