import type { AssistantContentPartsResult } from "@shared/assistant-content-part"
import { getPrismaClient } from "../db/client"
import {
  assistantContentRevision,
  readAssistantContentPartsProjection
} from "../db/assistant-content-parts"
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

export class ContentCardsService {
  async getAssistantParts(input: {
    messageId: string
    threadId: string
  }): Promise<AssistantContentPartsResult> {
    const inspection = await getPrismaClient().$transaction(async (transaction) => {
      const message = await transaction.message.findUnique({
        select: { content: true, role: true, runId: true },
        where: { threadId_messageId: input }
      })
      if (!message) return { kind: "missing" as const }
      if (message.role !== "assistant") {
        throw new JingleIpcError({
          code: "FAILED_PRECONDITION",
          message: "Content cards require an assistant message."
        })
      }
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
          kind: "invalid" as const,
          runId: message.runId
        }
      }
      try {
        const projection = await readAssistantContentPartsProjection(input, transaction)
        if (projection?.contentRevision === currentRevision) {
          const blockedInput = message.runId
            ? await transaction.assistantContentProjectionBlockedInput.findUnique({
                select: { job: { select: { status: true } } },
                where: {
                  runId_messageId: { messageId: input.messageId, runId: message.runId }
                }
              })
            : null
          return {
            kind: "ready" as const,
            projection,
            runId: message.runId,
            shouldResumeBlockedSource: blockedInput?.job.status === "blocked"
          }
        }
      } catch (error) {
        if (!isAssistantContentProjectionDecodeError(error)) throw error
      }
      return { kind: "stale" as const, runId: message.runId }
    })

    if (inspection.kind === "ready") {
      if (inspection.runId && inspection.shouldResumeBlockedSource) {
        void resumeAssistantContentProjectionForRepairedSource(inspection.runId, input.messageId)
      }
      return { projection: inspection.projection, status: "ready" }
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
