import { HumanMessage } from "@langchain/core/messages"
import { Command } from "@langchain/langgraph"
import { normalizeComposerMessageRefs, summarizeMessageContent } from "@shared/message-content"
import { OPENWORK_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY } from "@shared/openwork-memory"
import { readRunExtensionAiCapabilitiesSnapshotFromMetadata } from "@shared/extension-sources"
import { shouldAutoGenerateThreadTitle } from "@shared/thread-title"
import {
  hydrateNativeExtensionAiCapabilities,
  listNativeExtensionAiCapabilityCatalog,
  resolveNativeExtensionAiCapabilityForExtensionName,
  resolveNativeExtensionAiCapabilitiesForRefs
} from "@extensions/sources"
import {
  resolveNativeExtensionConnection,
  resolveNativeExtensionExecutionContext
} from "../native-extensions/connection-resolver"
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
import {
  createAgentRuntime,
  runtimeUsesCheckpointPersistence,
  type AgentRuntimeHandle
} from "./runtime"
import { buildAgentResumeConfig, buildAgentRunConfig } from "./run-config"
import { extractHitlRequestFromValuesState } from "./runtime-state"
import { ThreadLifecycleGate, type ThreadRunLease } from "./thread-lifecycle-gate"
import { getHitlRequest, getRun, getThread, resolveHitlRequest, upsertHitlRequest } from "../db"
import { buildIpcErrorEvent, OpenworkIpcError } from "../ipc/error"
import { OpenworkMemoryService } from "../openwork-memory/service"
import { WorkspaceService } from "../workspace/service"
import { readRunPermissionModeSnapshot, readThreadPermissionMode } from "./permission-mode"
import { resolveOpenworkWorkspaceIdentity } from "../workspace/identity"
import { getAgentConfig } from "../preferences"
import type {
  OpenworkMemoryContextSnapshot,
  OpenworkWorkspaceIdentity
} from "@shared/openwork-memory"
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
  runId: string | null
}

interface AgentRunOptions {
  onRunAccepted?: () => Promise<void> | void
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

function readOpenworkMemoryContextSnapshot(
  metadata: string | null | undefined
): OpenworkMemoryContextSnapshot | null {
  if (!metadata) {
    return null
  }

  const value = (JSON.parse(metadata) as Record<string, unknown>)[
    OPENWORK_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY
  ]

  return value && typeof value === "object" ? (value as OpenworkMemoryContextSnapshot) : null
}

function createWorkspaceMismatchError(input: {
  currentWorkspace: OpenworkWorkspaceIdentity
  snapshot: OpenworkMemoryContextSnapshot
}): OpenworkIpcError {
  return new OpenworkIpcError({
    channel: "agent:resume",
    code: "FAILED_PRECONDITION",
    details: [
      `originalWorkspace=${input.snapshot.canonicalWorkspacePath}`,
      `currentWorkspace=${input.currentWorkspace.canonicalWorkspacePath}`,
      "decision=return_to_original_workspace|fork_current_workspace|view_history_only|cancel"
    ],
    message:
      "This run was started in a different workspace. Return to the original workspace, fork this conversation for the current workspace, or view history only before resuming."
  })
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

  constructor(
    private readonly openworkMemoryService = new OpenworkMemoryService(),
    private readonly threadLifecycleGate = new ThreadLifecycleGate(),
    private readonly workspaceService?: WorkspaceService
  ) {}

  private sendThreadDeletingError(
    channel: "agent:invoke" | "agent:resume",
    sink: AgentStreamSink
  ): void {
    sink.send({
      type: "error",
      ...buildIpcErrorEvent(
        channel,
        new OpenworkIpcError({
          channel,
          code: "CONFLICT",
          message: "This thread is being deleted."
        })
      )
    })
  }

  private async claimThreadRun(
    threadId: string,
    channel: "agent:invoke" | "agent:resume",
    sink: AgentStreamSink
  ): Promise<ThreadRunLease | null> {
    const claim = await this.threadLifecycleGate.claimRun(threadId)
    if (claim.status === "deleting") {
      this.sendThreadDeletingError(channel, sink)
      return null
    }

    return claim.lease
  }

  private async recordOpenworkMemoryInclusions(input: {
    runtime: AgentRuntimeHandle
    runId: string
    threadId: string
  }): Promise<void> {
    try {
      await this.openworkMemoryService.recordInclusions({
        memoryIds: input.runtime.openworkMemoryInclusionCollector.getIncludedStructuredMemoryIds(),
        runId: input.runId,
        threadId: input.threadId
      })
    } catch (error) {
      console.error("[Agent] Failed to record Openwork memory inclusions:", error)
    }
  }

  async invoke(
    {
      threadId,
      message,
      modelId,
      permissionMode: requestedPermissionMode,
      temporaryMode = false
    }: AgentInvokeParams,
    sink: AgentStreamSink,
    options?: AgentRunOptions
  ): Promise<void> {
    const messagePreview = summarizeMessageContent(message.content)

    console.log("[Agent] Received invoke request:", {
      threadId,
      message: messagePreview.substring(0, 50),
      modelId,
      permissionMode: requestedPermissionMode
    })

    const lease = await this.claimThreadRun(threadId, "agent:invoke", sink)
    if (!lease) {
      return
    }
    const abortController = lease.abortController
    const activeRun: ActiveAgentRun = {
      controller: abortController,
      runId: null
    }
    this.activeRuns.set(threadId, activeRun)

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

      await options?.onRunAccepted?.()

      const normalizedRefs = normalizeComposerMessageRefs(message.additional_kwargs?.refs)
      const permissionMode = requestedPermissionMode ?? readThreadPermissionMode(thread)
      const locale = getAgentConfig().locale
      const aiCapabilities = resolveNativeExtensionAiCapabilitiesForRefs(normalizedRefs, {
        getConnection: (extensionName) =>
          resolveNativeExtensionConnection({
            extensionName,
            platform: process.platform
          }),
        locale,
        permissionMode,
        platform: process.platform
      })
      const aiCapabilityCatalog = listNativeExtensionAiCapabilityCatalog(process.platform, "en-US")
      const getAiCapabilityByExtensionName = (extensionName: string) =>
        resolveNativeExtensionAiCapabilityForExtensionName(extensionName, {
          getConnection: (extensionName) =>
            resolveNativeExtensionConnection({
              extensionName,
              platform: process.platform
            }),
          locale,
          permissionMode,
          platform: process.platform
        })
      const workspaceIdentity = await resolveOpenworkWorkspaceIdentity(workspacePath)
      const openworkMemoryContextPack = await this.openworkMemoryService.buildContextPack({
        temporaryMode,
        workspaceIdentity
      })

      if (abortController.signal.aborted) {
        return
      }

      const { runId } = await beginAgentRun(threadId, modelId, {
        openworkMemoryContextSnapshot:
          this.openworkMemoryService.createContextSnapshot(openworkMemoryContextPack),
        openworkMemoryTemporaryMode: openworkMemoryContextPack?.temporaryMode === true,
        aiCapabilities,
        permissionMode
      })
      activeRun.runId = runId
      sink.send({ type: "run_started", runId })

      if (abortController.signal.aborted) {
        return
      }

      const runtime = await createAgentRuntime({
        threadId,
        runId,
        workspacePath,
        modelId,
        openworkMemoryContextPack,
        openworkMemoryService: this.openworkMemoryService,
        openworkMemoryTemporaryMode: temporaryMode,
        openworkMemoryWorkspaceIdentity: workspaceIdentity,
        workspaceService: this.workspaceService,
        permissionMode,
        aiCapabilities,
        aiCapabilityCatalog,
        getAiCapabilityByExtensionName,
        getExtensionExecutionContext: (extensionName) =>
          resolveNativeExtensionExecutionContext({
            extensionName,
            platform: process.platform
          }),
        onLoadedAiCapabilitiesChanged: ({ aiCapabilities, runId }) =>
          updateRunExtensionAiCapabilitiesSnapshot(runId, {
            aiCapabilities
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

      const stream = await runtime.agent.stream(
        initialState,
        buildAgentRunConfig(threadId, runId, abortController, {
          modelId,
          permissionMode
        })
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
        await this.recordOpenworkMemoryInclusions({ runtime, runId, threadId })
        sink.send({ type: "done" })
      }
    } catch (error) {
      if (!isAbortLikeError(error, abortController.signal)) {
        const normalizedError = normalizeAgentRuntimeError("agent:invoke", error)
        if (activeRun.runId) {
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
      const currentRun = this.activeRuns.get(threadId)
      if (currentRun === activeRun && abortController.signal.aborted && activeRun.runId) {
        await markRunAborted(threadId, activeRun.runId)
      }
      if (this.activeRuns.get(threadId) === activeRun) {
        this.activeRuns.delete(threadId)
      }
      lease.complete()
    }
  }

  async resume(
    { threadId, command, modelId }: AgentResumeParams,
    sink: AgentStreamSink,
    options?: AgentRunOptions
  ): Promise<void> {
    console.log("[Agent] Received resume request:", { threadId, command, modelId })

    const lease = await this.claimThreadRun(threadId, "agent:resume", sink)
    if (!lease) {
      return
    }
    const abortController = lease.abortController
    const activeRun: ActiveAgentRun = {
      controller: abortController,
      runId: null
    }
    this.activeRuns.set(threadId, activeRun)
    const decision = command?.resume
    if (!decision) {
      if (this.activeRuns.get(threadId) === activeRun) {
        this.activeRuns.delete(threadId)
      }
      lease.complete()
      throw new Error("[Agent] Resume command is missing HITL decision.")
    }

    const decisionType = decision.type
    let runId: string | null = null

    try {
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

      const resumeTarget = await resolveResumeTarget(threadId, decision)
      const targetRun = await getRun(resumeTarget.runId)
      const targetOpenworkMemoryContextSnapshot = readOpenworkMemoryContextSnapshot(
        targetRun?.metadata
      )
      const currentWorkspaceIdentity = await resolveOpenworkWorkspaceIdentity(workspacePath)
      if (
        targetOpenworkMemoryContextSnapshot &&
        targetOpenworkMemoryContextSnapshot.workspaceKey !== currentWorkspaceIdentity.workspaceKey
      ) {
        throw createWorkspaceMismatchError({
          currentWorkspace: currentWorkspaceIdentity,
          snapshot: targetOpenworkMemoryContextSnapshot
        })
      }

      if (abortController.signal.aborted) {
        return
      }

      await options?.onRunAccepted?.()

      runId = await resumeAgentRun(threadId, resumeTarget.runId, {
        source: "resume",
        modelId: modelId ?? null,
        requestId: resumeTarget.requestId
      })

      activeRun.runId = runId
      sink.send({ type: "run_started", runId })

      if (abortController.signal.aborted) {
        return
      }

      const resumedRun = await getRun(runId)
      const permissionMode = readRunPermissionModeSnapshot(resumedRun)
      const resumedOpenworkMemoryContextSnapshot = readOpenworkMemoryContextSnapshot(
        resumedRun?.metadata
      )
      const openworkMemoryContextPack = this.openworkMemoryService.rebuildContextPackFromSnapshot(
        resumedOpenworkMemoryContextSnapshot
      )
      const resumedWorkspaceIdentity = await resolveOpenworkWorkspaceIdentity(workspacePath)
      const locale = getAgentConfig().locale
      const aiCapabilitySnapshots = readRunExtensionAiCapabilitiesSnapshotFromMetadata(
        resumedRun?.metadata
      )
      const runtimeAiCapabilities =
        aiCapabilitySnapshots === null
          ? []
          : hydrateNativeExtensionAiCapabilities(aiCapabilitySnapshots, locale)
      const runtime = await createAgentRuntime({
        threadId,
        runId,
        workspacePath,
        modelId,
        openworkMemoryContextPack,
        openworkMemoryService: this.openworkMemoryService,
        openworkMemoryTemporaryMode: openworkMemoryContextPack?.temporaryMode === true,
        openworkMemoryWorkspaceIdentity: resumedWorkspaceIdentity,
        permissionMode,
        aiCapabilities: runtimeAiCapabilities,
        aiCapabilityCatalog: listNativeExtensionAiCapabilityCatalog(process.platform, "en-US"),
        getAiCapabilityByExtensionName: (extensionName: string) =>
          resolveNativeExtensionAiCapabilityForExtensionName(extensionName, {
            getConnection: (extensionName) =>
              resolveNativeExtensionConnection({
                extensionName,
                platform: process.platform
              }),
            locale,
            permissionMode,
            platform: process.platform
          }),
        getExtensionExecutionContext: (extensionName) =>
          resolveNativeExtensionExecutionContext({
            extensionName,
            platform: process.platform
          }),
        onLoadedAiCapabilitiesChanged: ({ aiCapabilities, runId }) =>
          updateRunExtensionAiCapabilitiesSnapshot(runId, {
            aiCapabilities
          })
      })
      const config = buildAgentResumeConfig(threadId, runId, abortController, {
        modelId,
        permissionMode
      })
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
      const stream = await runtime.agent.stream(new Command({ resume: resumeValue }), config)
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
        await this.recordOpenworkMemoryInclusions({ runtime, runId, threadId })
        sink.send({ type: "done" })
      }
    } catch (error) {
      if (!isAbortLikeError(error, abortController.signal)) {
        if (runId) {
          const normalizedError = normalizeAgentRuntimeError("agent:resume", error)
          await markRunFailed(threadId, runId, normalizedError)
          if (!isModelAuthenticationError(error)) {
            console.error("[Agent] Resume error:", error)
          }
          sink.send({
            type: "error",
            ...buildIpcErrorEvent("agent:resume", normalizedError)
          })
          return
        }

        if (!isModelAuthenticationError(error)) {
          console.error("[Agent] Resume error:", error)
        }
        sink.send({
          type: "error",
          ...buildIpcErrorEvent("agent:resume", error)
        })
      }
    } finally {
      if (abortController.signal.aborted && runId) {
        await markRunAborted(threadId, runId)
      }
      if (this.activeRuns.get(threadId) === activeRun) {
        this.activeRuns.delete(threadId)
      }
      lease.complete()
    }
  }

  async cancel({ threadId }: AgentCancelParams): Promise<boolean> {
    const activeRun = this.activeRuns.get(threadId)
    if (!activeRun) {
      return false
    }

    activeRun.controller.abort()
    this.activeRuns.delete(threadId)
    if (activeRun.runId) {
      await markRunAborted(threadId, activeRun.runId)
    }
    return true
  }
}
