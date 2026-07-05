import {
  extractMessageText,
  normalizeComposerMessageRefs,
  summarizeMessageContent,
  type AgentInvokeMessage
} from "@shared/message-content"
import {
  buildProvidedContextInclusions,
  readJingleMemoryContextSnapshotFromMetadata
} from "@shared/jingle-memory"
import { readRunExtensionAiCapabilitiesSnapshotFromMetadata } from "@shared/extension-sources"
import { shouldAutoGenerateThreadTitle } from "@shared/thread-title"
import {
  hydrateNativeExtensionAiCapabilitiesFromManifests,
  listNativeExtensionAiCapabilityCatalogFromManifests,
  resolveNativeExtensionAiCapabilityForExtensionNameFromManifests,
  resolveNativeExtensionAiCapabilitiesForRefsFromManifests
} from "@extensions/sources"
import { resolveNativeExtensionConnection } from "../native-extensions/connection-resolver"
import { resolveNativeExtensionExecutionContext } from "../native-extensions/execution-context"
import { updateRunExtensionAiCapabilitiesSnapshot } from "./persistence"
import { isAbortLikeError, isModelAuthenticationError, normalizeAgentRuntimeError } from "./errors"
import { createAgentRunHandle } from "./runtime"
import {
  createAgentRunSteeringBuffer,
  projectJingleStreamChunkForHostIpc,
  type AgentRunSteeringBuffer,
  type AppliedAgentSteer
} from "@jingle/langchain-agent-harness/transitional"
import type { RuntimeThread } from "@jingle/langchain-agent-harness"
import { runtimeUsesCheckpointPersistence } from "../checkpointer/runtime-checkpointer-manager"
import type {
  JingleInvokeRunLifecycleInput,
  JingleResumeRunLifecycleInput
} from "./run-lifecycle-controller"
import {
  createAgentStreamBoundaryRecorderState,
  recordAgentStreamBoundaryEvents,
  recordApprovalResolved,
  recordRunResumed,
  recordRunStarted,
  recordUserMessageCreated
} from "./event-recorder"
import { ThreadLifecycleGate, type ThreadRunLease } from "./thread-lifecycle-gate"
import { getHitlRequest, resolveHitlRequest } from "../db/hitl"
import { getRun } from "../db/runs"
import { getThread } from "../db/threads"
import { listProjectedThreadMessages } from "../db/message-state"
import { buildIpcErrorEvent, JingleIpcError } from "../ipc/error"
import { JingleMemoryService } from "../jingle-memory/service"
import { WorkspaceService } from "../workspace/service"
import { readRunPermissionModeSnapshot, readThreadPermissionMode } from "./permission-mode"
import { resolveJingleWorkspaceIdentity } from "../workspace/identity"
import { getAgentConfig } from "../preferences"
import { listNativeExtensionManifests } from "../services/native-extensions"
import type {
  AgentContextInclusion,
  JingleMemoryContextSnapshot,
  JingleWorkspaceIdentity
} from "@shared/jingle-memory"
import type {
  AgentCancelParams,
  AgentEditLastUserMessageAndInvokeParams,
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
  | { type: "context_inclusions"; inclusions: AgentContextInclusion[] }
  | { type: "stream"; data: unknown; mode: string }

export interface AgentStreamSink {
  send: (payload: AgentStreamPayload) => void
}

type AgentInvokeChannel = "agent:editLastUserMessageAndInvoke" | "agent:invoke"
type AgentRunChannel = AgentInvokeChannel | "agent:resume"
type AgentStreamChunk = [mode: string, data: unknown]
type JingleRuntimeThread = RuntimeThread<
  AgentContextInclusion,
  JingleInvokeRunLifecycleInput,
  JingleResumeRunLifecycleInput
>
type AgentRunSteerContent = AgentInvokeMessage["content"]
type AgentRunSteerRefs = NonNullable<AgentInvokeMessage["refs"]>
type JingleAppliedAgentSteer = AppliedAgentSteer<AgentRunSteerContent, AgentRunSteerRefs>
type JingleAgentRunSteeringBuffer = AgentRunSteeringBuffer<
  AgentRunSteerContent,
  AgentRunSteerRefs
>

interface ActiveAgentServiceRun {
  controller: AbortController
  runId: string | null
  thread: JingleRuntimeThread | null
  steeringBuffer: JingleAgentRunSteeringBuffer
}

interface AgentRunOptions {
  channel?: AgentInvokeChannel
  getMessageIdsToRemove?: () => Promise<string[]>
  onRunAccepted?: () => Promise<void> | void
  onSteersApplied?: (steers: JingleAppliedAgentSteer[]) => Promise<void> | void
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

async function readMessageIdsAfterLatestUserMessage(input: {
  channel: AgentInvokeChannel
  messageId: string
  threadId: string
}): Promise<string[]> {
  if (!runtimeUsesCheckpointPersistence()) {
    throw new JingleIpcError({
      channel: input.channel,
      code: "FAILED_PRECONDITION",
      message: "Editing the last user message requires checkpoint persistence."
    })
  }

  const messages = await listProjectedThreadMessages(input.threadId)
  const latestUserMessageIndex = messages.findLastIndex((message) => message.role === "user")
  const latestUserMessage = messages[latestUserMessageIndex]
  if (!latestUserMessage) {
    throw new JingleIpcError({
      channel: input.channel,
      code: "FAILED_PRECONDITION",
      message: "Cannot edit the last user message because this thread has no user message."
    })
  }

  if (latestUserMessage.message_id !== input.messageId) {
    throw new JingleIpcError({
      channel: input.channel,
      code: "FAILED_PRECONDITION",
      details: [
        `latestUserMessageId=${latestUserMessage.message_id}`,
        `requestedMessageId=${input.messageId}`
      ],
      message: "Only the latest user message can be edited and resent."
    })
  }

  const messageIdsToRemove = Array.from(
    new Set(messages.slice(latestUserMessageIndex + 1).map((message) => message.message_id))
  )

  return messageIdsToRemove
}

interface ResumeTarget {
  requestId: string
  runId: string
}

function readJingleMemoryContextSnapshot(
  metadata: string | null | undefined
): JingleMemoryContextSnapshot | null {
  if (!metadata) {
    return null
  }

  return readJingleMemoryContextSnapshotFromMetadata(
    JSON.parse(metadata) as Record<string, unknown>
  )
}

function createWorkspaceMismatchError(input: {
  currentWorkspace: JingleWorkspaceIdentity
  snapshot: JingleMemoryContextSnapshot
}): JingleIpcError {
  return new JingleIpcError({
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
    throw new JingleIpcError({
      channel: "agent:resume",
      code: "INVALID_ARGUMENT",
      message: "[Agent] HITL resume requires request_id."
    })
  }

  const request = await getHitlRequest(requestId)
  if (!request) {
    throw new JingleIpcError({
      channel: "agent:resume",
      code: "NOT_FOUND",
      message: `[Agent] HITL request "${requestId}" not found.`
    })
  }

  if (request.thread_id !== threadId) {
    throw new JingleIpcError({
      channel: "agent:resume",
      code: "INVALID_ARGUMENT",
      message: `[Agent] HITL request "${requestId}" belongs to thread "${request.thread_id}", not "${threadId}".`
    })
  }

  if (request.status !== "pending") {
    throw new JingleIpcError({
      channel: "agent:resume",
      code: "CONFLICT",
      message: `[Agent] HITL request "${requestId}" is already "${request.status}", expected pending.`
    })
  }

  if (!request.run_id) {
    throw new JingleIpcError({
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
    throw new JingleIpcError({
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

function cloneStreamDataForIpc<T>(value: T): T {
  return structuredClone(value)
}

function requireActiveRunThread(input: {
  runId: string
  thread: JingleRuntimeThread | null
}): JingleRuntimeThread {
  if (!input.thread) {
    throw new Error(`[Agent] Active run "${input.runId}" has no harness thread.`)
  }
  return input.thread
}

export function serializeStreamChunkForIpc(
  mode: string,
  data: unknown,
  options?: {
    runId?: string
    threadId?: string
  }
): unknown {
  return cloneStreamDataForIpc(
    projectJingleStreamChunkForHostIpc({
      data,
      mode,
      runId: options?.runId,
      threadId: options?.threadId
    })
  )
}

export class AgentService {
  private readonly activeRuns = new Map<string, ActiveAgentServiceRun>()

  constructor(
    private readonly jingleMemoryService: JingleMemoryService,
    private readonly threadLifecycleGate: ThreadLifecycleGate,
    private readonly workspaceService: WorkspaceService
  ) {}

  private sendThreadDeletingError(channel: AgentRunChannel, sink: AgentStreamSink): void {
    sink.send({
      type: "error",
      ...buildIpcErrorEvent(
        channel,
        new JingleIpcError({
          channel,
          code: "CONFLICT",
          message: "This thread is being deleted."
        })
      )
    })
  }

  private async claimThreadRun(
    threadId: string,
    channel: AgentRunChannel,
    sink: AgentStreamSink
  ): Promise<ThreadRunLease | null> {
    const claim = await this.threadLifecycleGate.claimRun(threadId)
    if (claim.status === "deleting") {
      this.sendThreadDeletingError(channel, sink)
      return null
    }

    return claim.lease
  }

  async editLastUserMessageAndInvoke(
    params: AgentEditLastUserMessageAndInvokeParams,
    sink: AgentStreamSink,
    options?: AgentRunOptions
  ): Promise<void> {
    await this.invoke(params, sink, {
      ...options,
      channel: "agent:editLastUserMessageAndInvoke",
      getMessageIdsToRemove: () =>
        readMessageIdsAfterLatestUserMessage({
          channel: "agent:editLastUserMessageAndInvoke",
          messageId: params.message.id,
          threadId: params.threadId
        })
    })
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
    const channel = options?.channel ?? "agent:invoke"
    const messagePreview = summarizeMessageContent(message.content)

    console.log("[Agent] Received invoke request:", {
      channel,
      threadId,
      message: messagePreview.substring(0, 50),
      modelId,
      permissionMode: requestedPermissionMode
    })

    const lease = await this.claimThreadRun(threadId, channel, sink)
    if (!lease) {
      return
    }
    const abortController = lease.abortController
    const activeRun: ActiveAgentServiceRun = {
      controller: abortController,
      runId: null,
      thread: null,
      steeringBuffer: createAgentRunSteeringBuffer({
        onSteersApplied: options?.onSteersApplied
      })
    }
    this.activeRuns.set(threadId, activeRun)

    try {
      const thread = await getThread(threadId)
      const workspacePath = await this.workspaceService.getWorkspacePath(threadId)

      if (!workspacePath) {
        sink.send({
          type: "error",
          ...buildIpcErrorEvent(
            channel,
            new JingleIpcError({
              channel,
              code: "FAILED_PRECONDITION",
              message: "Please select a workspace folder before sending messages."
            })
          )
        })
        return
      }

      const normalizedRefs = normalizeComposerMessageRefs(message.refs)
      const messageIdsToRemove = (await options?.getMessageIdsToRemove?.()) ?? []

      await options?.onRunAccepted?.()

      const permissionMode = requestedPermissionMode ?? readThreadPermissionMode(thread)
      const locale = getAgentConfig().locale
      const extensionManifests = listNativeExtensionManifests(process.platform)
      const aiCapabilities = resolveNativeExtensionAiCapabilitiesForRefsFromManifests(
        normalizedRefs,
        extensionManifests,
        {
          getConnection: (extensionName) =>
            resolveNativeExtensionConnection({
              extensionName,
              platform: process.platform
            }),
          locale,
          permissionMode,
          platform: process.platform
        }
      )
      const aiCapabilityCatalog = listNativeExtensionAiCapabilityCatalogFromManifests(
        extensionManifests,
        process.platform,
        "en-US"
      )
      const getAiCapabilityByExtensionName = (extensionName: string) =>
        resolveNativeExtensionAiCapabilityForExtensionNameFromManifests(
          extensionName,
          extensionManifests,
          {
            getConnection: (extensionName) =>
              resolveNativeExtensionConnection({
                extensionName,
                platform: process.platform
              }),
            locale,
            permissionMode,
            platform: process.platform
          }
        )
      const workspaceIdentity = await resolveJingleWorkspaceIdentity(workspacePath)
      const jingleMemoryContextPack = await this.jingleMemoryService.buildContextPack({
        temporaryMode,
        workspaceIdentity
      })

      if (abortController.signal.aborted) {
        return
      }

      const runHandle = await createAgentRunHandle({
        threadId,
        workspacePath,
        modelId,
        runtimeModules: {
          approval: {
            permissionMode
          },
          extensionAi: {
            capabilityCatalog: aiCapabilityCatalog,
            capabilitySnapshot: aiCapabilities,
            getCapabilityByExtensionName: getAiCapabilityByExtensionName,
            getExecutionContext: (extensionName) =>
              resolveNativeExtensionExecutionContext({
                extensionName,
                platform: process.platform
              }),
            onLoadedCapabilitiesChanged: ({ aiCapabilities, runId }) =>
              updateRunExtensionAiCapabilitiesSnapshot(runId, {
                aiCapabilities
              })
          },
          memory: {
            contextPack: jingleMemoryContextPack,
            service: this.jingleMemoryService,
            temporaryMode,
            workspaceIdentity
          },
          workspaceContext: {
            service: this.workspaceService
          }
        },
        steeringBuffer: activeRun.steeringBuffer,
      })
      activeRun.thread = runHandle.thread

      if (abortController.signal.aborted) {
        return
      }

      const { recordingRefs, runId } = await runHandle.thread.beginInvokeRun({
        invoke: {
          jingleMemoryContextSnapshot:
            this.jingleMemoryService.createContextSnapshot(jingleMemoryContextPack),
          jingleMemoryTemporaryMode: jingleMemoryContextPack?.temporaryMode === true,
          aiCapabilities,
          modelId,
          permissionMode
        }
      })
      activeRun.runId = runId
      const providedInclusions = jingleMemoryContextPack
        ? buildProvidedContextInclusions({
            contextPack: jingleMemoryContextPack,
            runId,
            threadId
          })
        : []
      await recordRunStarted({
        modelId,
        permissionMode,
        runId,
        threadId,
        userMessageId: message.id
      })
      await recordUserMessageCreated({
        contentPreview: messagePreview,
        refs: normalizedRefs,
        runId,
        threadId,
        userMessageId: message.id
      })
      sink.send({ type: "run_started", runId })

      if (providedInclusions.length > 0) {
        sink.send({ type: "context_inclusions", inclusions: providedInclusions })
      }

      if (abortController.signal.aborted) {
        return
      }

      const threadMetadata = thread?.metadata
        ? (JSON.parse(thread.metadata) as Record<string, unknown>)
        : {}
      const initialTitle =
        thread?.title &&
        !shouldAutoGenerateThreadTitle({
          metadata: threadMetadata,
          title: thread.title
        })
          ? thread.title
          : null

      const stream = await runHandle.thread.invoke(
        {
          contextInclusions: providedInclusions,
          message: {
            content: message.content,
            id: message.id,
            refs: normalizedRefs
          },
          modelId,
          recordingRefs,
          removeMessageIds: messageIdsToRemove,
          runId,
          steeringBuffer: activeRun.steeringBuffer,
          title: initialTitle
        },
        {
          signal: abortController.signal
        }
      )
      const boundaryRecorderState = createAgentStreamBoundaryRecorderState()

      const { interrupted } = await runHandle.thread.drainRunStream<AgentStreamChunk>({
        onChunk: async (chunk) => {
          const [mode, data] = chunk
          const serializedData = serializeStreamChunkForIpc(mode, data, { threadId, runId })
          sink.send({
            type: "stream",
            mode,
            data: serializedData
          })
          await recordAgentStreamBoundaryEvents({
            data: serializedData,
            mode,
            modelId,
            runId,
            state: boundaryRecorderState,
            threadId
          })
        },
        runId,
        signal: abortController.signal,
        stream: stream as AsyncIterable<AgentStreamChunk>
      })

      if (!abortController.signal.aborted) {
        await runHandle.thread.completeRun({
          expectedMessageId: message.id,
          interrupted,
          runId,
          submittedContextInclusions: providedInclusions,
          submittedRecordingRefs: recordingRefs
        })
        sink.send({ type: "done" })
      }
    } catch (error) {
      if (!isAbortLikeError(error, abortController.signal)) {
        const normalizedError = normalizeAgentRuntimeError(channel, error)
        if (activeRun.runId) {
          const runFailure = {
            error: normalizedError,
            runId: activeRun.runId
          }
          await requireActiveRunThread({
            runId: activeRun.runId,
            thread: activeRun.thread
          }).failRun(runFailure)
        }
        if (!isModelAuthenticationError(error)) {
          console.error("[Agent] Error:", error)
        }
        sink.send({
          type: "error",
          ...buildIpcErrorEvent(channel, normalizedError)
        })
      }
    } finally {
      const currentRun = this.activeRuns.get(threadId)
      if (currentRun === activeRun && abortController.signal.aborted && activeRun.runId) {
        await requireActiveRunThread({
          runId: activeRun.runId,
          thread: activeRun.thread
        }).abortRun({
          runId: activeRun.runId
        })
      }
      if (this.activeRuns.get(threadId) === activeRun) {
        this.activeRuns.delete(threadId)
      }
      lease.complete()
    }
  }

  async resume(
    { threadId, decision, modelId }: AgentResumeParams,
    sink: AgentStreamSink,
    options?: AgentRunOptions
  ): Promise<void> {
    console.log("[Agent] Received resume request:", { threadId, decision, modelId })

    const lease = await this.claimThreadRun(threadId, "agent:resume", sink)
    if (!lease) {
      return
    }
    const abortController = lease.abortController
    const activeRun: ActiveAgentServiceRun = {
      controller: abortController,
      runId: null,
      thread: null,
      steeringBuffer: createAgentRunSteeringBuffer({
        onSteersApplied: options?.onSteersApplied
      })
    }
    this.activeRuns.set(threadId, activeRun)
    const decisionType = decision.type
    let runId: string | null = null

    try {
      const workspacePath = await this.workspaceService.getWorkspacePath(threadId)

      if (!workspacePath) {
        sink.send({
          type: "error",
          ...buildIpcErrorEvent(
            "agent:resume",
            new JingleIpcError({
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
      const targetJingleMemoryContextSnapshot = readJingleMemoryContextSnapshot(targetRun?.metadata)
      const currentWorkspaceIdentity = await resolveJingleWorkspaceIdentity(workspacePath)
      if (
        targetJingleMemoryContextSnapshot &&
        targetJingleMemoryContextSnapshot.workspaceKey !== currentWorkspaceIdentity.workspaceKey
      ) {
        throw createWorkspaceMismatchError({
          currentWorkspace: currentWorkspaceIdentity,
          snapshot: targetJingleMemoryContextSnapshot
        })
      }

      if (abortController.signal.aborted) {
        return
      }

      await options?.onRunAccepted?.()

      const sourceRun = await getRun(resumeTarget.runId)
      if (!sourceRun) {
        throw new Error(`[Agent] Missing resume source run "${resumeTarget.runId}".`)
      }
      const permissionMode = readRunPermissionModeSnapshot(sourceRun)
      const resumedJingleMemoryContextSnapshot = readJingleMemoryContextSnapshot(
        sourceRun.metadata
      )
      const jingleMemoryContextPack = this.jingleMemoryService.rebuildContextPackFromSnapshot(
        resumedJingleMemoryContextSnapshot
      )
      const resumedWorkspaceIdentity = await resolveJingleWorkspaceIdentity(workspacePath)
      const locale = getAgentConfig().locale
      const extensionManifests = listNativeExtensionManifests(process.platform)
      const aiCapabilitySnapshots = readRunExtensionAiCapabilitiesSnapshotFromMetadata(
        sourceRun.metadata
      )
      const runtimeAiCapabilities =
        aiCapabilitySnapshots === null
          ? []
          : hydrateNativeExtensionAiCapabilitiesFromManifests(
              aiCapabilitySnapshots,
              extensionManifests,
              locale
      )
      const runHandle = await createAgentRunHandle({
        threadId,
        workspacePath,
        modelId,
        runtimeModules: {
          approval: {
            permissionMode
          },
          extensionAi: {
            capabilityCatalog: listNativeExtensionAiCapabilityCatalogFromManifests(
              extensionManifests,
              process.platform,
              "en-US"
            ),
            capabilitySnapshot: runtimeAiCapabilities,
            getCapabilityByExtensionName: (extensionName: string) =>
              resolveNativeExtensionAiCapabilityForExtensionNameFromManifests(
                extensionName,
                extensionManifests,
                {
                  getConnection: (extensionName) =>
                    resolveNativeExtensionConnection({
                      extensionName,
                      platform: process.platform
                    }),
                  locale,
                  permissionMode,
                  platform: process.platform
                }
              ),
            getExecutionContext: (extensionName) =>
              resolveNativeExtensionExecutionContext({
                extensionName,
                platform: process.platform
              }),
            onLoadedCapabilitiesChanged: ({ aiCapabilities, runId }) =>
              updateRunExtensionAiCapabilitiesSnapshot(runId, {
                aiCapabilities
              })
          },
          memory: {
            contextPack: jingleMemoryContextPack,
            service: this.jingleMemoryService,
            temporaryMode: jingleMemoryContextPack?.temporaryMode === true,
            workspaceIdentity: resumedWorkspaceIdentity
          },
          workspaceContext: {
            service: this.workspaceService
          }
        },
        steeringBuffer: activeRun.steeringBuffer,
      })
      activeRun.thread = runHandle.thread

      if (abortController.signal.aborted) {
        return
      }

      const { recordingRefs, runId: resumedRunId } = await runHandle.thread.beginResumeRun({
        resume: {
          modelId,
          requestId: resumeTarget.requestId,
          runId: resumeTarget.runId,
          source: "resume"
        }
      })
      runId = resumedRunId
      activeRun.runId = resumedRunId

      const resumeContextInclusions = jingleMemoryContextPack
        ? buildProvidedContextInclusions({
            contextPack: jingleMemoryContextPack,
            runId: resumedRunId,
            threadId
          })
        : []
      await recordRunResumed({
        modelId,
        requestId: resumeTarget.requestId,
        runId: resumedRunId,
        threadId
      })
      sink.send({ type: "run_started", runId: resumedRunId })

      if (abortController.signal.aborted) {
        return
      }

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
        await recordApprovalResolved({
          decision,
          requestId: resumeTarget.requestId,
          runId: resumedRunId,
          threadId
        })
      }
      const stream = await runHandle.thread.resume(
        {
          contextInclusions: resumeContextInclusions,
          decision: resolvedHitlDecision,
          modelId,
          recordingRefs,
          runId: resumedRunId,
          steeringBuffer: activeRun.steeringBuffer
        },
        {
          signal: abortController.signal
        }
      )
      const boundaryRecorderState = createAgentStreamBoundaryRecorderState()

      const drainResult = await runHandle.thread.drainRunStream<AgentStreamChunk>({
        beforePendingHitlPersistence: resolveConsumedHitlRequest,
        onChunk: async (chunk) => {
          const [mode, data] = chunk
          const serializedData = serializeStreamChunkForIpc(mode, data, {
            threadId,
            runId: resumedRunId
          })
          sink.send({
            type: "stream",
            mode,
            data: serializedData
          })
          await recordAgentStreamBoundaryEvents({
            data: serializedData,
            mode,
            modelId,
            runId: resumedRunId,
            state: boundaryRecorderState,
            threadId
          })
        },
        runId: resumedRunId,
        signal: abortController.signal,
        stream: stream as AsyncIterable<AgentStreamChunk>
      })
      const { interrupted } = drainResult

      if (!abortController.signal.aborted) {
        if (!drainResult.beforePendingHitlPersistenceApplied) {
          await resolveConsumedHitlRequest()
        }
        await runHandle.thread.completeRun({
          interrupted,
          runId: resumedRunId,
          submittedContextInclusions: resumeContextInclusions,
          submittedRecordingRefs: recordingRefs
        })
        sink.send({ type: "done" })
      }
    } catch (error) {
      if (!isAbortLikeError(error, abortController.signal)) {
        if (runId) {
          const normalizedError = normalizeAgentRuntimeError("agent:resume", error)
          const runFailure = {
            error: normalizedError,
            runId
          }
          await requireActiveRunThread({
            runId,
            thread: activeRun.thread
          }).failRun(runFailure)
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
      const currentRun = this.activeRuns.get(threadId)
      if (currentRun === activeRun && abortController.signal.aborted && runId) {
        await requireActiveRunThread({
          runId,
          thread: activeRun.thread
        }).abortRun({ runId })
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
      await requireActiveRunThread({
        runId: activeRun.runId,
        thread: activeRun.thread
      }).abortRun({
        runId: activeRun.runId
      })
    }
    return true
  }

  async steerActiveRun(
    threadId: string,
    message: AgentInvokeParams["message"],
    options: { acceptedAt?: Date; onBeforeAccept?: () => Promise<void> | void } = {}
  ): Promise<ReturnType<JingleAgentRunSteeringBuffer["accept"]> | null> {
    const activeRun = this.activeRuns.get(threadId)
    if (!activeRun) {
      return null
    }

    await options.onBeforeAccept?.()

    return activeRun.steeringBuffer.accept({
      acceptedAt: options.acceptedAt,
      message: {
        content: message.content,
        id: message.id,
        refs: normalizeComposerMessageRefs(message.refs),
        text: extractMessageText(message.content).trim()
      },
      runId: activeRun.runId
    })
  }
}
