import { randomUUID } from "crypto"
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint"
import { createRun, getRun, updateRun, updateThread } from "../db"
import { getCheckpointer } from "./runtime"

type PersistedRunStatus = "pending" | "running" | "error" | "success" | "interrupted"

function resolveCheckpointRunStatus(tuple: CheckpointTuple | undefined): PersistedRunStatus {
  const interrupts = (tuple as { checkpoint?: { channel_values?: { __interrupt__?: unknown[] } } })
    ?.checkpoint?.channel_values?.__interrupt__
  return Array.isArray(interrupts) && interrupts.length > 0 ? "interrupted" : "success"
}

export async function beginAgentRun(
  threadId: string,
  modelId?: string
): Promise<{ runId: string }> {
  const runId = randomUUID()

  await createRun(runId, threadId, {
    status: "running",
    metadata: {
      modelId: modelId ?? null
    }
  })

  await updateThread(threadId, {
    status: "busy"
  })

  return {
    runId
  }
}

export async function resumeAgentRun(
  threadId: string,
  runId: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  const existing = await getRun(runId)

  if (!existing) {
    throw new Error(`[Agent] Cannot resume missing run "${runId}".`)
  }

  if (existing.thread_id !== threadId) {
    throw new Error(
      `[Agent] Cannot resume run "${runId}" from thread "${threadId}"; actual thread is "${existing.thread_id}".`
    )
  }

  if (existing.status && !["pending", "running", "interrupted"].includes(existing.status)) {
    throw new Error(
      `[Agent] Cannot resume run "${runId}" from status "${existing.status}".`
    )
  }

  await updateRun(runId, {
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
      thread_id: threadId,
      run_id: runId
    }
  })) as CheckpointTuple | undefined

  if (!latest && !options?.interrupted) {
    throw new Error(`[Agent] Missing checkpoint for run "${runId}" in thread "${threadId}".`)
  }

  const status = options?.interrupted ? "interrupted" : resolveCheckpointRunStatus(latest)

  await updateRun(runId, {
    status
  })

  await updateThread(threadId, {
    status: status === "interrupted" ? "interrupted" : "idle"
  })

  return status
}

export async function finalizeRunWithoutCheckpoint(
  threadId: string,
  runId: string,
  options?: {
    interrupted?: boolean
  }
): Promise<PersistedRunStatus> {
  const status: PersistedRunStatus = options?.interrupted ? "interrupted" : "success"

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
