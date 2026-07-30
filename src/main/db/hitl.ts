import type { HitlRequest } from "@prisma/client"
import { isHitlDecisionType, type HITLDecisionType } from "@shared/hitl"
import { getPrismaClient } from "./client"
import { serializeJsonValue, toNumber } from "./utils"
import { isDurableTerminalRunFinishedPayload } from "../agent/run-lifecycle-facts"

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
  status: HitlRequestStatus
  decision: string | null
  created_at: number
  updated_at: number
  resolved_at: number | null
}

export type HitlRequestStatus = "pending" | HitlRequestTerminalStatus
export type HitlRequestTerminalStatus = "approved" | "cancelled" | "user_declined" | "corrected"

export interface UpsertHitlRequestInput {
  request_id: string
  thread_id: string
  run_id?: string | null
  tool_call_id: string
  tool_name: string
  tool_args: Record<string, unknown> | string
  review_kind?: string | null
  review_payload?: unknown
  allowed_decisions: string[] | string
  status?: "pending"
  created_at?: number
  updated_at?: number
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
    status: row.status as HitlRequestStatus,
    decision: row.decision,
    created_at: toNumber(row.createdAt),
    updated_at: toNumber(row.updatedAt),
    resolved_at: row.resolvedAt === null ? null : toNumber(row.resolvedAt)
  }
}

export function parsePersistedHitlAllowedDecisions(
  requestId: string,
  value: string
): HITLDecisionType[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch (error) {
    throw new Error(`[HITL] Request "${requestId}" has invalid allowed_decisions JSON.`, {
      cause: error
    })
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isHitlDecisionType)) {
    throw new Error(`[HITL] Request "${requestId}" has invalid allowed_decisions.`)
  }

  return parsed
}

export async function upsertHitlRequest(input: UpsertHitlRequestInput): Promise<HitlRequestRow> {
  const prisma = getPrismaClient()
  const now = BigInt(input.updated_at ?? input.created_at ?? Date.now())
  const createdAt = BigInt(input.created_at ?? Number(now))
  const toolArgs =
    typeof input.tool_args === "string" ? input.tool_args : JSON.stringify(input.tool_args)
  const allowedDecisions =
    typeof input.allowed_decisions === "string"
      ? input.allowed_decisions
      : JSON.stringify(input.allowed_decisions)

  const { row, staleReplay } = await prisma.$transaction(async (tx) => {
    const current = await tx.hitlRequest.upsert({
      where: {
        requestId: input.request_id
      },
      create: {
        requestId: input.request_id,
        threadId: input.thread_id,
        runId: input.run_id ?? null,
        toolCallId: input.tool_call_id,
        toolName: input.tool_name,
        toolArgs,
        reviewKind: input.review_kind ?? null,
        reviewPayload: serializeJsonValue(input.review_payload) ?? null,
        allowedDecisions,
        status: "pending",
        decision: null,
        createdAt,
        updatedAt: now,
        resolvedAt: null
      },
      update: {}
    })

    if (current.status !== "pending") {
      return { row: current, staleReplay: true }
    }

    await tx.hitlRequest.updateMany({
      where: {
        requestId: input.request_id,
        status: "pending"
      },
      data: {
        runId: input.run_id ?? undefined,
        toolCallId: input.tool_call_id,
        toolName: input.tool_name,
        toolArgs,
        reviewKind: input.review_kind === undefined ? undefined : input.review_kind,
        reviewPayload:
          input.review_payload === undefined
            ? undefined
            : (serializeJsonValue(input.review_payload) ?? null),
        allowedDecisions,
        decision: null,
        updatedAt: now,
        resolvedAt: null
      }
    })

    const refreshed = await tx.hitlRequest.findUniqueOrThrow({
      where: {
        requestId: input.request_id
      }
    })
    if (refreshed.runId !== null) {
      const [run, finishedEvents] = await Promise.all([
        tx.run.findUnique({
          select: { status: true },
          where: { runId: refreshed.runId }
        }),
        tx.agentEvent.findMany({
          select: { payload: true },
          where: { runId: refreshed.runId, type: "run.finished" }
        })
      ])
      if (
        run?.status === "cancelled" ||
        run?.status === "error" ||
        run?.status === "success" ||
        finishedEvents.some((event) => isDurableTerminalRunFinishedPayload(event.payload))
      ) {
        throw new Error(
          `[HITL] Cannot persist pending request "${input.request_id}" for terminal run "${refreshed.runId}".`
        )
      }
    }
    return { row: refreshed, staleReplay: refreshed.status !== "pending" }
  })

  if (staleReplay) {
    console.warn("[HITL] Ignored stale pending request replay.", {
      requestId: input.request_id,
      runId: input.run_id ?? null,
      status: row.status,
      threadId: input.thread_id
    })
  }

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

export async function getLatestPendingHitlRequest(
  threadId: string
): Promise<HitlRequestRow | null> {
  const row = await findLatestActionablePendingHitlRequest({ threadId })
  return row ? mapHitlRequestRow(row) : null
}

export async function hasPendingHitlRequest(threadId: string): Promise<boolean> {
  return (await findLatestActionablePendingHitlRequest({ threadId })) !== null
}

export async function hasPendingHitlRequestForRun(
  threadId: string,
  runId: string
): Promise<boolean> {
  return (await findLatestActionablePendingHitlRequest({ runId, threadId })) !== null
}

async function findLatestActionablePendingHitlRequest(input: {
  runId?: string
  threadId: string
}): Promise<HitlRequest | null> {
  const prisma = getPrismaClient()
  let cursorRequestId: string | undefined
  while (true) {
    const row = await prisma.hitlRequest.findFirst({
      ...(cursorRequestId
        ? {
            cursor: { requestId: cursorRequestId },
            skip: 1
          }
        : {}),
      where: {
        ...(input.runId ? { runId: input.runId } : {}),
        threadId: input.threadId,
        status: "pending"
      },
      orderBy: [{ updatedAt: "desc" }, { requestId: "desc" }]
    })
    if (!row || row.runId === null) return row

    const [run, finishedEvents] = await Promise.all([
      prisma.run.findUnique({
        select: { status: true },
        where: { runId: row.runId }
      }),
      prisma.agentEvent.findMany({
        select: { payload: true },
        where: { runId: row.runId, type: "run.finished" }
      })
    ])
    if (
      run?.status !== "cancelled" &&
      run?.status !== "error" &&
      run?.status !== "success" &&
      !finishedEvents.some((event) => isDurableTerminalRunFinishedPayload(event.payload))
    ) {
      return row
    }
    cursorRequestId = row.requestId
  }
}

export async function getHitlRequest(requestId: string): Promise<HitlRequestRow | null> {
  const prisma = getPrismaClient()
  const row = await prisma.hitlRequest.findUnique({
    where: {
      requestId
    }
  })

  return row ? mapHitlRequestRow(row) : null
}

export async function resolveHitlRequest(
  requestId: string,
  status: HitlRequestTerminalStatus,
  decision: Record<string, unknown> | string
): Promise<HitlRequestRow | null> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const result = await prisma.hitlRequest.updateMany({
    where: { requestId, status: "pending" },
    data: {
      status,
      decision: serializeJsonValue(decision),
      updatedAt: now,
      resolvedAt: now
    }
  })
  if (result.count === 0) return null

  const row = await prisma.hitlRequest.findUniqueOrThrow({ where: { requestId } })

  return mapHitlRequestRow(row)
}

export async function resolvePendingHitlRequests(
  threadId: string,
  status: HitlRequestTerminalStatus,
  decision: Record<string, unknown> | string
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
      decision: serializeJsonValue(decision),
      updatedAt: now,
      resolvedAt: now
    }
  })

  return result.count
}
