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
import type {
  AgentInvokeParams,
  AgentResumeParams,
  AgentInterruptParams,
  AgentCancelParams,
  HITLDecision
} from "../types"

// Track active runs for cancellation
const activeRuns = new Map<string, { controller: AbortController; runId: string }>()

function mapDecisionToHitlStatus(
  decision: HITLDecision["type"]
): "approved" | "rejected" | "edited" {
  switch (decision) {
    case "approve":
      return "approved"
    case "reject":
      return "rejected"
    case "edit":
      return "edited"
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
    allowed_decisions: request.allowed_decisions,
    status: "pending"
  })

  return true
}

export function registerAgentHandlers(ipcMain: IpcMain): void {
  console.log("[Agent] Registering agent handlers...")

  // Handle agent invocation with streaming
  ipcMain.on("agent:invoke", async (event, { threadId, message, modelId }: AgentInvokeParams) => {
    const channel = `agent:stream:${threadId}`
    const window = BrowserWindow.fromWebContents(event.sender)

    console.log("[Agent] Received invoke request:", {
      threadId,
      message: message.substring(0, 50),
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

      const { runId } = await beginAgentRun(threadId, message, modelId)
      activeRuns.set(threadId, { controller: abortController, runId })

      const agent = await createAgentRuntime({ threadId, workspacePath, modelId })
      const humanMessage = new HumanMessage(message)

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
          data: JSON.parse(JSON.stringify(data))
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

      // Resume from checkpoint by streaming with Command containing the decision
      // The HITL middleware expects { decisions: [{ type: 'approve' | 'reject' | 'edit' }] }
      const decisionType = (command?.resume?.decision || "approve") as HITLDecision["type"]
      await resolvePendingHitlRequests(threadId, mapDecisionToHitlStatus(decisionType), {
        type: decisionType
      })
      const resumeValue = { decisions: [{ type: decisionType }] }
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
          data: JSON.parse(JSON.stringify(data))
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
      edited_args: decision.edited_args,
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

      if (decision.type === "approve") {
        // Resume execution by invoking with null (continues from checkpoint)
        const stream = await agent.stream(null, config)
        let interrupted = false

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break

          const [mode, data] = chunk as unknown as [string, unknown]
          const sawInterrupt = await persistPendingHitlFromStream(threadId, runId, mode, data)
          interrupted = interrupted || sawInterrupt
          window.webContents.send(channel, {
            type: "stream",
            mode,
            data: JSON.parse(JSON.stringify(data))
          })
        }

        if (!abortController.signal.aborted) {
          await syncRunFromLatestCheckpoint(threadId, runId, { interrupted })
          window.webContents.send(channel, { type: "done" })
        }
      } else if (decision.type === "reject") {
        // For reject, we need to send a Command with reject decision
        // For now, just send done - the agent will see no resumption happened
        await syncRunFromLatestCheckpoint(threadId, runId)
        window.webContents.send(channel, { type: "done" })
      }
      // edit case handled similarly to approve with modified args
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
