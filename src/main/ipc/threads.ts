import { IpcMain } from "electron"
import { v4 as uuid } from "uuid"
import {
  cloneThread as dbCloneThread,
  getAllThreads,
  getThread,
  getLatestHitlRequest,
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
import { formatDefaultThreadTitle } from "../../shared/i18n"
import { toDisplayUserMessageContent } from "../../shared/message-content"
import { getAgentConfig } from "../preferences"
import { listArtifacts } from "../artifacts/service"
import { deleteManagedArtifactsForThread } from "../artifacts/storage"
import { syncMessageSearchIndexFromSnapshot } from "../db/message-search"
import type { ModelProviderService } from "../model-provider/service"
import type { WorkspaceService } from "../workspace/service"
import type {
  Message,
  Thread,
  ThreadHistoryState,
  ThreadUpdateParams,
  Todo,
  HITLRequest
} from "../types"

async function resolvePendingHitlRequest(
  latestHitl: Awaited<ReturnType<typeof getLatestHitlRequest>>
): Promise<HITLRequest | null> {
  if (!latestHitl || latestHitl.status !== "pending") {
    return null
  }

  return mapHitlRowToRequest(latestHitl)
}

function mapCheckpointMessagesToThreadMessages(
  checkpointMessages: ReturnType<typeof extractMessagesFromCheckpoint>
): Message[] {
  return checkpointMessages.map((row) => {
    let content: Message["content"] = ""
    let tool_calls: Message["tool_calls"] | undefined
    let metadata: Message["metadata"] | undefined

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

    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata) as Message["metadata"]
      } catch {
        metadata = undefined
      }
    }

    return {
      id: row.message_id,
      role: row.role as Message["role"],
      content: row.role === "user" ? toDisplayUserMessageContent(content, metadata) : content,
      tool_calls,
      metadata,
      ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
      ...(row.name ? { name: row.name } : {}),
      created_at: new Date(row.created_at)
    }
  })
}

export function registerThreadHandlers(params: {
  ipcMain: IpcMain
  modelProviderService: ModelProviderService
  workspaceService: WorkspaceService
}): void {
  const { ipcMain, modelProviderService, workspaceService } = params

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
    const nextMetadata: Record<string, unknown> = {
      model: modelProviderService.getDefaultModel("llm"),
      workspacePath: await workspaceService.resolveGlobalWorkspacePath(),
      ...metadata
    }
    const requestedTitle = nextMetadata.title
    const title =
      typeof requestedTitle === "string" && requestedTitle.length > 0
        ? requestedTitle
        : formatDefaultThreadTitle(getAgentConfig().locale)
    const { title: _ignoredTitle, ...threadMetadata } = nextMetadata
    void _ignoredTitle

    const thread = await dbCreateThread(threadId, {
      metadata: threadMetadata,
      title
    })

    return {
      thread_id: thread.thread_id,
      created_at: new Date(thread.created_at),
      updated_at: new Date(thread.updated_at),
      metadata: thread.metadata ? JSON.parse(thread.metadata) : undefined,
      status: thread.status as Thread["status"],
      thread_values: thread.thread_values ? JSON.parse(thread.thread_values) : undefined,
      title: thread.title ?? title
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

  ipcMain.handle("threads:clone", async (_event, sourceThreadId: string) => {
    const sourceThread = await getThread(sourceThreadId)
    if (!sourceThread) {
      throw new Error("Thread not found")
    }

    const threadId = uuid()
    const nextMetadata = sourceThread.metadata
      ? (JSON.parse(sourceThread.metadata) as Record<string, unknown>)
      : {}
    const clonedThread = await dbCloneThread(sourceThreadId, threadId, {
      metadata: nextMetadata,
      threadValues: sourceThread.thread_values
        ? (JSON.parse(sourceThread.thread_values) as Record<string, unknown>)
        : undefined,
      title: sourceThread.title
    })
    try {
      const checkpointer = await getCheckpointer(threadId)
      const latest = await checkpointer.getTuple({
        configurable: {
          thread_id: threadId
        }
      })

      await syncMessageSearchIndexFromSnapshot(
        threadId,
        extractMessagesFromCheckpoint(threadId, latest)
      )
    } catch (error) {
      console.warn("[Threads] Failed to sync cloned thread message search index:", error)
    }

    return {
      thread_id: clonedThread.thread_id,
      created_at: new Date(clonedThread.created_at),
      updated_at: new Date(clonedThread.updated_at),
      metadata: clonedThread.metadata ? JSON.parse(clonedThread.metadata) : undefined,
      status: clonedThread.status as Thread["status"],
      thread_values: clonedThread.thread_values
        ? JSON.parse(clonedThread.thread_values)
        : undefined,
      title: clonedThread.title
    } as Thread
  })

  // Delete a thread
  ipcMain.handle("threads:delete", async (_event, threadId: string) => {
    console.log("[Threads] Deleting thread:", threadId)

    // Delete from our metadata store
    await dbDeleteThread(threadId)
    console.log("[Threads] Deleted from metadata store")

    try {
      await deleteManagedArtifactsForThread(threadId)
      console.log("[Threads] Deleted managed artifacts")
    } catch (e) {
      console.warn("[Threads] Failed to delete managed artifacts:", e)
    }

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
      const [checkpointer, latestHitl, artifacts] = await Promise.all([
        getCheckpointer(threadId),
        getLatestHitlRequest(threadId),
        listArtifacts(threadId)
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
      const pendingApproval = await resolvePendingHitlRequest(latestHitl)

      if (latestHitl) {
        if (pendingApproval) {
          return { artifacts, messages, todos, pendingApproval }
        }
        return {
          artifacts,
          messages,
          todos,
          pendingApproval: null
        }
      }

      return {
        artifacts,
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

      const todos = extractTodosFromCheckpoint(latest)
      const checkpointRequest = extractHitlRequestFromCheckpoint(threadId, latest)
      const pendingApproval = await resolvePendingHitlRequest(latestHitl)

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
