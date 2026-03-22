import { IpcMain } from "electron"
import { v4 as uuid } from "uuid"
import {
  getAllThreads,
  getThread,
  getLatestHitlRequest,
  upsertHitlRequest,
  createThread as dbCreateThread,
  updateThread as dbUpdateThread,
  deleteThread as dbDeleteThread
} from "../db"
import { getCheckpointer } from "../agent/runtime"
import {
  extractHitlRequestFromCheckpoint,
  extractMessagesFromCheckpoint,
  extractTodosFromCheckpoint,
  mapHitlRowToRequest
} from "../agent/runtime-state"
import { closeCheckpointer } from "../agent/runtime"
import { generateTitle } from "../services/title-generator"
import type {
  Message,
  Thread,
  ThreadHistoryState,
  ThreadUpdateParams,
  Todo,
  HITLRequest
} from "../types"

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  )

  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(",")}}`
}

function resolveToolCallIdFromMessages(
  messages: Message[],
  toolName: string,
  toolArgs: Record<string, unknown>
): string | null {
  const expectedArgs = stableStringify(toolArgs)

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    const toolCalls = message?.tool_calls
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      continue
    }

    for (let toolIndex = toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const toolCall = toolCalls[toolIndex]
      if (toolCall.name !== toolName) {
        continue
      }

      if (stableStringify(toolCall.args ?? {}) === expectedArgs) {
        return toolCall.id
      }
    }
  }

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const toolCalls = messages[messageIndex]?.tool_calls
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      continue
    }

    const fallback = toolCalls.find((toolCall) => toolCall.name === toolName)
    if (fallback?.id) {
      return fallback.id
    }
  }

  return null
}

async function resolvePendingHitlRequest(
  latestHitl: Awaited<ReturnType<typeof getLatestHitlRequest>>,
  messages: Message[]
): Promise<HITLRequest | null> {
  if (!latestHitl || latestHitl.status !== "pending") {
    return null
  }

  const request = mapHitlRowToRequest(latestHitl)
  const currentToolCallId = request.tool_call.id
  const hasPersistedMatch = messages.some((message) =>
    message.tool_calls?.some((toolCall) => toolCall.id === currentToolCallId)
  )

  if (hasPersistedMatch) {
    return request
  }

  let toolArgs: Record<string, unknown> = {}
  try {
    toolArgs = JSON.parse(latestHitl.tool_args) as Record<string, unknown>
  } catch {
    toolArgs = {}
  }

  const resolvedToolCallId = resolveToolCallIdFromMessages(messages, latestHitl.tool_name, toolArgs)
  if (!resolvedToolCallId || resolvedToolCallId === currentToolCallId) {
    return request
  }

  await upsertHitlRequest({
    request_id: latestHitl.request_id,
    thread_id: latestHitl.thread_id,
    run_id: latestHitl.run_id,
    tool_call_id: resolvedToolCallId,
    tool_name: latestHitl.tool_name,
    tool_args: latestHitl.tool_args,
    allowed_decisions: latestHitl.allowed_decisions,
    status: latestHitl.status,
    decision: latestHitl.decision,
    created_at: latestHitl.created_at,
    updated_at: latestHitl.updated_at,
    resolved_at: latestHitl.resolved_at
  })

  return {
    ...request,
    tool_call: {
      ...request.tool_call,
      id: resolvedToolCallId
    }
  }
}

function mapCheckpointMessagesToThreadMessages(
  checkpointMessages: ReturnType<typeof extractMessagesFromCheckpoint>
): Message[] {
  return checkpointMessages.map((row) => {
    let content: Message["content"] = ""
    let tool_calls: Message["tool_calls"] | undefined

    try {
      content = JSON.parse(row.content) as Message["content"]
    } catch {
      content = row.content
    }

    if (row.tool_calls) {
      try {
        tool_calls = JSON.parse(row.tool_calls) as Message["tool_calls"]
      } catch {
        tool_calls = undefined
      }
    }

    return {
      id: row.message_id,
      role: row.role as Message["role"],
      content,
      tool_calls,
      ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
      ...(row.name ? { name: row.name } : {}),
      created_at: new Date(row.created_at)
    }
  })
}

export function registerThreadHandlers(ipcMain: IpcMain): void {
  // List all threads
  ipcMain.handle("threads:list", async () => {
    const threads = await getAllThreads()
    return threads.map((row) => ({
      thread_id: row.thread_id,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      status: row.status as Thread["status"],
      thread_values: row.thread_values ? JSON.parse(row.thread_values) : undefined,
      title: row.title
    }))
  })

  // Get a single thread
  ipcMain.handle("threads:get", async (_event, threadId: string) => {
    const row = await getThread(threadId)
    if (!row) return null
    return {
      thread_id: row.thread_id,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      status: row.status as Thread["status"],
      thread_values: row.thread_values ? JSON.parse(row.thread_values) : undefined,
      title: row.title
    }
  })

  // Create a new thread
  ipcMain.handle("threads:create", async (_event, metadata?: Record<string, unknown>) => {
    const threadId = uuid()
    const title = (metadata?.title as string) || `Thread ${new Date().toLocaleDateString()}`

    const thread = await dbCreateThread(threadId, { ...metadata, title })

    return {
      thread_id: thread.thread_id,
      created_at: new Date(thread.created_at),
      updated_at: new Date(thread.updated_at),
      metadata: thread.metadata ? JSON.parse(thread.metadata) : undefined,
      status: thread.status as Thread["status"],
      thread_values: thread.thread_values ? JSON.parse(thread.thread_values) : undefined,
      title
    } as Thread
  })

  // Update a thread
  ipcMain.handle("threads:update", async (_event, { threadId, updates }: ThreadUpdateParams) => {
    const updateData: Parameters<typeof dbUpdateThread>[1] = {}

    if (updates.title !== undefined) updateData.title = updates.title
    if (updates.status !== undefined) updateData.status = updates.status
    if (updates.metadata !== undefined) updateData.metadata = JSON.stringify(updates.metadata)
    if (updates.thread_values !== undefined)
      updateData.thread_values = JSON.stringify(updates.thread_values)

    const row = await dbUpdateThread(threadId, updateData)
    if (!row) throw new Error("Thread not found")

    return {
      thread_id: row.thread_id,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      status: row.status as Thread["status"],
      thread_values: row.thread_values ? JSON.parse(row.thread_values) : undefined,
      title: row.title
    }
  })

  // Delete a thread
  ipcMain.handle("threads:delete", async (_event, threadId: string) => {
    console.log("[Threads] Deleting thread:", threadId)

    // Delete from our metadata store
    await dbDeleteThread(threadId)
    console.log("[Threads] Deleted from metadata store")

    // Close any open checkpointer for this thread
    try {
      await closeCheckpointer(threadId)
      console.log("[Threads] Closed checkpointer")
    } catch (e) {
      console.warn("[Threads] Failed to close checkpointer:", e)
    }
  })

  ipcMain.handle(
    "threads:history",
    async (_event, threadId: string): Promise<ThreadHistoryState> => {
      const [checkpointer, latestHitl] = await Promise.all([
        getCheckpointer(threadId),
        getLatestHitlRequest(threadId)
      ])

      const latest = await checkpointer.getTuple({
        configurable: {
          thread_id: threadId
        }
      })

      const messages = mapCheckpointMessagesToThreadMessages(
        extractMessagesFromCheckpoint(threadId, latest)
      )
      const todos = extractTodosFromCheckpoint(latest)
      const checkpointRequest = extractHitlRequestFromCheckpoint(threadId, latest)
      const pendingApproval = await resolvePendingHitlRequest(latestHitl, messages)

      if (latestHitl) {
        if (pendingApproval) {
          return { messages, todos, pendingApproval }
        }
        return {
          messages,
          todos,
          pendingApproval: null
        }
      }

      return {
        messages,
        todos,
        pendingApproval: checkpointRequest
      }
    }
  )

  ipcMain.handle(
    "threads:runtimeState",
    async (
      _event,
      threadId: string
    ): Promise<{ todos: Todo[]; pendingApproval: HITLRequest | null }> => {
      const [checkpointer, latestHitl] = await Promise.all([
        getCheckpointer(threadId),
        getLatestHitlRequest(threadId)
      ])

      const latest = await checkpointer.getTuple({
        configurable: {
          thread_id: threadId
        }
      })

      const messages = mapCheckpointMessagesToThreadMessages(
        extractMessagesFromCheckpoint(threadId, latest)
      )
      const todos = extractTodosFromCheckpoint(latest)
      const checkpointRequest = extractHitlRequestFromCheckpoint(threadId, latest)
      const pendingApproval = await resolvePendingHitlRequest(latestHitl, messages)

      if (latestHitl) {
        if (pendingApproval) {
          return { todos, pendingApproval }
        }
        return {
          todos,
          pendingApproval: null
        }
      }

      return {
        todos,
        pendingApproval: checkpointRequest
      }
    }
  )

  // Generate a title from a message
  ipcMain.handle("threads:generateTitle", async (_event, message: string) => {
    return generateTitle(message)
  })
}
