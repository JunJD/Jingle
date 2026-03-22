import { IpcMain } from "electron"
import { v4 as uuid } from "uuid"
import {
  getAllThreads,
  getThread,
  listMessages as dbListMessages,
  createThread as dbCreateThread,
  updateThread as dbUpdateThread,
  deleteThread as dbDeleteThread
} from "../db"
import { closeCheckpointer } from "../agent/runtime"
import { generateTitle } from "../services/title-generator"
import type { Message, Thread, ThreadUpdateParams } from "../types"

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

  ipcMain.handle("threads:messages", async (_event, threadId: string) => {
    const rows = await dbListMessages(threadId)

    return rows.map((row) => {
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
  })

  // Generate a title from a message
  ipcMain.handle("threads:generateTitle", async (_event, message: string) => {
    return generateTitle(message)
  })
}
