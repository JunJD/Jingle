import { HumanMessage } from "@langchain/core/messages"
import { Command } from "@langchain/langgraph"
import { normalizeComposerMessageRefs, summarizeMessageContent } from "../../shared/message-content"
import {
  beginAgentRun,
  markRunAborted,
  markRunFailed,
  resumeAgentRun,
  syncRunFromLatestCheckpoint
} from "./persistence"
import { isAbortLikeError } from "./errors"
import { createAgentRuntime } from "./runtime"
import { extractHitlRequestFromValuesState } from "./runtime-state"
import { getThread, resolvePendingHitlRequests, upsertHitlRequest } from "../db"
import type {
  AgentCancelParams,
  AgentInterruptParams,
  AgentInvokeParams,
  AgentResumeParams,
  HITLDecision
} from "../types"

export type AgentStreamPayload =
  | { type: "done" }
  | { type: "error"; error: string; message?: string }
  | { type: "stream"; data: unknown; mode: string }

export interface AgentStreamSink {
  onClosed: (listener: () => void) => () => void
  send: (payload: AgentStreamPayload) => void
}

interface ActiveAgentRun {
  controller: AbortController
  runId: string
}

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
    tool_call_id: request.tool_call.id,
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

export class AgentService {
  private readonly activeRuns = new Map<string, ActiveAgentRun>()

  async invoke({ threadId, message, modelId }: AgentInvokeParams, sink: AgentStreamSink): Promise<void> {
    const messagePreview = summarizeMessageContent(message.content)

    console.log("[Agent] Received invoke request:", {
      threadId,
      message: messagePreview.substring(0, 50),
      modelId
    })

    const existingRun = this.activeRuns.get(threadId)
    if (existingRun) {
      console.log("[Agent] Aborting existing stream for thread:", threadId)
      existingRun.controller.abort()
      this.activeRuns.delete(threadId)
      await markRunAborted(threadId, existingRun.runId)
    }

    const abortController = new AbortController()
    const removeClosedListener = sink.onClosed(() => {
      console.log("[Agent] Window closed, aborting stream for thread:", threadId)
      abortController.abort()
    })

    try {
      const thread = await getThread(threadId)
      const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
      console.log("[Agent] Thread metadata:", metadata)

      const workspacePath = metadata.workspacePath as string | undefined

      if (!workspacePath) {
        sink.send({
          type: "error",
          error: "WORKSPACE_REQUIRED",
          message: "Please select a workspace folder before sending messages."
        })
        return
      }

      const normalizedRefs = normalizeComposerMessageRefs(message.additional_kwargs?.refs)
      const { runId } = await beginAgentRun(threadId, modelId)
      this.activeRuns.set(threadId, { controller: abortController, runId })

      const agent = await createAgentRuntime({ threadId, workspacePath, modelId })
      const humanMessage = new HumanMessage({
        content: message.content,
        id: message.id,
        ...(normalizedRefs.length > 0 ? { additional_kwargs: { refs: normalizedRefs } } : {})
      })

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

        const [mode, data] = chunk as [string, unknown]
        const sawInterrupt = await persistPendingHitlFromStream(threadId, runId, mode, data)
        interrupted = interrupted || sawInterrupt

        sink.send({
          type: "stream",
          mode,
          data: serializeStreamChunkForIpc(mode, data)
        })
      }

      if (!abortController.signal.aborted) {
        await syncRunFromLatestCheckpoint(threadId, runId, { interrupted })
        sink.send({ type: "done" })
      }
    } catch (error) {
      if (!isAbortLikeError(error, abortController.signal)) {
        const activeRun = this.activeRuns.get(threadId)
        if (activeRun) {
          await markRunFailed(threadId, activeRun.runId, error)
        }
        console.error("[Agent] Error:", error)
        sink.send({
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }
    } finally {
      const activeRun = this.activeRuns.get(threadId)
      if (activeRun?.controller === abortController && abortController.signal.aborted) {
        await markRunAborted(threadId, activeRun.runId)
      }
      removeClosedListener()
      this.activeRuns.delete(threadId)
    }
  }

  async resume({ threadId, command, modelId }: AgentResumeParams, sink: AgentStreamSink): Promise<void> {
    console.log("[Agent] Received resume request:", { threadId, command, modelId })

    const thread = await getThread(threadId)
    const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
    const workspacePath = metadata.workspacePath as string | undefined

    if (!workspacePath) {
      sink.send({
        type: "error",
        error: "Workspace path is required"
      })
      return
    }

    const existingRun = this.activeRuns.get(threadId)
    if (existingRun) {
      existingRun.controller.abort()
      this.activeRuns.delete(threadId)
      await markRunAborted(threadId, existingRun.runId)
    }

    const abortController = new AbortController()
    const runId = await resumeAgentRun(threadId, { source: "resume", modelId: modelId ?? null })
    this.activeRuns.set(threadId, { controller: abortController, runId })

    try {
      const agent = await createAgentRuntime({ threadId, workspacePath, modelId })
      const streamMode: Array<"messages" | "values"> = ["messages", "values"]
      const config = {
        configurable: { thread_id: threadId, run_id: runId },
        signal: abortController.signal,
        streamMode,
        recursionLimit: 1000
      }

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
        sink.send({
          type: "stream",
          mode,
          data: serializeStreamChunkForIpc(mode, data)
        })
      }

      if (!abortController.signal.aborted) {
        await syncRunFromLatestCheckpoint(threadId, runId, { interrupted })
        sink.send({ type: "done" })
      }
    } catch (error) {
      if (!isAbortLikeError(error, abortController.signal)) {
        await markRunFailed(threadId, runId, error)
        console.error("[Agent] Resume error:", error)
        sink.send({
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }
    } finally {
      if (abortController.signal.aborted) {
        await markRunAborted(threadId, runId)
      }
      this.activeRuns.delete(threadId)
    }
  }

  async interrupt({ threadId, decision }: AgentInterruptParams, sink: AgentStreamSink): Promise<void> {
    const thread = await getThread(threadId)
    const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
    const workspacePath = metadata.workspacePath as string | undefined
    const modelId = metadata.model as string | undefined

    if (!workspacePath) {
      sink.send({
        type: "error",
        error: "Workspace path is required"
      })
      return
    }

    const existingRun = this.activeRuns.get(threadId)
    if (existingRun) {
      existingRun.controller.abort()
      this.activeRuns.delete(threadId)
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
    this.activeRuns.set(threadId, { controller: abortController, runId })

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
        sink.send({
          type: "stream",
          mode,
          data: serializeStreamChunkForIpc(mode, data)
        })
      }

      if (!abortController.signal.aborted) {
        await syncRunFromLatestCheckpoint(threadId, runId, { interrupted })
        sink.send({ type: "done" })
      }
    } catch (error) {
      if (!isAbortLikeError(error, abortController.signal)) {
        await markRunFailed(threadId, runId, error)
        console.error("[Agent] Interrupt error:", error)
        sink.send({
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }
    } finally {
      if (abortController.signal.aborted) {
        await markRunAborted(threadId, runId)
      }
      this.activeRuns.delete(threadId)
    }
  }

  async cancel({ threadId }: AgentCancelParams): Promise<void> {
    const activeRun = this.activeRuns.get(threadId)
    if (activeRun) {
      activeRun.controller.abort()
      this.activeRuns.delete(threadId)
      await markRunAborted(threadId, activeRun.runId)
    }
  }
}
