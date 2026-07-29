import {
  assistantContentProjectionBlockedReasonSchema,
  assistantContentProjectionErrorDetailSchema,
  assistantContentProjectionRetryableFailureCodeSchema,
  assistantContentProjectionJobStatusSchema,
  assistantContentProjectionTerminalFailureCodeSchema,
  assistantContentPartIdentitySchema,
  assistantContentProjectionFingerprint,
  type AssistantContentPart,
  type AssistantContentPartsResult,
  type AssistantContentProjectionBlockedReason,
  type AssistantContentProjectionInspection
} from "@shared/assistant-content-part"
import { getPrismaClient } from "../db/client"
import {
  assistantContentRevision,
  readAssistantContentPartsProjection
} from "../db/assistant-content-parts"
import {
  getCanonicalMainThreadMessage,
  listCanonicalMainThreadMessagesByIds
} from "../db/message-state"
import { JingleIpcError } from "../ipc/error"
import {
  assistantContentProjectionSourceRevision,
  isAssistantContentProjectionDecodeError,
  isAssistantContentProjectionInputError
} from "./projection-error"
import {
  ensureAssistantContentProjectionScheduled,
  resumeAssistantContentProjectionForRepairedSource
} from "./projection-queue"

interface ProjectionJobSnapshot {
  blockedInputs: Array<{
    messageId: string
    reason: AssistantContentProjectionBlockedReason
    sourceRevision: string
  }>
  failureCode: string | null
  lastError: string | null
  status: ReturnType<typeof assistantContentProjectionJobStatusSchema.parse>
}

function parseProjectionJobSnapshot(
  job: {
    blockedInputs: Array<{ messageId: string; reason: string; sourceRevision: string }>
    failureCode: string | null
    lastError: string | null
    status: string
  } | null
): ProjectionJobSnapshot | null {
  if (!job) return null
  return {
    blockedInputs: job.blockedInputs.map((input) => ({
      ...input,
      reason: assistantContentProjectionBlockedReasonSchema.parse(input.reason)
    })),
    failureCode: job.failureCode,
    lastError: job.lastError,
    status: assistantContentProjectionJobStatusSchema.parse(job.status)
  }
}

export class ContentCardsService {
  async inspectAssistantParts(input: {
    messageIds: readonly string[]
    threadId: string
  }): Promise<AssistantContentProjectionInspection[]> {
    const messageIds = [...new Set(input.messageIds)]
    return getPrismaClient().$transaction(async (transaction) => {
      const messages = (
        await listCanonicalMainThreadMessagesByIds(
          { messageIds, threadId: input.threadId },
          transaction
        )
      ).filter((message) => message.role === "assistant")
      const projections = await transaction.assistantContentProjection.findMany({
        select: {
          contentRevision: true,
          messageId: true,
          parts: {
            orderBy: { ordinal: "asc" },
            select: { kind: true, partId: true, revision: true }
          }
        },
        where: { messageId: { in: messageIds }, threadId: input.threadId }
      })
      const messagesById = new Map(messages.map((message) => [message.message_id, message]))
      const projectionsById = new Map(
        projections.map((projection) => [projection.messageId, projection])
      )
      return messageIds.map((messageId): AssistantContentProjectionInspection => {
        const message = messagesById.get(messageId)
        const projection = projectionsById.get(messageId)
        if (!message || !projection) return { messageId, status: "stale" }
        let contentRevision: string
        try {
          contentRevision = assistantContentRevision(message.content)
        } catch (error) {
          if (!isAssistantContentProjectionInputError(error)) throw error
          return { messageId, status: "stale" }
        }
        if (contentRevision !== projection.contentRevision) return { messageId, status: "stale" }
        const partIdentities: Array<Pick<AssistantContentPart, "id" | "kind" | "revision">> = []
        for (const part of projection.parts) {
          const parsed = assistantContentPartIdentitySchema.safeParse({
            id: part.partId,
            kind: part.kind,
            revision: part.revision
          })
          if (!parsed.success) return { messageId, status: "stale" }
          partIdentities.push(parsed.data)
        }
        return {
          messageId,
          projectionFingerprint: assistantContentProjectionFingerprint({
            contentRevision,
            parts: partIdentities,
            schemaVersion: 1
          }),
          status: "ready"
        }
      })
    })
  }

  async getAssistantParts(input: {
    messageId: string
    threadId: string
  }): Promise<AssistantContentPartsResult> {
    const inspection = await getPrismaClient().$transaction(async (transaction) => {
      const message = await getCanonicalMainThreadMessage(input, transaction)
      if (!message) return { kind: "missing" as const }
      if (message.role !== "assistant") {
        throw new JingleIpcError({
          code: "FAILED_PRECONDITION",
          message: "Content cards require an assistant message."
        })
      }
      const job = message.run_id
        ? parseProjectionJobSnapshot(
            await transaction.assistantContentProjectionJob.findUnique({
              select: {
                blockedInputs: {
                  orderBy: { messageId: "asc" },
                  select: { messageId: true, reason: true, sourceRevision: true }
                },
                failureCode: true,
                lastError: true,
                status: true
              },
              where: { runId: message.run_id }
            })
          )
        : null
      let currentRevision: string
      try {
        currentRevision = assistantContentRevision(message.content)
      } catch (error) {
        if (!isAssistantContentProjectionInputError(error)) throw error
        return {
          blockedSource: {
            messageId: input.messageId,
            sourceRevision: assistantContentProjectionSourceRevision(message.content)
          },
          job,
          kind: "invalid" as const,
          runId: message.run_id
        }
      }
      try {
        const projection = await readAssistantContentPartsProjection(input, transaction)
        if (projection?.contentRevision === currentRevision) {
          return {
            job,
            kind: "ready" as const,
            projection,
            runId: message.run_id,
            shouldResumeBlockedSource:
              job?.status === "blocked" &&
              job.blockedInputs.some((blockedInput) => blockedInput.messageId === input.messageId)
          }
        }
      } catch (error) {
        if (!isAssistantContentProjectionDecodeError(error)) throw error
      }
      return { job, kind: "stale" as const, runId: message.run_id }
    })

    if (inspection.kind === "ready") {
      if (inspection.runId && inspection.shouldResumeBlockedSource) {
        void resumeAssistantContentProjectionForRepairedSource(inspection.runId, input.messageId)
      }
      return { projection: inspection.projection, status: "ready" }
    }
    if (inspection.job?.status === "failed") {
      return {
        issue: {
          code: "retryable-failure",
          detail: assistantContentProjectionErrorDetailSchema.parse(inspection.job.lastError),
          reason: assistantContentProjectionRetryableFailureCodeSchema.parse(
            inspection.job.failureCode
          )
        },
        status: "failed"
      }
    }
    if (inspection.job?.status === "exhausted") {
      return {
        issue: {
          code: "retry-exhausted",
          detail: assistantContentProjectionErrorDetailSchema.parse(inspection.job.lastError),
          reason: assistantContentProjectionRetryableFailureCodeSchema.parse(
            inspection.job.failureCode
          )
        },
        status: "exhausted"
      }
    }
    if (inspection.job?.status === "parked") {
      return {
        issue: {
          code: "terminal-failure",
          detail: assistantContentProjectionErrorDetailSchema.parse(inspection.job.lastError),
          reason: assistantContentProjectionTerminalFailureCodeSchema.parse(
            inspection.job.failureCode
          )
        },
        status: "parked"
      }
    }
    if (inspection.job?.status === "blocked") {
      if (!inspection.runId) {
        throw new Error("Blocked assistant content projection has no durable run owner.")
      }
      const blockedInput = inspection.job.blockedInputs.find(
        (entry) => entry.messageId === input.messageId
      )
      if (
        inspection.kind === "invalid" &&
        blockedInput &&
        blockedInput.sourceRevision !== inspection.blockedSource.sourceRevision
      ) {
        await ensureAssistantContentProjectionScheduled(inspection.runId, {
          allowBlockedRetry: false,
          blockedSource: inspection.blockedSource
        })
        return { status: "pending-stream" }
      }
      if (inspection.kind === "stale" && blockedInput) {
        await resumeAssistantContentProjectionForRepairedSource(inspection.runId, input.messageId)
        return { status: "pending-stream" }
      }
      const persistedBlockedInput = inspection.job.blockedInputs[0]
      if (!persistedBlockedInput) {
        throw new Error("Blocked assistant content projection has no durable blocked input.")
      }
      return {
        issue: {
          code: "source-invalid",
          detail: assistantContentProjectionErrorDetailSchema.parse(inspection.job.lastError),
          reason: persistedBlockedInput.reason
        },
        status: "blocked"
      }
    }
    if (inspection.kind === "invalid" && inspection.runId) {
      await ensureAssistantContentProjectionScheduled(inspection.runId, {
        allowBlockedRetry: false,
        blockedSource: inspection.blockedSource
      })
    } else if (inspection.kind === "stale" && inspection.runId) {
      await ensureAssistantContentProjectionScheduled(inspection.runId, {
        allowBlockedRetry: true
      })
    }
    return { status: "pending-stream" }
  }
}
