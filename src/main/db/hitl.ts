import type { HitlRequest } from "@prisma/client"
import { getPrismaClient } from "./client"
import { serializeJsonValue, toNumber } from "./utils"

export interface HitlRequestRow {
  request_id: string
  thread_id: string
  run_id: string | null
  tool_call_id: string | null
  tool_name: string
  tool_args: string
  review_kind: string | null
  review_payload: string | null
  allowed_decisions: string
  status: string
  decision: string | null
  created_at: number
  updated_at: number
  resolved_at: number | null
}

export interface UpsertHitlRequestInput {
  request_id: string
  thread_id: string
  run_id?: string | null
  tool_call_id?: string | null
  tool_name: string
  tool_args: Record<string, unknown> | string
  review_kind?: string | null
  review_payload?: unknown
  allowed_decisions: string[] | string
  status?: string
  decision?: Record<string, unknown> | string | null
  created_at?: number
  updated_at?: number
  resolved_at?: number | null
}

function mapHitlRequestRow(row: HitlRequest): HitlRequestRow {
  return {
    request_id: row.requestId,
    thread_id: row.threadId,
    run_id: row.runId,
    tool_call_id: row.toolCallId,
    tool_name: row.toolName,
    tool_args: row.toolArgs,
    review_kind: row.reviewKind,
    review_payload: row.reviewPayload,
    allowed_decisions: row.allowedDecisions,
    status: row.status,
    decision: row.decision,
    created_at: toNumber(row.createdAt),
    updated_at: toNumber(row.updatedAt),
    resolved_at: row.resolvedAt === null ? null : toNumber(row.resolvedAt)
  }
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
      reviewKind: input.review_kind ?? null,
      reviewPayload: serializeJsonValue(input.review_payload) ?? null,
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
      reviewKind: input.review_kind === undefined ? undefined : input.review_kind,
      reviewPayload:
        input.review_payload === undefined
          ? undefined
          : (serializeJsonValue(input.review_payload) ?? null),
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
