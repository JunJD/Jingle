import { Prisma, type Checkpoint as PrismaCheckpoint } from "@prisma/client"
import { readStoredCheckpointChannelVersions } from "../checkpointer/prisma-saver"
import { getPrismaClient } from "./client"
import { projectMessageStateThroughSeq } from "./message-state"
import { toNumber } from "./utils"

export interface ThreadRow {
  thread_id: string
  created_at: number
  updated_at: number
  archived_at: number | null
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

interface ThreadSearchScope {
  metadataSource?: string
}

export interface CreateThreadInput {
  metadata?: Record<string, unknown>
  title?: string | null
}

export interface CloneThreadInput extends CreateThreadInput {
  threadValues?: Record<string, unknown> | null
}

export interface CloneThreadUntilCheckpointInput extends CloneThreadInput {
  checkpointId: string
  checkpointNs?: string
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
  archivedAt: bigint | null
  metadata: string | null
  status: string
  threadValues: string | null
  title: string | null
}): ThreadRow {
  return {
    thread_id: row.threadId,
    created_at: toNumber(row.createdAt),
    updated_at: toNumber(row.updatedAt),
    archived_at: row.archivedAt === null ? null : toNumber(row.archivedAt),
    metadata: row.metadata,
    status: row.status,
    thread_values: row.threadValues,
    title: row.title
  }
}

function buildSqlLikeContainsQuery(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
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

function buildCheckpointBlobVersionFilters(
  channelVersions: Record<string, string>[]
): Array<{ channel: string; version: string }> {
  const filters = new Map<string, { channel: string; version: string }>()

  for (const versions of channelVersions) {
    for (const [channel, version] of Object.entries(versions)) {
      filters.set(`${channel}\0${version}`, {
        channel,
        version
      })
    }
  }

  return Array.from(filters.values())
}

export async function getActiveThreads(): Promise<ThreadRow[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.thread.findMany({
    orderBy: {
      updatedAt: "desc"
    },
    where: {
      archivedAt: null
    }
  })

  return rows.map(mapThreadRow)
}

export async function getArchivedThreads(): Promise<ThreadRow[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.thread.findMany({
    orderBy: [
      {
        archivedAt: "desc"
      },
      {
        updatedAt: "desc"
      }
    ],
    where: {
      archivedAt: {
        not: null
      }
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
  scope?: ThreadSearchScope
  trigramQuery: string | null
}): Promise<ThreadSearchMatches> {
  const { directLimit, ftsQuery, messageLimit, query, scope, trigramQuery } = params
  const prisma = getPrismaClient()
  const metadataSource = scope?.metadataSource
  const scopedThreadWhere = metadataSource
    ? ` AND threads.archived_at IS NULL AND json_extract(threads.metadata, '$.source') = ?`
    : " AND threads.archived_at IS NULL"
  const scopedThreadArgs = metadataSource ? ([metadataSource] as const) : ([] as const)
  const directLikeQuery = buildSqlLikeContainsQuery(query)

  const [directRows, messageRows, trigramRows] = await Promise.all([
    prisma.$queryRawUnsafe<
      {
        thread_id: string
        title: string | null
        updated_at: bigint | number
      }[]
    >(
      `SELECT threads.thread_id, threads.title, threads.updated_at
       FROM threads
       WHERE (threads.thread_id LIKE ? ESCAPE '\\' OR threads.title LIKE ? ESCAPE '\\')
       ${scopedThreadWhere}
       ORDER BY threads.updated_at DESC
       LIMIT ?`,
      directLikeQuery,
      directLikeQuery,
      ...scopedThreadArgs,
      directLimit
    ),
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
           ${scopedThreadWhere}
           ORDER BY rank
           LIMIT ?`,
          ftsQuery,
          ...scopedThreadArgs,
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
           ${scopedThreadWhere}
           ORDER BY rank
           LIMIT ?`,
          trigramQuery,
          ...scopedThreadArgs,
          messageLimit
        )
      : Promise.resolve([])
  ])

  return {
    direct: directRows.map((row) => ({
      thread_id: row.thread_id,
      title: row.title,
      updated_at: toNumber(row.updated_at)
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
      archivedAt: null,
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
        archivedAt: null,
        metadata: nextMetadata,
        status: "idle",
        threadId: targetThreadId,
        threadValues: nextThreadValues,
        title: nextTitle,
        updatedAt: now
      }
    })

    const cloneOperations: Promise<unknown>[] = [
      tx.$executeRaw`
        INSERT INTO "checkpoints" (
          "thread_id",
          "run_id",
          "checkpoint_ns",
          "checkpoint_id",
          "parent_checkpoint_id",
          "type",
          "checkpoint",
          "metadata"
        )
        SELECT
          ${targetThreadId},
          NULL,
          "checkpoint_ns",
          "checkpoint_id",
          "parent_checkpoint_id",
          "type",
          "checkpoint",
          "metadata"
        FROM "checkpoints"
        WHERE "thread_id" = ${sourceThreadId}
      `,
      tx.$executeRaw`
        INSERT INTO "writes" (
          "thread_id",
          "checkpoint_ns",
          "checkpoint_id",
          "task_id",
          "idx",
          "channel",
          "type",
          "value"
        )
        SELECT
          ${targetThreadId},
          "checkpoint_ns",
          "checkpoint_id",
          "task_id",
          "idx",
          "channel",
          "type",
          "value"
        FROM "writes"
        WHERE "thread_id" = ${sourceThreadId}
      `,
      tx.$executeRaw`
        INSERT INTO "checkpoint_blobs" (
          "thread_id",
          "checkpoint_ns",
          "channel",
          "version",
          "type",
          "value"
        )
        SELECT
          ${targetThreadId},
          "checkpoint_ns",
          "channel",
          "version",
          "type",
          "value"
        FROM "checkpoint_blobs"
        WHERE "thread_id" = ${sourceThreadId}
          AND "channel" <> 'messages'
      `,
      tx.$executeRaw`
        INSERT INTO "messages" (
          "thread_id",
          "message_id",
          "seq",
          "role",
          "kind",
          "content",
          "raw_message",
          "raw_hash",
          "tool_calls",
          "tool_call_id",
          "name",
          "metadata",
          "run_id",
          "created_at",
          "updated_at",
          "search_text"
        )
        SELECT
          ${targetThreadId},
          "message_id",
          "seq",
          "role",
          "kind",
          "content",
          "raw_message",
          "raw_hash",
          "tool_calls",
          "tool_call_id",
          "name",
          "metadata",
          NULL,
          "created_at",
          ${now},
          "search_text"
        FROM "messages"
        WHERE "thread_id" = ${sourceThreadId}
      `,
      tx.$executeRaw`
        INSERT INTO "message_events" (
          "event_id",
          "thread_id",
          "checkpoint_ns",
          "seq",
          "type",
          "message_id",
          "run_id",
          "checkpoint_id",
          "payload",
          "created_at"
        )
        SELECT
          lower(hex(randomblob(16))),
          ${targetThreadId},
          "checkpoint_ns",
          "seq",
          "type",
          "message_id",
          NULL,
          "checkpoint_id",
          "payload",
          "created_at"
        FROM "message_events"
        WHERE "thread_id" = ${sourceThreadId}
      `,
      tx.$executeRaw`
        INSERT INTO "message_state_versions" (
          "thread_id",
          "checkpoint_ns",
          "version",
          "through_seq",
          "state_hash",
          "created_at"
        )
        SELECT
          ${targetThreadId},
          "checkpoint_ns",
          "version",
          "through_seq",
          "state_hash",
          "created_at"
        FROM "message_state_versions"
        WHERE "thread_id" = ${sourceThreadId}
      `
    ]

    if (pendingHitlRequests.length > 0) {
      cloneOperations.push(
        tx.hitlRequest.createMany({
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
      )
    }

    await Promise.all(cloneOperations)

    return mapThreadRow(row)
  })
}

export async function cloneThreadUntilCheckpoint(
  sourceThreadId: string,
  targetThreadId: string,
  input: CloneThreadUntilCheckpointInput
): Promise<ThreadRow> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const checkpointNs = input.checkpointNs ?? ""

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
      where: {
        checkpointNs,
        threadId: sourceThreadId
      }
    })
    const checkpointsById = new Map(
      checkpoints.map((checkpoint) => [checkpoint.checkpointId, checkpoint])
    )
    const targetCheckpoint = checkpointsById.get(input.checkpointId)

    if (!targetCheckpoint) {
      throw new Error("Checkpoint not found")
    }

    const checkpointChain: PrismaCheckpoint[] = []
    let cursor: typeof targetCheckpoint | undefined = targetCheckpoint
    while (cursor) {
      checkpointChain.push(cursor)

      if (!cursor.parentCheckpointId) {
        break
      }

      cursor = checkpointsById.get(cursor.parentCheckpointId)
      if (!cursor) {
        throw new Error(
          `Checkpoint "${input.checkpointId}" has missing parent "${checkpointChain[checkpointChain.length - 1]?.parentCheckpointId}".`
        )
      }
    }
    checkpointChain.reverse()

    const checkpointIds = checkpointChain.map((checkpoint) => checkpoint.checkpointId)
    const checkpointChannelVersions = checkpointChain
      .map((checkpoint) =>
        readStoredCheckpointChannelVersions(checkpoint.type, checkpoint.checkpoint)
      )
      .filter((versions): versions is Record<string, string> => versions !== null)
    const checkpointBlobFilters = buildCheckpointBlobVersionFilters(
      checkpointChannelVersions.map((versions) => {
        const { messages: _messages, ...nonMessageVersions } = versions
        void _messages
        return nonMessageVersions
      })
    )
    const targetCheckpointChannelVersions =
      readStoredCheckpointChannelVersions(targetCheckpoint.type, targetCheckpoint.checkpoint) ?? {}
    const targetMessagesVersion = targetCheckpointChannelVersions.messages
    if (!targetMessagesVersion) {
      throw new Error(
        `[cloneThreadUntilCheckpoint] Checkpoint "${input.checkpointId}" is missing messages channel version.`
      )
    }
    const targetMessageStateVersion = await tx.messageStateVersion.findUnique({
      select: { throughSeq: true },
      where: {
        threadId_checkpointNs_version: {
          checkpointNs,
          threadId: sourceThreadId,
          version: targetMessagesVersion
        }
      }
    })
    if (!targetMessageStateVersion) {
      throw new Error(
        `[cloneThreadUntilCheckpoint] Checkpoint "${input.checkpointId}" is missing message state version.`
      )
    }
    const targetMessageThroughSeq = targetMessageStateVersion.throughSeq
    const nextMetadata =
      input.metadata === undefined ? sourceThread.metadata : JSON.stringify(input.metadata)
    const nextTitle = input.title ?? sourceThread.title
    const nextThreadValues =
      input.threadValues === undefined
        ? sourceThread.threadValues
        : input.threadValues === null
          ? null
          : JSON.stringify(input.threadValues)
    const row = await tx.thread.create({
      data: {
        createdAt: now,
        archivedAt: null,
        metadata: nextMetadata,
        status: "idle",
        threadId: targetThreadId,
        threadValues: nextThreadValues,
        title: nextTitle,
        updatedAt: now
      }
    })

    const postCreateOperations: Promise<unknown>[] = [
      tx.checkpoint.createMany({
        data: checkpointChain.map((checkpoint) => ({
          checkpoint: checkpoint.checkpoint,
          checkpointId: checkpoint.checkpointId,
          checkpointNs: checkpoint.checkpointNs,
          metadata: checkpoint.metadata,
          parentCheckpointId: checkpoint.parentCheckpointId,
          threadId: targetThreadId,
          type: checkpoint.type
        }))
      }),
      tx.$executeRaw`
        INSERT INTO "writes" (
          "thread_id",
          "checkpoint_ns",
          "checkpoint_id",
          "task_id",
          "idx",
          "channel",
          "type",
          "value"
        )
        SELECT
          ${targetThreadId},
          "checkpoint_ns",
          "checkpoint_id",
          "task_id",
          "idx",
          "channel",
          "type",
          "value"
        FROM "writes"
        WHERE "thread_id" = ${sourceThreadId}
          AND "checkpoint_ns" = ${checkpointNs}
          AND "checkpoint_id" IN (${Prisma.join(checkpointIds)})
      `,
      projectMessageStateThroughSeq(
        {
          checkpointNs,
          runId: null,
          sourceThreadId,
          targetThreadId,
          throughSeq: targetMessageThroughSeq,
          updatedAt: now
        },
        tx
      ),
      tx.$executeRaw`
        INSERT INTO "message_events" (
          "event_id",
          "thread_id",
          "checkpoint_ns",
          "seq",
          "type",
          "message_id",
          "run_id",
          "checkpoint_id",
          "payload",
          "created_at"
        )
        SELECT
          lower(hex(randomblob(16))),
          ${targetThreadId},
          "checkpoint_ns",
          "seq",
          "type",
          "message_id",
          NULL,
          "checkpoint_id",
          "payload",
          "created_at"
        FROM "message_events"
        WHERE "thread_id" = ${sourceThreadId}
          AND "checkpoint_ns" = ${checkpointNs}
          AND "seq" <= ${targetMessageThroughSeq}
      `,
      tx.$executeRaw`
        INSERT INTO "message_state_versions" (
          "thread_id",
          "checkpoint_ns",
          "version",
          "through_seq",
          "state_hash",
          "created_at"
        )
        SELECT
          ${targetThreadId},
          "checkpoint_ns",
          "version",
          "through_seq",
          "state_hash",
          "created_at"
        FROM "message_state_versions"
        WHERE "thread_id" = ${sourceThreadId}
          AND "checkpoint_ns" = ${checkpointNs}
          AND "version" IN (${Prisma.join(
            checkpointChannelVersions
              .map((versions) => versions.messages)
              .filter((version): version is string => Boolean(version))
          )})
      `
    ]

    if (checkpointBlobFilters.length > 0) {
      const checkpointBlobFilterSql = Prisma.join(
        checkpointBlobFilters.map(
          ({ channel, version }) => Prisma.sql`("channel" = ${channel} AND "version" = ${version})`
        ),
        " OR "
      )

      postCreateOperations.push(
        tx.$executeRaw`
          INSERT INTO "checkpoint_blobs" (
            "thread_id",
            "checkpoint_ns",
            "channel",
            "version",
            "type",
            "value"
          )
          SELECT
            ${targetThreadId},
            "checkpoint_ns",
            "channel",
            "version",
            "type",
            "value"
          FROM "checkpoint_blobs"
          WHERE "thread_id" = ${sourceThreadId}
            AND "checkpoint_ns" = ${checkpointNs}
            AND (${checkpointBlobFilterSql})
            AND "channel" <> 'messages'
        `
      )
    }

    await Promise.all(postCreateOperations)

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

export async function setThreadArchived(threadId: string, archived: boolean): Promise<ThreadRow> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const row = await prisma.thread.update({
    data: {
      archivedAt: archived ? now : null,
      updatedAt: now
    },
    where: {
      threadId
    }
  })

  return mapThreadRow(row)
}

export async function updateThreadMetadata(
  threadId: string,
  metadata: Record<string, unknown>
): Promise<ThreadRow> {
  const prisma = getPrismaClient()
  const row = await prisma.thread.update({
    where: {
      threadId
    },
    data: {
      metadata: JSON.stringify(metadata)
    }
  })

  return mapThreadRow(row)
}

export async function deleteThread(threadId: string): Promise<void> {
  const prisma = getPrismaClient()

  await prisma.$transaction(async (tx) => {
    await Promise.all([
      tx.$executeRaw`DELETE FROM "messages_fts" WHERE thread_id = ${threadId}`,
      tx.$executeRaw`DELETE FROM "messages_fts_trigram" WHERE thread_id = ${threadId}`,
      tx.message.deleteMany({
        where: { threadId }
      }),
      tx.messageEvent.deleteMany({
        where: { threadId }
      }),
      tx.messageStateVersion.deleteMany({
        where: { threadId }
      }),
      tx.hitlRequest.deleteMany({
        where: { threadId }
      }),
      tx.checkpointWrite.deleteMany({
        where: { threadId }
      }),
      tx.checkpointBlob.deleteMany({
        where: { threadId }
      }),
      tx.checkpoint.deleteMany({
        where: { threadId }
      }),
      tx.sessionBinding.deleteMany({
        where: { currentThreadId: threadId }
      }),
      tx.run.deleteMany({
        where: { threadId }
      })
    ])
    await tx.thread.deleteMany({
      where: { threadId }
    })
  })
}
