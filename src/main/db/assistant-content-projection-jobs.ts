import { Prisma } from "@prisma/client"
import {
  ASSISTANT_CONTENT_PROJECTION_MAX_ATTEMPTS,
  assistantContentProjectionFailureCause,
  assistantContentProjectionSourceRevision,
  classifyAssistantContentProjectionFailure,
  isAssistantContentProjectionDecodeError,
  isAssistantContentProjectionInputError,
  summarizeAssistantContentProjectionError,
  type AssistantContentProjectionBlockedInput,
  type ProjectionFailure
} from "../content-cards/projection-error"
import { ASSISTANT_CONTENT_PROJECTION_TERMINAL_RUN_STATUSES } from "../content-cards/projection-status"
import {
  assistantContentRevision,
  readAssistantContentPartsProjection
} from "./assistant-content-parts"
import { getPrismaClient } from "./client"

export interface AssistantContentProjectionClaim {
  attemptCount: number
  generation: number
  runId: string
  threadId: string
}

export interface AssistantContentProjectionRecoveryOptions {
  onBatch: (runIds: readonly string[]) => Promise<void> | void
  onDeferred?: (nextAttemptAt: bigint) => Promise<void> | void
  signal?: AbortSignal
}

export interface AssistantContentProjectionFailureSettlement {
  failure: ProjectionFailure
  nextAttemptAt: bigint | null
  status: "exhausted" | "failed" | "parked"
}

export const ASSISTANT_CONTENT_PROJECTION_RECOVERY_BATCH_SIZE = 100
export const ASSISTANT_CONTENT_PROJECTION_BASE_RETRY_DELAY_MS = 1_000
export const ASSISTANT_CONTENT_PROJECTION_MAX_RETRY_DELAY_MS = 30_000

function now(): bigint {
  return BigInt(Date.now())
}

const terminalRunStatuses = Prisma.join(ASSISTANT_CONTENT_PROJECTION_TERMINAL_RUN_STATUSES)

export function assistantContentProjectionRetryDelayMs(attemptCount: number): number {
  return Math.min(
    ASSISTANT_CONTENT_PROJECTION_MAX_RETRY_DELAY_MS,
    ASSISTANT_CONTENT_PROJECTION_BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attemptCount - 1)
  )
}

export async function markAssistantContentProjectionDirty(runId: string): Promise<boolean> {
  const timestamp = now()
  const changed = await getPrismaClient().$executeRaw`
    INSERT INTO "assistant_content_projection_jobs" (
      "run_id", "generation", "status", "attempt_count", "failure_code", "last_error",
      "next_attempt_at", "created_at", "updated_at"
    )
    SELECT "run_id", 1, 'pending', 0, NULL, NULL, NULL, ${timestamp}, ${timestamp}
    FROM "runs"
    WHERE "run_id" = ${runId}
      AND "status" IN (${terminalRunStatuses})
      AND EXISTS (
        SELECT 1 FROM "messages"
        WHERE "messages"."run_id" = "runs"."run_id"
          AND "messages"."role" = 'assistant'
      )
    ON CONFLICT("run_id") DO UPDATE SET
      "generation" = CASE
        WHEN "assistant_content_projection_jobs"."status" = 'running'
        THEN "assistant_content_projection_jobs"."generation" + 1
        ELSE "assistant_content_projection_jobs"."generation"
      END,
      "status" = CASE
        WHEN "assistant_content_projection_jobs"."status" IN ('failed', 'exhausted', 'parked', 'blocked')
        THEN "assistant_content_projection_jobs"."status"
        ELSE 'pending'
      END,
      "failure_code" = CASE
        WHEN "assistant_content_projection_jobs"."status" IN ('failed', 'exhausted', 'parked', 'blocked')
        THEN "assistant_content_projection_jobs"."failure_code"
        ELSE NULL
      END,
      "last_error" = CASE
        WHEN "assistant_content_projection_jobs"."status" IN ('failed', 'exhausted', 'parked', 'blocked')
        THEN "assistant_content_projection_jobs"."last_error"
        ELSE NULL
      END,
      "next_attempt_at" = CASE
        WHEN "assistant_content_projection_jobs"."status" = 'failed'
        THEN "assistant_content_projection_jobs"."next_attempt_at"
        ELSE NULL
      END,
      "updated_at" = ${timestamp}
  `
  if (changed !== 1) return false
  const job = await getPrismaClient().assistantContentProjectionJob.findUnique({
    select: { nextAttemptAt: true, status: true },
    where: { runId }
  })
  return Boolean(
    job &&
    (job.status === "pending" ||
      job.status === "running" ||
      (job.status === "failed" && job.nextAttemptAt !== null && job.nextAttemptAt <= timestamp))
  )
}

export async function ensureAssistantContentProjectionPending(
  runId: string,
  options: {
    allowBlockedRetry: boolean
    blockedSource?: { messageId: string; sourceRevision: string }
  }
): Promise<boolean> {
  const timestamp = now()
  const changed = await getPrismaClient().$executeRaw`
    INSERT INTO "assistant_content_projection_jobs" (
      "run_id", "generation", "status", "attempt_count", "failure_code", "last_error",
      "next_attempt_at", "created_at", "updated_at"
    )
    SELECT "run_id", 1, 'pending', 0, NULL, NULL, NULL, ${timestamp}, ${timestamp}
    FROM "runs"
    WHERE "run_id" = ${runId}
      AND "status" IN (${terminalRunStatuses})
      AND EXISTS (
        SELECT 1 FROM "messages"
        WHERE "messages"."run_id" = "runs"."run_id"
          AND "messages"."role" = 'assistant'
      )
    ON CONFLICT("run_id") DO NOTHING
  `
  if (changed === 1) return true
  const refreshed = await getPrismaClient().$executeRaw`
    UPDATE "assistant_content_projection_jobs"
    SET
      "generation" = CASE
        WHEN "status" = 'running' THEN "generation" + 1
        ELSE "generation"
      END,
      "status" = 'pending',
      "failure_code" = NULL,
      "last_error" = NULL,
      "next_attempt_at" = NULL,
      "updated_at" = ${timestamp}
    WHERE "run_id" = ${runId}
      AND "status" IN ('completed', 'running')
  `
  if (refreshed === 1) return true
  if (options.allowBlockedRetry) {
    const unblocked = await getPrismaClient().assistantContentProjectionJob.updateMany({
      data: {
        failureCode: null,
        lastError: null,
        nextAttemptAt: null,
        status: "pending",
        updatedAt: timestamp
      },
      where: { runId, status: "blocked" }
    })
    if (unblocked.count === 1) return true
  } else if (options.blockedSource) {
    const unblocked = await getPrismaClient().$executeRaw`
      UPDATE "assistant_content_projection_jobs"
      SET "status" = 'pending', "failure_code" = NULL, "last_error" = NULL,
          "next_attempt_at" = NULL, "updated_at" = ${timestamp}
      WHERE "run_id" = ${runId}
        AND "status" = 'blocked'
        AND NOT EXISTS (
          SELECT 1 FROM "assistant_content_projection_blocked_inputs"
          WHERE "assistant_content_projection_blocked_inputs"."run_id" = ${runId}
            AND "assistant_content_projection_blocked_inputs"."message_id" = ${options.blockedSource.messageId}
            AND "assistant_content_projection_blocked_inputs"."source_revision" = ${options.blockedSource.sourceRevision}
        )
    `
    if (unblocked === 1) return true
  }
  const existing = await getPrismaClient().assistantContentProjectionJob.findUnique({
    include: { run: { select: { status: true } } },
    where: { runId }
  })
  return Boolean(
    existing &&
    (existing.status === "pending" ||
      existing.status === "running" ||
      (existing.status === "failed" &&
        existing.nextAttemptAt !== null &&
        existing.nextAttemptAt <= timestamp)) &&
    ASSISTANT_CONTENT_PROJECTION_TERMINAL_RUN_STATUSES.some(
      (status) => status === existing.run.status
    )
  )
}

export async function claimAssistantContentProjection(
  runId: string
): Promise<AssistantContentProjectionClaim | null> {
  return getPrismaClient().$transaction(async (transaction) => {
    const timestamp = now()
    const job = await transaction.assistantContentProjectionJob.findUnique({
      include: { run: { select: { status: true, threadId: true } } },
      where: { runId }
    })
    if (
      !job ||
      !ASSISTANT_CONTENT_PROJECTION_TERMINAL_RUN_STATUSES.some(
        (status) => status === job.run.status
      )
    ) {
      return null
    }
    const claimed = await transaction.assistantContentProjectionJob.updateMany({
      data: {
        attemptCount: { increment: 1 },
        failureCode: null,
        lastError: null,
        nextAttemptAt: null,
        status: "running",
        updatedAt: timestamp
      },
      where: {
        generation: job.generation,
        OR: [{ status: "pending" }, { nextAttemptAt: { lte: timestamp }, status: "failed" }],
        runId
      }
    })
    if (claimed.count !== 1) return null
    return {
      attemptCount: job.attemptCount + 1,
      generation: job.generation,
      runId,
      threadId: job.run.threadId
    }
  })
}

export async function completeAssistantContentProjection(
  claim: AssistantContentProjectionClaim
): Promise<boolean> {
  return getPrismaClient().$transaction(async (transaction) => {
    const result = await transaction.assistantContentProjectionJob.updateMany({
      data: {
        failureCode: null,
        lastError: null,
        nextAttemptAt: null,
        status: "completed",
        updatedAt: now()
      },
      where: { generation: claim.generation, runId: claim.runId, status: "running" }
    })
    if (result.count !== 1) return false
    await transaction.assistantContentProjectionBlockedInput.deleteMany({
      where: { runId: claim.runId }
    })
    return true
  })
}

export async function failAssistantContentProjection(
  claim: AssistantContentProjectionClaim,
  error: unknown
): Promise<AssistantContentProjectionFailureSettlement | null> {
  const failure = classifyAssistantContentProjectionFailure(error)
  const timestamp = now()
  const status =
    failure.kind === "terminal"
      ? "parked"
      : claim.attemptCount >= ASSISTANT_CONTENT_PROJECTION_MAX_ATTEMPTS
        ? "exhausted"
        : "failed"
  const nextAttemptAt =
    status === "failed"
      ? timestamp + BigInt(assistantContentProjectionRetryDelayMs(claim.attemptCount))
      : null
  const message = summarizeAssistantContentProjectionError(
    assistantContentProjectionFailureCause(error)
  )
  const result = await getPrismaClient().assistantContentProjectionJob.updateMany({
    data: {
      failureCode: failure.code,
      lastError: message,
      nextAttemptAt,
      status,
      updatedAt: timestamp
    },
    where: { generation: claim.generation, runId: claim.runId, status: "running" }
  })
  return result.count === 1 ? { failure, nextAttemptAt, status } : null
}

export async function blockAssistantContentProjection(
  claim: AssistantContentProjectionClaim,
  inputs: readonly (AssistantContentProjectionBlockedInput & { error: unknown })[]
): Promise<boolean> {
  const first = inputs[0]
  if (!first) throw new Error("Assistant content projection cannot block without an input error.")
  const message = summarizeAssistantContentProjectionError(first.error)
  const timestamp = now()
  return getPrismaClient().$transaction(async (transaction) => {
    const result = await transaction.assistantContentProjectionJob.updateMany({
      data: {
        failureCode: null,
        lastError: message,
        nextAttemptAt: null,
        status: "blocked",
        updatedAt: timestamp
      },
      where: { generation: claim.generation, runId: claim.runId, status: "running" }
    })
    if (result.count !== 1) return false
    await transaction.assistantContentProjectionBlockedInput.deleteMany({
      where: { runId: claim.runId }
    })
    await transaction.assistantContentProjectionBlockedInput.createMany({
      data: inputs.map((input) => ({
        messageId: input.messageId,
        reason: input.reason,
        runId: claim.runId,
        sourceRevision: input.sourceRevision
      }))
    })
    return true
  })
}

export async function resumeAssistantContentProjectionForRepairedMessage(
  runId: string,
  messageId: string
): Promise<boolean> {
  const timestamp = now()
  const changed = await getPrismaClient().$executeRaw`
    UPDATE "assistant_content_projection_jobs"
    SET "status" = 'pending', "failure_code" = NULL, "last_error" = NULL,
        "next_attempt_at" = NULL, "updated_at" = ${timestamp}
    WHERE "run_id" = ${runId}
      AND "status" = 'blocked'
      AND EXISTS (
        SELECT 1 FROM "assistant_content_projection_blocked_inputs"
        WHERE "assistant_content_projection_blocked_inputs"."run_id" = ${runId}
          AND "assistant_content_projection_blocked_inputs"."message_id" = ${messageId}
      )
  `
  return changed === 1
}

async function insertMissingAssistantContentProjectionJobs(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return
  const timestamp = now()
  await getPrismaClient().$executeRaw`
    INSERT INTO "assistant_content_projection_jobs" (
      "run_id", "generation", "status", "attempt_count", "failure_code", "last_error",
      "next_attempt_at", "created_at", "updated_at"
    )
    SELECT "runs"."run_id", 1, 'pending', 0, NULL, NULL, NULL, ${timestamp}, ${timestamp}
    FROM "runs"
    LEFT JOIN "assistant_content_projection_jobs"
      ON "assistant_content_projection_jobs"."run_id" = "runs"."run_id"
    WHERE "assistant_content_projection_jobs"."run_id" IS NULL
      AND "runs"."status" IN (${terminalRunStatuses})
      AND EXISTS (
        SELECT 1 FROM "messages"
        WHERE "messages"."run_id" = "runs"."run_id"
          AND "messages"."role" = 'assistant'
      )
    ON CONFLICT("run_id") DO NOTHING
  `
}

async function blockedRunNeedsProjection(
  runId: string,
  signal?: AbortSignal
): Promise<boolean | null> {
  const prisma = getPrismaClient()
  let cursorMessageId = ""
  let matchedBlockedInputCount = 0
  while (true) {
    if (signal?.aborted) return null
    const messages = await prisma.$queryRaw<
      Array<{
        blockedSourceRevision: string | null
        content: string
        contentRevision: string | null
        messageId: string
        threadId: string
      }>
    >`
      SELECT
        "assistant_content_projection_blocked_inputs"."source_revision" AS "blockedSourceRevision",
        "messages"."content" AS "content",
        "assistant_content_projections"."content_revision" AS "contentRevision",
        "messages"."message_id" AS "messageId",
        "messages"."thread_id" AS "threadId"
      FROM "messages"
      LEFT JOIN "assistant_content_projection_blocked_inputs"
        ON "assistant_content_projection_blocked_inputs"."run_id" = ${runId}
        AND "assistant_content_projection_blocked_inputs"."message_id" = "messages"."message_id"
      LEFT JOIN "assistant_content_projections"
        ON "assistant_content_projections"."thread_id" = "messages"."thread_id"
        AND "assistant_content_projections"."message_id" = "messages"."message_id"
      WHERE "messages"."run_id" = ${runId}
        AND "messages"."role" = 'assistant'
        AND "messages"."message_id" > ${cursorMessageId}
      ORDER BY "messages"."message_id" ASC
      LIMIT ${ASSISTANT_CONTENT_PROJECTION_RECOVERY_BATCH_SIZE}
    `
    if (messages.length === 0) {
      const blockedInputCount = await prisma.assistantContentProjectionBlockedInput.count({
        where: { runId }
      })
      return blockedInputCount === 0 || blockedInputCount !== matchedBlockedInputCount
    }
    for (const message of messages) {
      if (message.blockedSourceRevision) {
        matchedBlockedInputCount += 1
        if (
          assistantContentProjectionSourceRevision(message.content) !==
          message.blockedSourceRevision
        ) {
          return true
        }
        continue
      }
      try {
        const revision = assistantContentRevision(message.content)
        if (message.contentRevision !== revision) return true
        try {
          await readAssistantContentPartsProjection({
            messageId: message.messageId,
            threadId: message.threadId
          })
        } catch (error) {
          if (!isAssistantContentProjectionDecodeError(error)) throw error
          return true
        }
      } catch (error) {
        if (!isAssistantContentProjectionInputError(error)) throw error
        return true
      }
    }
    cursorMessageId = messages.at(-1)!.messageId
  }
}

async function recoverChangedBlockedAssistantContentProjectionJobs(
  signal?: AbortSignal
): Promise<void> {
  const prisma = getPrismaClient()
  let cursorRunId = ""
  while (true) {
    if (signal?.aborted) return
    const jobs = await prisma.assistantContentProjectionJob.findMany({
      orderBy: { runId: "asc" },
      select: { runId: true },
      take: ASSISTANT_CONTENT_PROJECTION_RECOVERY_BATCH_SIZE,
      where: { runId: { gt: cursorRunId }, status: "blocked" }
    })
    if (jobs.length === 0) return
    for (const job of jobs) {
      if (signal?.aborted) return
      const needsProjection = await blockedRunNeedsProjection(job.runId, signal)
      if (needsProjection === null) return
      if (needsProjection) {
        await prisma.assistantContentProjectionJob.updateMany({
          data: {
            failureCode: null,
            lastError: null,
            nextAttemptAt: null,
            status: "pending",
            updatedAt: now()
          },
          where: { runId: job.runId, status: "blocked" }
        })
      }
    }
    cursorRunId = jobs.at(-1)!.runId
  }
}

async function dispatchAssistantContentProjectionJobs(
  options: AssistantContentProjectionRecoveryOptions
): Promise<void> {
  const prisma = getPrismaClient()
  let cursorRunId = ""
  while (true) {
    if (options.signal?.aborted) return
    const timestamp = now()
    const jobs = await prisma.assistantContentProjectionJob.findMany({
      orderBy: { runId: "asc" },
      select: { runId: true },
      take: ASSISTANT_CONTENT_PROJECTION_RECOVERY_BATCH_SIZE,
      where: {
        runId: { gt: cursorRunId },
        OR: [{ status: "pending" }, { nextAttemptAt: { lte: timestamp }, status: "failed" }]
      }
    })
    if (jobs.length === 0) break
    await options.onBatch(jobs.map((job) => job.runId))
    if (options.signal?.aborted) return
    cursorRunId = jobs.at(-1)!.runId
  }
  const deferred = await prisma.assistantContentProjectionJob.findFirst({
    orderBy: [{ nextAttemptAt: "asc" }, { runId: "asc" }],
    select: { nextAttemptAt: true },
    where: { nextAttemptAt: { gt: now() }, status: "failed" }
  })
  if (deferred?.nextAttemptAt !== null && deferred?.nextAttemptAt !== undefined) {
    await options.onDeferred?.(deferred.nextAttemptAt)
  }
}

export async function recoverAssistantContentProjectionJobs(
  options: AssistantContentProjectionRecoveryOptions
): Promise<void> {
  if (options.signal?.aborted) return
  const prisma = getPrismaClient()
  const timestamp = now()
  await prisma.$executeRaw`
    UPDATE "assistant_content_projection_jobs"
    SET
      "generation" = "generation" + 1,
      "status" = CASE
        WHEN "attempt_count" >= ${ASSISTANT_CONTENT_PROJECTION_MAX_ATTEMPTS}
        THEN 'exhausted'
        ELSE 'failed'
      END,
      "failure_code" = 'execution-interrupted',
      "last_error" = 'Assistant content projection execution was interrupted before settlement.',
      "next_attempt_at" = CASE
        WHEN "attempt_count" >= ${ASSISTANT_CONTENT_PROJECTION_MAX_ATTEMPTS}
        THEN NULL
        ELSE ${timestamp}
      END,
      "updated_at" = ${timestamp}
    WHERE "status" = 'running'
  `
  await insertMissingAssistantContentProjectionJobs(options.signal)
  if (options.signal?.aborted) return
  await recoverChangedBlockedAssistantContentProjectionJobs(options.signal)
  if (options.signal?.aborted) return
  await dispatchAssistantContentProjectionJobs(options)
}

export async function readAssistantContentProjectionJob(runId: string) {
  return getPrismaClient().assistantContentProjectionJob.findUnique({ where: { runId } })
}
