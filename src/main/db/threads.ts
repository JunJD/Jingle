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

export interface CloneThreadInput extends CreateThreadInput {
  threadValues?: Record<string, unknown> | null
}

export interface UpdateThreadInput {
  metadata?: Record<string, unknown> | string | null
  status?: string
  thread_values?: string | null
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

function buildClonedPendingHitlRequestId(targetThreadId: string, index: number): string {
  return `hitl:${targetThreadId}:clone:${index}`
}

function getRequiredPendingHitlToolCallId(request: {
  requestId: string
  toolCallId: string | null
}): string {
  if (typeof request.toolCallId === "string" && request.toolCallId.length > 0) {
    return request.toolCallId
  }

  throw new Error(
    `[cloneThread] Pending HITL request "${request.requestId}" is missing toolCallId.`
  )
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
  trigramQuery: string | null
}): Promise<ThreadSearchMatches> {
  const { directLimit, ftsQuery, messageLimit, query, trigramQuery } = params
  const prisma = getPrismaClient()

  const [directRows, messageRows, trigramRows] = await Promise.all([
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
      : Promise.resolve([]),
    trigramQuery
      ? prisma.$queryRawUnsafe<
          {
            rank: number
            search_text: string | null
            title: string | null
            thread_id: string
            updated_at: bigint | number
          }[]
        >(
          `SELECT messages_fts_trigram.thread_id, messages_fts_trigram.search_text, bm25(messages_fts_trigram) AS rank, threads.title, threads.updated_at
           FROM messages_fts_trigram
           INNER JOIN threads ON threads.thread_id = messages_fts_trigram.thread_id
           WHERE messages_fts_trigram MATCH ?
           ORDER BY rank
           LIMIT ?`,
          trigramQuery,
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
    messages: [...trigramRows, ...messageRows].map((row) => ({
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

export async function cloneThread(
  sourceThreadId: string,
  targetThreadId: string,
  input?: CloneThreadInput
): Promise<ThreadRow> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())

  return prisma.$transaction(async (tx) => {
    const sourceThread = await tx.thread.findUnique({
      where: {
        threadId: sourceThreadId
      }
    })

    if (!sourceThread) {
      throw new Error("Thread not found")
    }

    const checkpoints = await tx.checkpoint.findMany({
      orderBy: {
        checkpointId: "asc"
      },
      where: {
        threadId: sourceThreadId
      }
    })
    const checkpointWrites = await tx.checkpointWrite.findMany({
      orderBy: [{ checkpointId: "asc" }, { taskId: "asc" }, { idx: "asc" }],
      where: {
        threadId: sourceThreadId
      }
    })
    const pendingHitlRequests = await tx.hitlRequest.findMany({
      orderBy: [{ updatedAt: "desc" }, { requestId: "asc" }],
      where: {
        threadId: sourceThreadId,
        status: "pending"
      }
    })
    const nextMetadata =
      input?.metadata === undefined ? sourceThread.metadata : JSON.stringify(input.metadata)
    const nextTitle = input?.title ?? sourceThread.title
    const nextThreadValues =
      input?.threadValues === undefined
        ? sourceThread.threadValues
        : input.threadValues === null
          ? null
          : JSON.stringify(input.threadValues)
    const row = await tx.thread.create({
      data: {
        createdAt: now,
        metadata: nextMetadata,
        status: "idle",
        threadId: targetThreadId,
        threadValues: nextThreadValues,
        title: nextTitle,
        updatedAt: now
      }
    })

    if (checkpoints.length > 0) {
      await tx.checkpoint.createMany({
        data: checkpoints.map((checkpoint) => ({
          checkpoint: checkpoint.checkpoint,
          checkpointId: checkpoint.checkpointId,
          checkpointNs: checkpoint.checkpointNs,
          metadata: checkpoint.metadata,
          parentCheckpointId: checkpoint.parentCheckpointId,
          threadId: targetThreadId,
          type: checkpoint.type
        }))
      })
    }

    if (checkpointWrites.length > 0) {
      await tx.checkpointWrite.createMany({
        data: checkpointWrites.map((write) => ({
          channel: write.channel,
          checkpointId: write.checkpointId,
          checkpointNs: write.checkpointNs,
          idx: write.idx,
          taskId: write.taskId,
          threadId: targetThreadId,
          type: write.type,
          value: write.value
        }))
      })
    }

    if (pendingHitlRequests.length > 0) {
      await tx.hitlRequest.createMany({
        data: pendingHitlRequests.map((request, index) => {
          const toolCallId = getRequiredPendingHitlToolCallId(request)

          return {
            requestId: buildClonedPendingHitlRequestId(targetThreadId, index),
            threadId: targetThreadId,
            runId: null,
            toolCallId,
            toolName: request.toolName,
            toolArgs: request.toolArgs,
            reviewKind: request.reviewKind,
            reviewPayload: request.reviewPayload,
            allowedDecisions: request.allowedDecisions,
            status: "pending",
            decision: null,
            createdAt: request.createdAt,
            updatedAt: request.updatedAt,
            resolvedAt: null
          }
        })
      })
    }

    return mapThreadRow(row)
  })
}

export async function updateThread(
  threadId: string,
  updates: UpdateThreadInput
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
    await tx.$executeRawUnsafe(`DELETE FROM "messages_fts_trigram" WHERE thread_id = ?`, threadId)
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
