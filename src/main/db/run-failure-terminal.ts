import type { Prisma } from "@prisma/client"
import {
  AGENT_RUN_FAILURE_METADATA_KEY,
  encodeAgentRunFailure,
  type AgentRunFailure,
  type AgentRunFailureTerminalStatus
} from "@shared/agent-run-failure"
import { appendAgentEventsInTransaction, type AppendAgentEventInput } from "./agent-events"

export interface CommitRunFailureTerminalInput {
  expectedRunStatus: string
  failure: AgentRunFailure
  runId: string
  runMetadata: string | null
  status: AgentRunFailureTerminalStatus
  threadId: string
}

export async function commitRunFailureTerminalInTransaction(
  transaction: Prisma.TransactionClient,
  input: CommitRunFailureTerminalInput,
  now = BigInt(Date.now())
): Promise<AppendAgentEventInput | null> {
  const event: AppendAgentEventInput = {
    payload: {
      completionReason: null,
      errorMessage: input.failure.message,
      errorType: input.failure.kind,
      status: input.status
    },
    projectTrace: true,
    runId: input.runId,
    threadId: input.threadId,
    type: "run.finished"
  }
  const runTransition = await transaction.run.updateMany({
    data: {
      metadata: encodeFailureMetadata(input.runMetadata, input.failure),
      status: input.status,
      updatedAt: now
    },
    where: {
      runId: input.runId,
      status: input.expectedRunStatus
    }
  })
  if (runTransition.count !== 1) return null

  await transaction.thread.update({
    data: { status: input.status, updatedAt: now },
    where: { threadId: input.threadId }
  })
  await appendAgentEventsInTransaction(transaction, [event], { now })
  return event
}

function encodeFailureMetadata(metadata: string | null, failure: AgentRunFailure): string {
  let parsed: Record<string, unknown> = {}
  if (metadata) {
    try {
      const value = JSON.parse(metadata) as unknown
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>
      }
    } catch {
      // A terminal failure remains typed even when earlier metadata is malformed.
    }
  }
  const next = { ...parsed }
  delete next[AGENT_RUN_FAILURE_METADATA_KEY]
  delete next.error
  next[AGENT_RUN_FAILURE_METADATA_KEY] = encodeAgentRunFailure(failure)
  return JSON.stringify(next)
}
