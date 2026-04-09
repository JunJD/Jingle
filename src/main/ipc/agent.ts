import { IpcMain, BrowserWindow } from "electron"
import { HumanMessage } from "@langchain/core/messages"
import { Command } from "@langchain/langgraph"
import { createAgentRuntime } from "../agent/runtime"
import { getThread, resolvePendingHitlRequests, upsertHitlRequest } from "../db"
import {
  beginAgentRun,
  markRunAborted,
  markRunFailed,
  resumeAgentRun,
  syncRunFromLatestCheckpoint
} from "../agent/persistence"
import { extractHitlRequestFromValuesState } from "../agent/runtime-state"
import { normalizeComposerMessageRefs, summarizeMessageContent } from "../../shared/message-content"
import type {
  AgentInvokeParams,
  AgentResumeParams,
  AgentInterruptParams,
  AgentCancelParams,
  HITLDecision
} from "../types"

// Track active runs for cancellation
const activeRuns = new Map<string, { controller: AbortController; runId: string }>()

function mapDecisionToHitlStatus(decision: HITLDecision["type"]): "approved" | "rejected" {
  switch (decision) {
    case "approve":
      return "approved"
    case "reject":
      return "rejected"
  }

  throw new Error(`[Agent] Unsupported HITL decision type: ${decision}`)
}

function buildResumeDecision(decision: HITLDecision): {
  type: HITLDecision["type"]
  feedback?: string
} {
  return {
    type: decision.type,
    ...(decision.feedback ? { feedback: decision.feedback } : {})
  }
}

function buildResumeValue(decision: HITLDecision): {
  decisions: Array<ReturnType<typeof buildResumeDecision>>
} {
  return {
    decisions: [buildResumeDecision(decision)]
  }
}

async function persistPendingHitlFromStream(
  threadId: string,
  runId: string,
  mode: string,
  data: unknown
): Promise<boolean> {
  if (mode !== "values") {
    return false
  }

  const request = extractHitlRequestFromValuesState(threadId, runId, data)
  if (!request) {
    return false
  }

  await upsertHitlRequest({
    request_id: request.id,
    thread_id: threadId,
    run_id: runId,
    tool_call_id: request.tool_call.id || null,
    tool_name: request.tool_call.name,
    tool_args: request.tool_call.args,
    review_kind: request.review?.kind ?? null,
    review_payload: request.review,
    allowed_decisions: request.allowed_decisions,
    status: "pending"
  })

  return true
}

function cloneStreamDataForIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getProjectedFileSize(file: unknown): number | undefined {
  if (!file || typeof file !== "object") {
    return undefined
  }

  if (typeof (file as { size?: unknown }).size === "number") {
    return (file as { size: number }).size
  }

  const content = (file as { content?: unknown }).content
  if (typeof content === "string") {
    return content.length
  }

  if (Array.isArray(content)) {
    return content.reduce((total, line) => total + (typeof line === "string" ? line.length : 0), 0)
  }

  return undefined
}

function projectFilesForIpc(
  files: unknown
): Array<{ path: string; is_dir?: boolean; size?: number }> | undefined {
  if (Array.isArray(files)) {
    const projectedFiles = files.flatMap((file) => {
      if (!file || typeof file !== "object") {
        return []
      }

      const path = (file as { path?: unknown }).path
      if (typeof path !== "string" || !path) {
        return []
      }

      const projectedFile = {
        path
      } as { path: string; is_dir?: boolean; size?: number }

      if (typeof (file as { is_dir?: unknown }).is_dir === "boolean") {
        projectedFile.is_dir = (file as { is_dir: boolean }).is_dir
      }

      const size = getProjectedFileSize(file)
      if (size !== undefined) {
        projectedFile.size = size
      }

      return [projectedFile]
    })

    return projectedFiles.length > 0 ? projectedFiles : undefined
  }

  if (!files || typeof files !== "object") {
    return undefined
  }

  const projectedFiles = Object.entries(files).map(([path, file]) => {
    const projectedFile = {
      path
    } as { path: string; is_dir?: boolean; size?: number }
    const size = getProjectedFileSize(file)

    if (size !== undefined) {
      projectedFile.size = size
    }

    return projectedFile
  })

  return projectedFiles.length > 0 ? projectedFiles : undefined
}

function projectValuesStreamDataForIpc(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return {}
  }

  const state = data as {
    __interrupt__?: unknown
    files?: unknown
    messages?: unknown
    todos?: unknown
    workspacePath?: unknown
  }
  const projectedState: Record<string, unknown> = {}

  if (Array.isArray(state.messages)) {
    projectedState.messages = state.messages
  }

  if (Array.isArray(state.todos)) {
    projectedState.todos = state.todos
  }

  if (typeof state.workspacePath === "string" && state.workspacePath.trim()) {
    projectedState.workspacePath = state.workspacePath
  }

  const projectedFiles = projectFilesForIpc(state.files)
  if (projectedFiles) {
    projectedState.files = projectedFiles
  }

  if (Array.isArray(state.__interrupt__)) {
    projectedState.__interrupt__ = state.__interrupt__
  }

  return projectedState
}

function serializeStreamChunkForIpc(mode: string, data: unknown): unknown {
  if (mode === "values") {
    return cloneStreamDataForIpc(projectValuesStreamDataForIpc(data))
  }

  return cloneStreamDataForIpc(data)
}

export function registerAgentHandlers(ipcMain: IpcMain): void {
  console.log("[Agent] Registering agent handlers...")

  // Handle agent invocation with streaming
  ipcMain.on("agent:invoke", async (event, { threadId, message, modelId }: AgentInvokeParams) => {
    const channel = `agent:stream:${threadId}`
    const window = BrowserWindow.fromWebContents(event.sender)
    const messagePreview = summarizeMessageContent(message.content)

    console.log("[Agent] Received invoke request:", {
      threadId,
      message: messagePreview.substring(0, 50),
      modelId
    })

    if (!window) {
      console.error("[Agent] No window found")
      return
    }

    // Abort any existing stream for this thread before starting a new one
    // This prevents concurrent streams which can cause checkpoint corruption
    const existingRun = activeRuns.get(threadId)
    if (existingRun) {
      console.log("[Agent] Aborting existing stream for thread:", threadId)
      existingRun.controller.abort()
      activeRuns.delete(threadId)
      await markRunAborted(threadId, existingRun.runId)
    }

    const abortController = new AbortController()

    // Abort the stream if the window is closed/destroyed
    const onWindowClosed = (): void => {
      console.log("[Agent] Window closed, aborting stream for thread:", threadId)
      abortController.abort()
    }
    window.once("closed", onWindowClosed)

    try {
      // Get workspace path from thread metadata - REQUIRED
      const thread = await getThread(threadId)
      const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
      console.log("[Agent] Thread metadata:", metadata)

      const workspacePath = metadata.workspacePath as string | undefined

      if (!workspacePath) {
        window.webContents.send(channel, {
          type: "error",
          error: "WORKSPACE_REQUIRED",
          message: "Please select a workspace folder before sending messages."
        })
        return
      }

      const normalizedRefs = normalizeComposerMessageRefs(message.additional_kwargs?.refs)
      const { runId } = await beginAgentRun(threadId, modelId)
      activeRuns.set(threadId, { controller: abortController, runId })

      const agent = await createAgentRuntime({ threadId, workspacePath, modelId })
      const humanMessage = new HumanMessage({
        content: message.content,
        id: message.id,
        ...(normalizedRefs.length > 0 ? { additional_kwargs: { refs: normalizedRefs } } : {})
      })

      // Stream with both modes:
      // - 'messages' for real-time token streaming
      // - 'values' for full state (todos, files, etc.)
      const stream = await agent.stream(
        { messages: [humanMessage] },
        {
          configurable: { thread_id: threadId, run_id: runId },
          signal: abortController.signal,
          streamMode: ["messages", "values"],
          recursionLimit: 1000
        }
      )
      let interrupted = false

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break

        // With multiple stream modes, chunks are tuples: [mode, data]
        const [mode, data] = chunk as [string, unknown]
        const sawInterrupt = await persistPendingHitlFromStream(threadId, runId, mode, data)
        interrupted = interrupted || sawInterrupt

        // Forward raw stream events - transport layer handles parsing
        // Serialize to plain objects for IPC (class instances don't transfer)
        window.webContents.send(channel, {
          type: "stream",
          mode,
          data: serializeStreamChunkForIpc(mode, data)
        })
      }

      // Send done event (only if not aborted)
      if (!abortController.signal.aborted) {
        await syncRunFromLatestCheckpoint(threadId, runId, { interrupted })
        window.webContents.send(channel, { type: "done" })
      }
    } catch (error) {
      // Ignore abort-related errors (expected when stream is cancelled)
      const isAbortError =
        error instanceof Error &&
        (error.name === "AbortError" ||
          error.message.includes("aborted") ||
          error.message.includes("Controller is already closed"))

      if (!isAbortError) {
        const activeRun = activeRuns.get(threadId)
        if (activeRun) {
          await markRunFailed(threadId, activeRun.runId, error)
        }
        console.error("[Agent] Error:", error)
        window.webContents.send(channel, {
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }
    } finally {
      const activeRun = activeRuns.get(threadId)
      if (activeRun?.controller === abortController && abortController.signal.aborted) {
        await markRunAborted(threadId, activeRun.runId)
      }
      window.removeListener("closed", onWindowClosed)
      activeRuns.delete(threadId)
    }
  })

  // Handle agent resume (after interrupt approval/rejection via useStream)
  ipcMain.on("agent:resume", async (event, { threadId, command, modelId }: AgentResumeParams) => {
    const channel = `agent:stream:${threadId}`
    const window = BrowserWindow.fromWebContents(event.sender)

    console.log("[Agent] Received resume request:", { threadId, command, modelId })

    if (!window) {
      console.error("[Agent] No window found for resume")
      return
    }

    // Get workspace path from thread metadata
    const thread = await getThread(threadId)
    const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
    const workspacePath = metadata.workspacePath as string | undefined

    if (!workspacePath) {
      window.webContents.send(channel, {
        type: "error",
        error: "Workspace path is required"
      })
      return
    }

    // Abort any existing stream before resuming
    const existingRun = activeRuns.get(threadId)
    if (existingRun) {
      existingRun.controller.abort()
      activeRuns.delete(threadId)
      await markRunAborted(threadId, existingRun.runId)
    }

    const abortController = new AbortController()
    const runId = await resumeAgentRun(threadId, { source: "resume", modelId: modelId ?? null })
    activeRuns.set(threadId, { controller: abortController, runId })

    try {
      const agent = await createAgentRuntime({ threadId, workspacePath, modelId })
      const streamMode: Array<"messages" | "values"> = ["messages", "values"]
      const config = {
        configurable: { thread_id: threadId, run_id: runId },
        signal: abortController.signal,
        streamMode,
        recursionLimit: 1000
      }

      // Resume from checkpoint with the approval middleware response.
      const decision: HITLDecision = command?.resume ?? { type: "approve" }
      const decisionType = decision.type
      await resolvePendingHitlRequests(threadId, mapDecisionToHitlStatus(decisionType), {
        type: decision.type,
        tool_call_id: decision.tool_call_id,
        feedback: decision.feedback
      })
      const resumeValue = buildResumeValue(decision)
      const stream = await agent.stream(new Command({ resume: resumeValue }), config)
      let interrupted = false

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break

        const [mode, data] = chunk as unknown as [string, unknown]
        const sawInterrupt = await persistPendingHitlFromStream(threadId, runId, mode, data)
        interrupted = interrupted || sawInterrupt
        window.webContents.send(channel, {
          type: "stream",
          mode,
          data: serializeStreamChunkForIpc(mode, data)
        })
      }

      if (!abortController.signal.aborted) {
        await syncRunFromLatestCheckpoint(threadId, runId, { interrupted })
        window.webContents.send(channel, { type: "done" })
      }
    } catch (error) {
      const isAbortError =
        error instanceof Error &&
        (error.name === "AbortError" ||
          error.message.includes("aborted") ||
          error.message.includes("Controller is already closed"))

      if (!isAbortError) {
        await markRunFailed(threadId, runId, error)
        console.error("[Agent] Resume error:", error)
        window.webContents.send(channel, {
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }
    } finally {
      if (abortController.signal.aborted) {
        await markRunAborted(threadId, runId)
      }
      activeRuns.delete(threadId)
    }
  })

  // Handle HITL interrupt response
  ipcMain.on("agent:interrupt", async (event, { threadId, decision }: AgentInterruptParams) => {
    const channel = `agent:stream:${threadId}`
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) {
      console.error("[Agent] No window found for interrupt response")
      return
    }

    // Get workspace path from thread metadata - REQUIRED
    const thread = await getThread(threadId)
    const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
    const workspacePath = metadata.workspacePath as string | undefined
    const modelId = metadata.model as string | undefined

    if (!workspacePath) {
      window.webContents.send(channel, {
        type: "error",
        error: "Workspace path is required"
      })
      return
    }

    // Abort any existing stream before continuing
    const existingRun = activeRuns.get(threadId)
    if (existingRun) {
      existingRun.controller.abort()
      activeRuns.delete(threadId)
      await markRunAborted(threadId, existingRun.runId)
    }

    const abortController = new AbortController()
    const runId = await resumeAgentRun(threadId, {
      source: "interrupt",
      decision: decision.type,
      modelId: modelId ?? null
    })
    await resolvePendingHitlRequests(threadId, mapDecisionToHitlStatus(decision.type), {
      type: decision.type,
      tool_call_id: decision.tool_call_id,
      feedback: decision.feedback
    })
    activeRuns.set(threadId, { controller: abortController, runId })

    try {
      const agent = await createAgentRuntime({ threadId, workspacePath, modelId })
      const streamMode: Array<"messages" | "values"> = ["messages", "values"]
      const config = {
        configurable: { thread_id: threadId, run_id: runId },
        signal: abortController.signal,
        streamMode,
        recursionLimit: 1000
      }

      const resumeValue = buildResumeValue(decision)
      const stream = await agent.stream(new Command({ resume: resumeValue }), config)
      let interrupted = false

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break

        const [mode, data] = chunk as unknown as [string, unknown]
        const sawInterrupt = await persistPendingHitlFromStream(threadId, runId, mode, data)
        interrupted = interrupted || sawInterrupt
        window.webContents.send(channel, {
          type: "stream",
          mode,
          data: serializeStreamChunkForIpc(mode, data)
        })
      }

      if (!abortController.signal.aborted) {
        await syncRunFromLatestCheckpoint(threadId, runId, { interrupted })
        window.webContents.send(channel, { type: "done" })
      }
    } catch (error) {
      const isAbortError =
        error instanceof Error &&
        (error.name === "AbortError" ||
          error.message.includes("aborted") ||
          error.message.includes("Controller is already closed"))

      if (!isAbortError) {
        await markRunFailed(threadId, runId, error)
        console.error("[Agent] Interrupt error:", error)
        window.webContents.send(channel, {
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }
    } finally {
      if (abortController.signal.aborted) {
        await markRunAborted(threadId, runId)
      }
      activeRuns.delete(threadId)
    }
  })

  // Handle cancellation
  ipcMain.handle("agent:cancel", async (_event, { threadId }: AgentCancelParams) => {
    const activeRun = activeRuns.get(threadId)
    if (activeRun) {
      activeRun.controller.abort()
      activeRuns.delete(threadId)
      await markRunAborted(threadId, activeRun.runId)
    }
  })
}
