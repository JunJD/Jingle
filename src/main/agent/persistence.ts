import { randomUUID } from "crypto"
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint"
import {
  createMessage,
  createRun,
  getLatestRun,
  syncMessagesFromSnapshot,
  updateRun,
  updateThread
} from "../db"
import { getCheckpointer } from "./runtime"

type PersistedRunStatus = "pending" | "running" | "error" | "success" | "interrupted"

interface CheckpointChannelMessage {
  id?: string
  _getType?: () => string
  type?: string
  content?: string | unknown[]
  tool_calls?: unknown[]
  tool_call_id?: string
  name?: string
}

interface LatestCheckpointState {
  checkpoint?: {
    channel_values?: {
      messages?: CheckpointChannelMessage[]
      __interrupt__?: unknown[]
    }
  }
}

function resolveMessageRole(
  message: CheckpointChannelMessage
): "user" | "assistant" | "system" | "tool" {
  if (typeof message._getType === "function") {
    const type = message._getType()
    if (type === "human") return "user"
    if (type === "system") return "system"
    if (type === "tool") return "tool"
    return "assistant"
  }

  if (message.type === "human") return "user"
  if (message.type === "system") return "system"
  if (message.type === "tool") return "tool"
  return "assistant"
}

function extractMessagesFromCheckpoint(
  threadId: string,
  state: LatestCheckpointState | undefined
): Array<{
  message_id: string
  role: string
  kind: string
  content: string
  tool_calls?: string | null
  tool_call_id?: string | null
  name?: string | null
  metadata?: string | null
  created_at: number
}> {
  const messages = state?.checkpoint?.channel_values?.messages
  if (!Array.isArray(messages)) {
    return []
  }

  const now = Date.now()

  return messages.map((message, index) => {
    const role = resolveMessageRole(message)
    const content =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content
          : ""

    const messageId =
      message.id || message.tool_call_id || `checkpoint:${threadId}:${index}:${role}`

    return {
      message_id: messageId,
      role,
      kind: role === "tool" ? "tool_result" : "message",
      content: JSON.stringify(content),
      tool_calls: message.tool_calls ? JSON.stringify(message.tool_calls) : null,
      tool_call_id: message.tool_call_id ?? null,
      name: message.name ?? null,
      metadata: null,
      created_at: now + index
    }
  })
}

function resolveCheckpointRunStatus(state: LatestCheckpointState | undefined): PersistedRunStatus {
  const interrupts = state?.checkpoint?.channel_values?.__interrupt__
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
  runId: string
): Promise<PersistedRunStatus> {
  const checkpointer = await getCheckpointer(threadId)
  const latest = (await checkpointer.getTuple({
    configurable: {
      thread_id: threadId
    }
  })) as CheckpointTuple | undefined

  const state = latest as LatestCheckpointState | undefined
  const messages = extractMessagesFromCheckpoint(threadId, state)

  if (messages.length > 0) {
    await syncMessagesFromSnapshot(threadId, runId, messages)
  }

  const status = resolveCheckpointRunStatus(state)

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
