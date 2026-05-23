import { HumanMessage } from "@langchain/core/messages"
import { Command } from "@langchain/langgraph"
import {
  readLegacySourceProfilesSnapshotFromMetadata,
  readRunExtensionAiCapabilitiesSnapshotFromMetadata
} from "@shared/extension-sources"
import { normalizeComposerMessageRefs, summarizeMessageContent } from "@shared/message-content"
import { shouldAutoGenerateThreadTitle } from "@shared/thread-title"
import {
  createNativeExtensionAiCapabilitiesFromLegacySourceProfiles,
  hydrateNativeExtensionAiCapabilities,
  listNativeExtensionAiCapabilityCatalog,
  resolveNativeExtensionAiCapabilityForExtensionName,
  resolveNativeExtensionAiCapabilitiesForRefs
} from "@extensions/sources"
import { getResolvedNativeExtensionPreferenceRecord } from "../preferences"
import {
  beginAgentRun,
  finalizeRunWithoutCheckpoint,
  markRunAborted,
  markRunFailed,
  resumeAgentRun,
  syncRunFromLatestCheckpoint,
  updateRunExtensionAiCapabilitiesSnapshot
} from "./persistence"
import { isAbortLikeError, isModelAuthenticationError, normalizeAgentRuntimeError } from "./errors"
import { createAgentRuntime, runtimeUsesCheckpointPersistence } from "./runtime"
import { buildAgentResumeConfig, buildAgentRunConfig } from "./run-config"
import { extractHitlRequestFromValuesState } from "./runtime-state"
import { getHitlRequest, getRun, getThread, resolveHitlRequest, upsertHitlRequest } from "../db"
import { buildIpcErrorEvent, OpenworkIpcError } from "../ipc/error"
import { readRunPermissionModeSnapshot, readThreadPermissionMode } from "./permission-mode"
import type {
  AgentCancelParams,
  AgentInvokeParams,
  AgentResumeParams,
  HITLDecision
} from "../types"

export type AgentStreamPayload =
  | { type: "done" }
  | { type: "cancelled" }
  | {
      type: "error"
      error: string
      code?: string
      details?: string[]
      message?: string
      status?: number
    }
  | { type: "run_started"; runId: string }
  | { type: "stream"; data: unknown; mode: string }

export interface AgentStreamSink {
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

interface ResumeTarget {
  requestId: string
  runId: string
}

async function resolveResumeTarget(
  threadId: string,
  decision: HITLDecision | undefined
): Promise<ResumeTarget> {
  const requestId = decision?.request_id?.trim()

  if (!requestId) {
    throw new OpenworkIpcError({
      channel: "agent:resume",
      code: "INVALID_ARGUMENT",
      message: "[Agent] HITL resume requires request_id."
    })
  }

  const request = await getHitlRequest(requestId)
  if (!request) {
    throw new OpenworkIpcError({
      channel: "agent:resume",
      code: "NOT_FOUND",
      message: `[Agent] HITL request "${requestId}" not found.`
    })
  }

  if (request.thread_id !== threadId) {
    throw new OpenworkIpcError({
      channel: "agent:resume",
      code: "INVALID_ARGUMENT",
      message: `[Agent] HITL request "${requestId}" belongs to thread "${request.thread_id}", not "${threadId}".`
    })
  }

  if (request.status !== "pending") {
    throw new OpenworkIpcError({
      channel: "agent:resume",
      code: "CONFLICT",
      message: `[Agent] HITL request "${requestId}" is already "${request.status}", expected pending.`
    })
  }

  if (!request.run_id) {
    throw new OpenworkIpcError({
      channel: "agent:resume",
      code: "FAILED_PRECONDITION",
      message: `[Agent] HITL request "${requestId}" is missing run_id.`
    })
  }

  if (
    decision?.tool_call_id &&
    request.tool_call_id &&
    decision.tool_call_id !== request.tool_call_id
  ) {
    throw new OpenworkIpcError({
      channel: "agent:resume",
      code: "INVALID_ARGUMENT",
      message: `[Agent] HITL request "${requestId}" tool_call_id mismatch: expected "${request.tool_call_id}", got "${decision.tool_call_id}".`
    })
  }

  return {
    requestId: request.request_id,
    runId: request.run_id
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

export function projectInterruptForIpc(
  threadId: string,
  runId: string,
  data: unknown
): unknown[] | undefined {
  const state = data as {
    __interrupt__?: Array<{
      value?: {
        actionRequests?: Array<Record<string, unknown>>
      }
    }>
  } | null

  if (!Array.isArray(state?.__interrupt__)) {
    return undefined
  }

  const request = extractHitlRequestFromValuesState(threadId, runId, data)
  if (!request) {
    return state.__interrupt__
  }

  const firstInterrupt = state.__interrupt__[0]
  const firstAction = firstInterrupt?.value?.actionRequests?.[0]
  if (!firstInterrupt || !firstAction) {
    return state.__interrupt__
  }

  return [
    {
      ...firstInterrupt,
      value: {
        ...firstInterrupt.value,
        actionRequests: [
          {
            ...firstAction,
            id: request.id,
            toolCallId: request.tool_call.id
          },
          ...(firstInterrupt.value?.actionRequests?.slice(1) ?? [])
        ]
      }
    },
    ...state.__interrupt__.slice(1)
  ]
}

export function serializeStreamChunkForIpc(
  mode: string,
  data: unknown,
  options?: {
    runId?: string
    threadId?: string
  }
): unknown {
  if (mode === "values") {
    const projectedState = projectValuesStreamDataForIpc(data)
    if (options?.threadId && options?.runId) {
      const projectedInterrupt = projectInterruptForIpc(options.threadId, options.runId, data)
      if (projectedInterrupt) {
        projectedState.__interrupt__ = projectedInterrupt
      }
    }
    return cloneStreamDataForIpc(projectedState)
  }

  return cloneStreamDataForIpc(data)
}

export class AgentService {
  private readonly activeRuns = new Map<string, ActiveAgentRun>()

  async invoke(
    { threadId, message, modelId, permissionMode: requestedPermissionMode }: AgentInvokeParams,
    sink: AgentStreamSink
  ): Promise<void> {
    const messagePreview = summarizeMessageContent(message.content)

    console.log("[Agent] Received invoke request:", {
      threadId,
      message: messagePreview.substring(0, 50),
      modelId,
      permissionMode: requestedPermissionMode
    })

    const existingRun = this.activeRuns.get(threadId)
    if (existingRun) {
      console.log("[Agent] Aborting existing stream for thread:", threadId)
      existingRun.controller.abort()
      this.activeRuns.delete(threadId)
      await markRunAborted(threadId, existingRun.runId)
    }

    const abortController = new AbortController()

    try {
      const thread = await getThread(threadId)
      const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
      console.log("[Agent] Thread metadata:", metadata)

      const workspacePath = metadata.workspacePath as string | undefined

      if (!workspacePath) {
        sink.send({
          type: "error",
          ...buildIpcErrorEvent(
            "agent:invoke",
            new OpenworkIpcError({
              channel: "agent:invoke",
              code: "FAILED_PRECONDITION",
              message: "Please select a workspace folder before sending messages."
            })
          )
        })
        return
      }

      const normalizedRefs = normalizeComposerMessageRefs(message.additional_kwargs?.refs)
      const permissionMode = requestedPermissionMode ?? readThreadPermissionMode(thread)
      const aiCapabilities = resolveNativeExtensionAiCapabilitiesForRefs(normalizedRefs, {
        getPreferences: getResolvedNativeExtensionPreferenceRecord,
        permissionMode,
        platform: process.platform
      })
      const aiCapabilityCatalog = listNativeExtensionAiCapabilityCatalog(process.platform)
      const getAiCapabilityByExtensionName = (extensionName: string) =>
        resolveNativeExtensionAiCapabilityForExtensionName(extensionName, {
          getPreferences: getResolvedNativeExtensionPreferenceRecord,
          permissionMode,
          platform: process.platform
        })

      const { runId } = await beginAgentRun(threadId, modelId, {
        aiCapabilities,
        permissionMode
      })
      this.activeRuns.set(threadId, { controller: abortController, runId })
      sink.send({ type: "run_started", runId })

      const agent = await createAgentRuntime({
        threadId,
        workspacePath,
        modelId,
        permissionMode,
        aiCapabilities,
        aiCapabilityCatalog,
        getAiCapabilityByExtensionName,
        onLoadedAiCapabilitiesChanged: ({ aiCapabilities, permissionMode, runId }) =>
          updateRunExtensionAiCapabilitiesSnapshot(runId, {
            aiCapabilities,
            permissionMode
          })
      })
      const humanMessage = new HumanMessage({
        content: message.content,
        id: message.id,
        ...(normalizedRefs.length > 0 ? { additional_kwargs: { refs: normalizedRefs } } : {})
      })
      const initialState = {
        messages: [humanMessage],
        ...(thread?.title &&
        !shouldAutoGenerateThreadTitle({
          metadata,
          title: thread.title
        })
          ? { title: thread.title }
          : {})
      }

      const stream = await agent.stream(
        initialState,
        buildAgentRunConfig(threadId, runId, abortController)
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
          data: serializeStreamChunkForIpc(mode, data, { threadId, runId })
        })
      }

      if (!abortController.signal.aborted) {
        if (runtimeUsesCheckpointPersistence()) {
          await syncRunFromLatestCheckpoint(threadId, runId, { interrupted })
        } else {
          await finalizeRunWithoutCheckpoint(threadId, runId, { interrupted })
        }
        sink.send({ type: "done" })
      }
    } catch (error) {
      if (!isAbortLikeError(error, abortController.signal)) {
        const normalizedError = normalizeAgentRuntimeError("agent:invoke", error)
        const activeRun = this.activeRuns.get(threadId)
        if (activeRun) {
          await markRunFailed(threadId, activeRun.runId, normalizedError)
        }
        if (!isModelAuthenticationError(error)) {
          console.error("[Agent] Error:", error)
        }
        sink.send({
          type: "error",
          ...buildIpcErrorEvent("agent:invoke", normalizedError)
        })
      }
    } finally {
      const activeRun = this.activeRuns.get(threadId)
      if (activeRun?.controller === abortController && abortController.signal.aborted) {
        await markRunAborted(threadId, activeRun.runId)
      }
      this.activeRuns.delete(threadId)
    }
  }

  async resume(
    { threadId, command, modelId }: AgentResumeParams,
    sink: AgentStreamSink
  ): Promise<void> {
    console.log("[Agent] Received resume request:", { threadId, command, modelId })

    const thread = await getThread(threadId)
    const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
    const workspacePath = metadata.workspacePath as string | undefined

    if (!workspacePath) {
      sink.send({
        type: "error",
        ...buildIpcErrorEvent(
          "agent:resume",
          new OpenworkIpcError({
            channel: "agent:resume",
            code: "FAILED_PRECONDITION",
            message: "Workspace path is required"
          })
        )
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
    const decision = command?.resume
    if (!decision) {
      throw new Error("[Agent] Resume command is missing HITL decision.")
    }

    const decisionType = decision.type
    let resumeTarget: ResumeTarget
    let runId: string

    try {
      resumeTarget = await resolveResumeTarget(threadId, decision)
      runId = await resumeAgentRun(threadId, resumeTarget.runId, {
        source: "resume",
        modelId: modelId ?? null,
        requestId: resumeTarget.requestId
      })
    } catch (error) {
      console.error("[Agent] Resume error:", error)
      sink.send({
        type: "error",
        ...buildIpcErrorEvent("agent:resume", error)
      })
      return
    }

    this.activeRuns.set(threadId, { controller: abortController, runId })
    sink.send({ type: "run_started", runId })

    try {
      const resumedRun = await getRun(runId)
      const permissionMode = readRunPermissionModeSnapshot(resumedRun)
      const aiCapabilitySnapshots = readRunExtensionAiCapabilitiesSnapshotFromMetadata(
        resumedRun?.metadata
      )
      const legacySourceProfiles = readLegacySourceProfilesSnapshotFromMetadata(
        resumedRun?.metadata
      )
      const aiCapabilities =
        aiCapabilitySnapshots === null
          ? null
          : hydrateNativeExtensionAiCapabilities(aiCapabilitySnapshots)
      const runtimeAiCapabilities =
        aiCapabilities === null
          ? legacySourceProfiles === null
            ? []
            : createNativeExtensionAiCapabilitiesFromLegacySourceProfiles(legacySourceProfiles)
          : aiCapabilities
      const agent = await createAgentRuntime({
        threadId,
        workspacePath,
        modelId,
        permissionMode,
        aiCapabilities: runtimeAiCapabilities,
        aiCapabilityCatalog: listNativeExtensionAiCapabilityCatalog(process.platform),
        getAiCapabilityByExtensionName: (extensionName: string) =>
          resolveNativeExtensionAiCapabilityForExtensionName(extensionName, {
            getPreferences: getResolvedNativeExtensionPreferenceRecord,
            permissionMode,
            platform: process.platform
          }),
        onLoadedAiCapabilitiesChanged: ({ aiCapabilities, permissionMode, runId }) =>
          updateRunExtensionAiCapabilitiesSnapshot(runId, {
            aiCapabilities,
            permissionMode
          })
      })
      const config = buildAgentResumeConfig(threadId, runId, abortController)
      const resolvedHitlDecision = {
        type: decision.type,
        request_id: resumeTarget.requestId,
        tool_call_id: decision.tool_call_id,
        feedback: decision.feedback
      }
      const resolveConsumedHitlRequest = async (): Promise<void> => {
        await resolveHitlRequest(
          resumeTarget.requestId,
          mapDecisionToHitlStatus(decisionType),
          resolvedHitlDecision
        )
      }
      const resumeValue = buildResumeValue(decision)
      const stream = await agent.stream(new Command({ resume: resumeValue }), config)
      let interrupted = false
      let hitlRequestResolved = false

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break

        const [mode, data] = chunk as unknown as [string, unknown]
        if (!hitlRequestResolved) {
          // Keep newer interrupts ordered after the decision that resumed this run.
          await resolveConsumedHitlRequest()
          hitlRequestResolved = true
        }
        const sawInterrupt = await persistPendingHitlFromStream(threadId, runId, mode, data)
        interrupted = interrupted || sawInterrupt
        sink.send({
          type: "stream",
          mode,
          data: serializeStreamChunkForIpc(mode, data, { threadId, runId })
        })
      }

      if (!abortController.signal.aborted) {
        if (!hitlRequestResolved) {
          await resolveConsumedHitlRequest()
        }
        if (runtimeUsesCheckpointPersistence()) {
          await syncRunFromLatestCheckpoint(threadId, runId, { interrupted })
        } else {
          await finalizeRunWithoutCheckpoint(threadId, runId, { interrupted })
        }
        sink.send({ type: "done" })
      }
    } catch (error) {
      if (!isAbortLikeError(error, abortController.signal)) {
        const normalizedError = normalizeAgentRuntimeError("agent:resume", error)
        await markRunFailed(threadId, runId, normalizedError)
        if (!isModelAuthenticationError(error)) {
          console.error("[Agent] Resume error:", error)
        }
        sink.send({
          type: "error",
          ...buildIpcErrorEvent("agent:resume", normalizedError)
        })
      }
    } finally {
      if (abortController.signal.aborted) {
        await markRunAborted(threadId, runId)
      }
      this.activeRuns.delete(threadId)
    }
  }

  async cancel({ threadId }: AgentCancelParams): Promise<boolean> {
    const activeRun = this.activeRuns.get(threadId)
    if (!activeRun) {
      return false
    }

    activeRun.controller.abort()
    this.activeRuns.delete(threadId)
    await markRunAborted(threadId, activeRun.runId)
    return true
  }
}
