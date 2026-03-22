import { mkdirSync } from "fs"
import { dirname } from "path"
import { getDbPath } from "../storage"
import { closePrismaClient, getPrismaClient } from "./client"

const REQUIRED_TABLES = [
  "_prisma_migrations",
  "threads",
  "runs",
  "messages",
  "assistants",
  "session_bindings",
  "hitl_requests",
  "checkpoints",
  "writes"
] as const

let initialized = false

export interface ThreadRow {
  thread_id: string
  created_at: number
  updated_at: number
  metadata: string | null
  status: string
  thread_values: string | null
  title: string | null
}

export interface RunRow {
  run_id: string
  thread_id: string
  assistant_id: string | null
  created_at: number
  updated_at: number
  status: string | null
  metadata: string | null
  kwargs: string | null
}

export interface MessageRow {
  message_id: string
  thread_id: string
  run_id: string | null
  seq: number
  role: string
  kind: string
  content: string
  tool_calls: string | null
  tool_call_id: string | null
  name: string | null
  metadata: string | null
  created_at: number
  updated_at: number
}

export interface HitlRequestRow {
  request_id: string
  thread_id: string
  run_id: string | null
  tool_call_id: string | null
  tool_name: string
  tool_args: string
  allowed_decisions: string
  status: string
  decision: string | null
  created_at: number
  updated_at: number
  resolved_at: number | null
}

export interface CreateRunInput {
  assistant_id?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | string | null
  kwargs?: Record<string, unknown> | string | null
}

export interface UpdateRunInput {
  status?: string | null
  metadata?: Record<string, unknown> | string | null
  kwargs?: Record<string, unknown> | string | null
}

export interface PersistedMessageInput {
  message_id: string
  thread_id: string
  run_id?: string | null
  seq: number
  role: string
  kind: string
  content: string
  tool_calls?: string | null
  tool_call_id?: string | null
  name?: string | null
  metadata?: string | null
  created_at: number
  updated_at: number
}

export interface UpsertHitlRequestInput {
  request_id: string
  thread_id: string
  run_id?: string | null
  tool_call_id?: string | null
  tool_name: string
  tool_args: Record<string, unknown> | string
  allowed_decisions: string[] | string
  status?: string
  decision?: Record<string, unknown> | string | null
  created_at?: number
  updated_at?: number
  resolved_at?: number | null
}

function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value
}

function serializeJsonValue(
  value: Record<string, unknown> | string | null | undefined
): string | null | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  return typeof value === "string" ? value : JSON.stringify(value)
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

function mapRunRow(row: {
  runId: string
  threadId: string
  assistantId: string | null
  createdAt: bigint
  updatedAt: bigint
  status: string | null
  metadata: string | null
  kwargs: string | null
}): RunRow {
  return {
    run_id: row.runId,
    thread_id: row.threadId,
    assistant_id: row.assistantId,
    created_at: toNumber(row.createdAt),
    updated_at: toNumber(row.updatedAt),
    status: row.status,
    metadata: row.metadata,
    kwargs: row.kwargs
  }
}

function mapMessageRow(row: {
  messageId: string
  threadId: string
  runId: string | null
  seq: number
  role: string
  kind: string
  content: string
  toolCalls: string | null
  toolCallId: string | null
  name: string | null
  metadata: string | null
  createdAt: bigint
  updatedAt: bigint
}): MessageRow {
  return {
    message_id: row.messageId,
    thread_id: row.threadId,
    run_id: row.runId,
    seq: row.seq,
    role: row.role,
    kind: row.kind,
    content: row.content,
    tool_calls: row.toolCalls,
    tool_call_id: row.toolCallId,
    name: row.name,
    metadata: row.metadata,
    created_at: toNumber(row.createdAt),
    updated_at: toNumber(row.updatedAt)
  }
}

function mapHitlRequestRow(row: {
  requestId: string
  threadId: string
  runId: string | null
  toolCallId: string | null
  toolName: string
  toolArgs: string
  allowedDecisions: string
  status: string
  decision: string | null
  createdAt: bigint
  updatedAt: bigint
  resolvedAt: bigint | null
}): HitlRequestRow {
  return {
    request_id: row.requestId,
    thread_id: row.threadId,
    run_id: row.runId,
    tool_call_id: row.toolCallId,
    tool_name: row.toolName,
    tool_args: row.toolArgs,
    allowed_decisions: row.allowedDecisions,
    status: row.status,
    decision: row.decision,
    created_at: toNumber(row.createdAt),
    updated_at: toNumber(row.updatedAt),
    resolved_at: row.resolvedAt === null ? null : toNumber(row.resolvedAt)
  }
}

async function ensurePrismaSchemaApplied(): Promise<void> {
  const prisma = getPrismaClient()
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type = 'table'`
  )) as Array<{ name: string }>
  const names = new Set(rows.map((row) => row.name))
  const missing = REQUIRED_TABLES.filter((name) => !names.has(name))

  if (missing.length === 0) {
    return
  }

  throw new Error(
    `Database schema is not initialized for ${getDbPath()}. Missing tables: ${missing.join(", ")}. Run \`pnpm prisma:migrate:deploy\` before starting the app.`
  )
}

export async function initializeDatabase(): Promise<void> {
  if (initialized) {
    return
  }

  const filePath = getDbPath()
  mkdirSync(dirname(filePath), { recursive: true })

  const prisma = getPrismaClient()
  await prisma.$connect()
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON")
  await ensurePrismaSchemaApplied()

  initialized = true
}

export async function closeDatabase(): Promise<void> {
  initialized = false
  await closePrismaClient()
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

export async function createThread(
  threadId: string,
  metadata?: Record<string, unknown>
): Promise<ThreadRow> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())

  const row = await prisma.thread.create({
    data: {
      threadId,
      createdAt: now,
      updatedAt: now,
      metadata: metadata ? JSON.stringify(metadata) : null,
      status: "idle"
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

  await prisma.$transaction([
    prisma.hitlRequest.deleteMany({
      where: { threadId }
    }),
    prisma.message.deleteMany({
      where: { threadId }
    }),
    prisma.checkpointWrite.deleteMany({
      where: { threadId }
    }),
    prisma.checkpoint.deleteMany({
      where: { threadId }
    }),
    prisma.sessionBinding.deleteMany({
      where: { currentThreadId: threadId }
    }),
    prisma.run.deleteMany({
      where: { threadId }
    }),
    prisma.thread.deleteMany({
      where: { threadId }
    })
  ])
}

export async function createRun(
  runId: string,
  threadId: string,
  input: CreateRunInput = {}
): Promise<RunRow> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())

  const row = await prisma.run.create({
    data: {
      runId,
      threadId,
      assistantId: input.assistant_id ?? null,
      createdAt: now,
      updatedAt: now,
      status: input.status ?? "running",
      metadata: serializeJsonValue(input.metadata) ?? null,
      kwargs: serializeJsonValue(input.kwargs) ?? null
    }
  })

  return mapRunRow(row)
}

export async function updateRun(runId: string, updates: UpdateRunInput): Promise<RunRow | null> {
  const prisma = getPrismaClient()
  const existing = await prisma.run.findUnique({
    where: {
      runId
    }
  })

  if (!existing) {
    return null
  }

  const row = await prisma.run.update({
    where: {
      runId
    },
    data: {
      updatedAt: BigInt(Date.now()),
      status: updates.status,
      metadata: serializeJsonValue(updates.metadata),
      kwargs: serializeJsonValue(updates.kwargs)
    }
  })

  return mapRunRow(row)
}

export async function getLatestRun(threadId: string, statuses?: string[]): Promise<RunRow | null> {
  const prisma = getPrismaClient()
  const row = await prisma.run.findFirst({
    where: {
      threadId,
      status: statuses ? { in: statuses } : undefined
    },
    orderBy: {
      updatedAt: "desc"
    }
  })

  return row ? mapRunRow(row) : null
}

export async function listMessages(threadId: string): Promise<MessageRow[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.message.findMany({
    where: {
      threadId
    },
    orderBy: [{ seq: "asc" }, { createdAt: "asc" }]
  })

  return rows.map(mapMessageRow)
}

export async function createMessage(
  input: Omit<PersistedMessageInput, "seq" | "updated_at"> & { seq?: number; updated_at?: number }
): Promise<MessageRow> {
  const prisma = getPrismaClient()
  const now = input.updated_at ?? input.created_at

  const row = await prisma.$transaction(async (tx) => {
    const maxSeqRow = await tx.message.aggregate({
      where: {
        threadId: input.thread_id
      },
      _max: {
        seq: true
      }
    })
    const nextSeq = input.seq ?? (maxSeqRow._max.seq ?? -1) + 1

    const created = await tx.message.create({
      data: {
        messageId: input.message_id,
        threadId: input.thread_id,
        runId: input.run_id ?? null,
        seq: nextSeq,
        role: input.role,
        kind: input.kind,
        content: input.content,
        toolCalls: input.tool_calls ?? null,
        toolCallId: input.tool_call_id ?? null,
        name: input.name ?? null,
        metadata: input.metadata ?? null,
        createdAt: BigInt(input.created_at),
        updatedAt: BigInt(now)
      }
    })

    await tx.thread.update({
      where: {
        threadId: input.thread_id
      },
      data: {
        updatedAt: BigInt(now)
      }
    })

    return created
  })

  return mapMessageRow(row)
}

export async function syncMessagesFromSnapshot(
  threadId: string,
  currentRunId: string | null,
  messages: Array<
    Omit<PersistedMessageInput, "thread_id" | "run_id" | "seq" | "updated_at"> & {
      seq?: number
    }
  >
): Promise<void> {
  const prisma = getPrismaClient()
  const existing = await listMessages(threadId)

  const normalizedIncoming = messages.map((message, index) => ({
    message_id: message.message_id,
    thread_id: threadId,
    run_id: null,
    seq: index,
    role: message.role,
    kind: message.kind,
    content: message.content,
    tool_calls: message.tool_calls ?? null,
    tool_call_id: message.tool_call_id ?? null,
    name: message.name ?? null,
    metadata: message.metadata ?? null,
    created_at: message.created_at,
    updated_at: message.created_at
  }))

  const makeFingerprint = (
    message: Pick<MessageRow, "role" | "kind" | "content" | "tool_calls" | "tool_call_id" | "name">
  ): string =>
    JSON.stringify([
      message.role,
      message.kind,
      message.content,
      message.tool_calls ?? null,
      message.tool_call_id ?? null,
      message.name ?? null
    ])

  const isExistingPrefix = existing.every((message, index) => {
    const incoming = normalizedIncoming[index]
    if (!incoming) {
      return false
    }

    return makeFingerprint(message) === makeFingerprint(incoming)
  })

  const lastUserIndex = normalizedIncoming.reduce((found, message, index) => {
    return message.role === "user" ? index : found
  }, -1)

  await prisma.$transaction(async (tx) => {
    if (existing.length > 0 && isExistingPrefix && normalizedIncoming.length >= existing.length) {
      const appended = normalizedIncoming.slice(existing.length).map((message) => ({
        messageId: message.message_id,
        threadId,
        runId: currentRunId,
        seq: message.seq,
        role: message.role,
        kind: message.kind,
        content: message.content,
        toolCalls: message.tool_calls,
        toolCallId: message.tool_call_id,
        name: message.name,
        metadata: message.metadata,
        createdAt: BigInt(message.created_at),
        updatedAt: BigInt(message.updated_at)
      }))

      if (appended.length > 0) {
        await tx.message.createMany({
          data: appended
        })

        const lastTimestamp = appended[appended.length - 1]?.updatedAt
        if (lastTimestamp) {
          await tx.thread.update({
            where: {
              threadId
            },
            data: {
              updatedAt: lastTimestamp
            }
          })
        }
      }

      return
    }

    await tx.message.deleteMany({
      where: {
        threadId
      }
    })

    if (normalizedIncoming.length === 0) {
      return
    }

    await tx.message.createMany({
      data: normalizedIncoming.map((message) => ({
        messageId: message.message_id,
        threadId,
        runId: currentRunId && message.seq >= lastUserIndex ? currentRunId : null,
        seq: message.seq,
        role: message.role,
        kind: message.kind,
        content: message.content,
        toolCalls: message.tool_calls,
        toolCallId: message.tool_call_id,
        name: message.name,
        metadata: message.metadata,
        createdAt: BigInt(message.created_at),
        updatedAt: BigInt(message.updated_at)
      }))
    })

    await tx.thread.update({
      where: {
        threadId
      },
      data: {
        updatedAt: BigInt(normalizedIncoming[normalizedIncoming.length - 1].updated_at)
      }
    })
  })
}

export async function upsertHitlRequest(input: UpsertHitlRequestInput): Promise<HitlRequestRow> {
  const prisma = getPrismaClient()
  const now = BigInt(input.updated_at ?? input.created_at ?? Date.now())
  const createdAt = BigInt(input.created_at ?? Number(now))
  const resolvedAt =
    input.resolved_at === undefined
      ? undefined
      : input.resolved_at === null
        ? null
        : BigInt(input.resolved_at)

  const row = await prisma.hitlRequest.upsert({
    where: {
      requestId: input.request_id
    },
    create: {
      requestId: input.request_id,
      threadId: input.thread_id,
      runId: input.run_id ?? null,
      toolCallId: input.tool_call_id ?? null,
      toolName: input.tool_name,
      toolArgs:
        typeof input.tool_args === "string" ? input.tool_args : JSON.stringify(input.tool_args),
      allowedDecisions:
        typeof input.allowed_decisions === "string"
          ? input.allowed_decisions
          : JSON.stringify(input.allowed_decisions),
      status: input.status ?? "pending",
      decision: serializeJsonValue(input.decision) ?? null,
      createdAt,
      updatedAt: now,
      resolvedAt: resolvedAt ?? null
    },
    update: {
      runId: input.run_id ?? undefined,
      toolCallId: input.tool_call_id ?? undefined,
      toolName: input.tool_name,
      toolArgs:
        typeof input.tool_args === "string" ? input.tool_args : JSON.stringify(input.tool_args),
      allowedDecisions:
        typeof input.allowed_decisions === "string"
          ? input.allowed_decisions
          : JSON.stringify(input.allowed_decisions),
      status: input.status ?? "pending",
      decision:
        input.decision === undefined ? undefined : (serializeJsonValue(input.decision) ?? null),
      updatedAt: now,
      resolvedAt
    }
  })

  return mapHitlRequestRow(row)
}

export async function getLatestHitlRequest(threadId: string): Promise<HitlRequestRow | null> {
  const prisma = getPrismaClient()
  const row = await prisma.hitlRequest.findFirst({
    where: {
      threadId
    },
    orderBy: {
      updatedAt: "desc"
    }
  })

  return row ? mapHitlRequestRow(row) : null
}

export async function resolvePendingHitlRequests(
  threadId: string,
  status: string,
  decision?: Record<string, unknown> | string | null
): Promise<number> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const result = await prisma.hitlRequest.updateMany({
    where: {
      threadId,
      status: "pending"
    },
    data: {
      status,
      decision: decision === undefined ? undefined : (serializeJsonValue(decision) ?? null),
      updatedAt: now,
      resolvedAt: now
    }
  })

  return result.count
}
