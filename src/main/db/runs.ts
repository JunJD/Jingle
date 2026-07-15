import { getPrismaClient } from "./client"
import { serializeJsonValue, toNumber } from "./utils"

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

export function mapRunRow(row: {
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

export async function getRun(runId: string): Promise<RunRow | null> {
  const prisma = getPrismaClient()
  const row = await prisma.run.findUnique({
    where: {
      runId
    }
  })

  return row ? mapRunRow(row) : null
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
