import { randomUUID } from "crypto"
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint"
import { createMessage, createRun, getLatestRun, updateRun, updateThread } from "../db"
import { getCheckpointer } from "./runtime"

type PersistedRunStatus = "pending" | "running" | "error" | "success" | "interrupted"

function resolveCheckpointRunStatus(tuple: CheckpointTuple | undefined): PersistedRunStatus {
  const interrupts = (tuple as { checkpoint?: { channel_values?: { __interrupt__?: unknown[] } } })
    ?.checkpoint?.channel_values?.__interrupt__
  return Array.isArray(interrupts) && interrupts.length > 0 ? "interrupted" : "success"
}

export async function beginAgentRun(
  threadId: string,
  message: string,
  modelId?: string
): Promise<{ runId: string; userMessageId: string }> {
  const runId = randomUUID()
  const userMessageId = randomUUID()
  const now = Date.now()

  await createRun(runId, threadId, {
    status: "running",
    metadata: {
      modelId: modelId ?? null
    }
  })

  await createMessage({
    message_id: userMessageId,
    thread_id: threadId,
    run_id: runId,
    role: "user",
    kind: "message",
    content: JSON.stringify(message),
    created_at: now
  })

  await updateThread(threadId, {
    status: "busy"
  })

  return {
    runId,
    userMessageId
  }
}

export async function resumeAgentRun(
  threadId: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  const existing = await getLatestRun(threadId, ["running", "interrupted", "pending"])

  if (existing) {
    await updateRun(existing.run_id, {
      status: "running",
      metadata
    })
    await updateThread(threadId, {
      status: "busy"
    })
    return existing.run_id
  }

  const runId = randomUUID()
  await createRun(runId, threadId, {
    status: "running",
    metadata
  })
  await updateThread(threadId, {
    status: "busy"
  })
  return runId
}

export async function syncRunFromLatestCheckpoint(
  threadId: string,
  runId: string,
  options?: {
    interrupted?: boolean
  }
): Promise<PersistedRunStatus> {
  const checkpointer = await getCheckpointer(threadId)
  const latest = (await checkpointer.getTuple({
    configurable: {
      thread_id: threadId
    }
  })) as CheckpointTuple | undefined

  const status = options?.interrupted ? "interrupted" : resolveCheckpointRunStatus(latest)

  await updateRun(runId, {
    status
  })

  await updateThread(threadId, {
    status: status === "interrupted" ? "interrupted" : "idle"
  })

  return status
}

export async function markRunFailed(
  threadId: string,
  runId: string,
  error: unknown
): Promise<void> {
  try {
    await syncRunFromLatestCheckpoint(threadId, runId)
  } catch {
    // Best effort: preserve the failure even if checkpoint sync fails.
  }

  await updateRun(runId, {
    status: "error",
    metadata: {
      error: error instanceof Error ? error.message : String(error)
    }
  })

  await updateThread(threadId, {
    status: "error"
  })
}

export async function markRunAborted(threadId: string, runId: string): Promise<void> {
  try {
    await syncRunFromLatestCheckpoint(threadId, runId)
  } catch {
    // Ignore checkpoint sync failures on abort and just preserve the status.
  }

  await updateRun(runId, {
    status: "interrupted"
  })

  await updateThread(threadId, {
    status: "interrupted"
  })
}
