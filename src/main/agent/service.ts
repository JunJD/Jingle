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
import { isAbortLikeError, isModelAuthenticationError, toAgentRunFailure } from "./errors"
import type { AgentRunFailure } from "@shared/agent-run-failure"
import { createAgentRunHandle } from "./runtime"
import { createAgentRuntime } from "./runtime-assembly"
import { createExtensionAiRuntime } from "./extension-ai-runtime"
import { createNativeExtensionToolRegistry } from "../extension-tools/native-extension-tools"
import {
  createAgentRunSteeringBuffer,
  projectJingleStreamChunkForHostIpc,
  type AgentRunSteeringBuffer,
  type AppliedAgentSteer
} from "@jingle/langchain-agent-harness/transitional"
import type { RuntimeThreadRun } from "@jingle/langchain-agent-harness"
import type { JingleAgentSteerResult } from "@jingle/agent-client"
import { runtimeUsesCheckpointPersistence } from "../checkpointer/runtime-checkpointer-manager"
import {
  createAgentStreamBoundaryRecorderState,
  recordAgentStreamBoundaryEvents
} from "./event-recorder"
import { ThreadLifecycleGate, type ThreadRunLease } from "./thread-lifecycle-gate"
import { getHitlRequest } from "../db/hitl"
import { getRun } from "../db/runs"
import { getThread } from "../db/threads"
import { listProjectedThreadMessages } from "../db/message-state"
import { buildIpcErrorPayload, JingleIpcError } from "../ipc/error"
import { JingleMemoryService } from "../jingle-memory/service"
import { WorkspaceService } from "../workspace/service"
import { readRunPermissionModeSnapshot, readThreadPermissionMode } from "./permission-mode"
import { resolveJingleWorkspaceIdentity } from "../workspace/identity"
import { getAgentConfig, getDefaultModelId } from "../preferences"
import {
  listNativeExtensionManifests,
  readNativeExtensionMainDefinitionRegistrySnapshot
} from "../services/native-extensions"
import {
  listUnavailableExtensionMainDefinitions,
  type ExtensionMainDefinitionRegistrySnapshot
} from "../extensions/registry/main-definition-registry"
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
import type { AgentCommandOutcome } from "@shared/agent-command"

export type AgentStreamPayload =
  | { type: "done" }
  | { type: "cancelled" }
  | {
      type: "error"
      failure: AgentRunFailure
    }
  | {
      type: "run_rejected"
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
type AgentRunRejection = Extract<AgentCommandOutcome, { type: "rejected" }>
type AgentRunSteerContent = AgentInvokeMessage["content"]
type AgentRunSteerRefs = NonNullable<AgentInvokeMessage["refs"]>
type JingleAppliedAgentSteer = AppliedAgentSteer<AgentRunSteerContent, AgentRunSteerRefs>
type JingleAgentRunSteeringBuffer = AgentRunSteeringBuffer<AgentRunSteerContent, AgentRunSteerRefs>

interface AgentExtensionRegistryReader {
  listManifests: () => ReturnType<typeof listNativeExtensionManifests>
  readMainDefinitionSnapshot: () => ExtensionMainDefinitionRegistrySnapshot
}

const DEFAULT_AGENT_EXTENSION_REGISTRY_READER: AgentExtensionRegistryReader = {
  listManifests: () => listNativeExtensionManifests(process.platform),
  readMainDefinitionSnapshot: readNativeExtensionMainDefinitionRegistrySnapshot
}

interface ActiveAgentServiceRun {
  controller: AbortController
  markPreparationSettled(): void
  markSettled(): void
  preparationSettled: Promise<void>
  run: RuntimeThreadRun | null
  settled: Promise<void>
  steeringBuffer: JingleAgentRunSteeringBuffer
  turnId: string | null
}

function createActiveAgentServiceRun(input: {
  controller: AbortController
  steeringBuffer: JingleAgentRunSteeringBuffer
  turnId: string | null
}): ActiveAgentServiceRun {
  let markPreparationSettled!: () => void
  let markSettled!: () => void
  const preparationSettled = new Promise<void>((resolve) => {
    markPreparationSettled = resolve
  })
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve
  })

  return {
    ...input,
    markPreparationSettled,
    markSettled,
    preparationSettled,
    run: null,
    settled
  }
}

type ResolvedHitlDecision = Record<string, unknown> &
  HITLDecision & { request_id: string; tool_call_id: string }

interface AgentRunOptions<TAccepted = void> {
  channel?: AgentInvokeChannel
  getMessageIdsToRemove?: () => Promise<string[]>
  onCoreAdmitted?: () => void
  onCommandOutcome?: (outcome: AgentCommandOutcome) => void
  onRunAccepted?: (accepted: TAccepted) => void
  onSteersApplied?: (steers: JingleAppliedAgentSteer[]) => void
}

interface AgentCommandOutcomeReporter {
  hasReported(): boolean
  reject(channel: AgentRunChannel, error: unknown): void
  report(outcome: AgentCommandOutcome): void
  wasAccepted(): boolean
}

function createAgentCommandOutcomeReporter(
  onOutcome: ((outcome: AgentCommandOutcome) => void) | undefined
): AgentCommandOutcomeReporter {
  let accepted = false
  let reported = false
  const report = (outcome: AgentCommandOutcome): void => {
    if (reported) {
      throw new Error("Agent command reported more than one outcome.")
    }
    accepted = outcome.type === "accepted"
    reported = true
    onOutcome?.(outcome)
  }

  return {
    hasReported: () => reported,
    reject: (channel, error) => {
      report({
        error: buildIpcErrorPayload(channel, error),
        type: "rejected"
      })
    },
    report,
    wasAccepted: () => accepted
  }
}

function createAgentCommandCancelledError(channel: AgentRunChannel): JingleIpcError {
  return new JingleIpcError({
    channel,
    code: "CANCELLED",
    message: "Agent command was cancelled before execution started."
  })
}

/**
 * Stops awaiting a side-effect-free setup read when the run is cancelled.
 *
 * The operation may finish later, so callers must only use this for reads or
 * process-owned immutable caches. Both late fulfillment and rejection remain
 * observed by the attached handlers and cannot re-enter the run lifecycle.
 */
function awaitAbortableSetupRead<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (complete: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener("abort", handleAbort)
      complete()
    }
    const handleAbort = (): void => {
      finish(() => reject(signal.reason))
    }

    signal.addEventListener("abort", handleAbort, { once: true })
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted()
        return operation()
      })
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error))
      )
  })
}

interface AgentSteerActiveRunOptions {
  acceptedAt?: Date
  expectedRunId?: string | null
  expectedTurnId?: string | null
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
  toolCallId: string
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

  if (!request.tool_call_id) {
    throw new JingleIpcError({
      channel: "agent:resume",
      code: "FAILED_PRECONDITION",
      message: `[Agent] HITL request "${requestId}" is missing tool_call_id.`
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
    runId: request.run_id,
    toolCallId: request.tool_call_id
  }
}

async function resolveReportableRunError(input: {
  error: unknown
  executionStarted: boolean
  run: RuntimeThreadRun | null
  signal: AbortSignal
}): Promise<unknown | null> {
  if (!input.executionStarted && input.signal.aborted) {
    if (!input.run) {
      return null
    }
    try {
      await input.run.abort()
      return null
    } catch (abortError) {
      return abortError
    }
  }
  if (input.executionStarted) {
    return input.error
  }
  if (!input.run) {
    return isAbortLikeError(input.error, input.signal) ? null : input.error
  }

  try {
    return (await input.run.fail(input.error)) ? input.error : null
  } catch (settlementError) {
    return settlementError
  }
}

function reportAgentRuntimeError(input: {
  channel: AgentRunChannel
  error: unknown
  label: string
  sink: AgentStreamSink
}): void {
  const failure = toAgentRunFailure(input.channel, input.error)
  if (!isModelAuthenticationError(input.error)) {
    console.error(input.label, input.error)
  }
  input.sink.send({
    type: "error",
    failure
  })
}

function cloneStreamDataForIpc<T>(value: T): T {
  return structuredClone(value)
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

function readExtensionMainDefinitionsForRun(input: {
  channel: AgentRunChannel
  readSnapshot: () => ExtensionMainDefinitionRegistrySnapshot
  requiredExtensionNames: Iterable<string>
}) {
  const snapshot = input.readSnapshot()
  const unavailableDefinitions = listUnavailableExtensionMainDefinitions(
    snapshot,
    input.requiredExtensionNames
  )
  if (unavailableDefinitions.length > 0) {
    throw new JingleIpcError({
      channel: input.channel,
      code: "UNAVAILABLE",
      details: unavailableDefinitions.map(({ extensionName, state }) => {
        const stateDescription =
          state === "pending"
            ? "is still loading"
            : state === "failed"
              ? "failed to load"
              : "is not registered"
        return `Extension "${extensionName}" main definition ${stateDescription}.`
      }),
      message: "Required extension tools are not available for this run."
    })
  }

  return new Map(snapshot.definitions)
}

export class AgentService {
  private readonly activeRuns = new Map<string, ActiveAgentServiceRun>()
  private readonly agentRuntime: ReturnType<typeof createAgentRuntime>

  constructor(
    private readonly jingleMemoryService: JingleMemoryService,
    private readonly threadLifecycleGate: ThreadLifecycleGate,
    private readonly workspaceService: WorkspaceService,
    private readonly extensionRegistryReader: AgentExtensionRegistryReader = DEFAULT_AGENT_EXTENSION_REGISTRY_READER
  ) {
    this.agentRuntime = createAgentRuntime({
      jingleMemoryService,
      workspaceService
    })
  }

  private rejectThreadRun(input: {
    channel: AgentRunChannel
    code: "CONFLICT" | "UNAVAILABLE"
    message: string
    sink: AgentStreamSink
  }): AgentRunRejection {
    const error = buildIpcErrorPayload(
      input.channel,
      new JingleIpcError({
        channel: input.channel,
        code: input.code,
        message: input.message
      })
    )
    input.sink.send({
      error: error.message,
      type: "run_rejected",
      ...error
    })
    return { error, type: "rejected" }
  }

  private sendThreadDeletingError(
    channel: AgentRunChannel,
    sink: AgentStreamSink
  ): AgentRunRejection {
    return this.rejectThreadRun({
      channel,
      code: "CONFLICT",
      message: "This thread is being deleted.",
      sink
    })
  }

  private sendApplicationShuttingDownError(
    channel: AgentRunChannel,
    sink: AgentStreamSink
  ): AgentRunRejection {
    return this.rejectThreadRun({
      channel,
      code: "UNAVAILABLE",
      message: "The application is shutting down.",
      sink
    })
  }

  private sendThreadRunActiveError(
    channel: AgentRunChannel,
    sink: AgentStreamSink
  ): AgentRunRejection {
    return this.rejectThreadRun({
      channel,
      code: "CONFLICT",
      message: "Agent run is already in progress; follow-ups must be queued or steered.",
      sink
    })
  }

  private async claimThreadRun(
    threadId: string,
    channel: AgentRunChannel,
    sink: AgentStreamSink
  ): Promise<
    | { lease: ThreadRunLease; outcome: Extract<AgentCommandOutcome, { type: "accepted" }> }
    | { lease: null; outcome: Extract<AgentCommandOutcome, { type: "rejected" }> }
  > {
    const claim = await this.threadLifecycleGate.claimRun(threadId)
    if (claim.status === "shutting_down") {
      return {
        lease: null,
        outcome: this.sendApplicationShuttingDownError(channel, sink)
      }
    }

    if (claim.status === "deleting") {
      return {
        lease: null,
        outcome: this.sendThreadDeletingError(channel, sink)
      }
    }

    if (claim.status === "running") {
      return {
        lease: null,
        outcome: this.sendThreadRunActiveError(channel, sink)
      }
    }

    return {
      lease: claim.lease,
      outcome: { disposition: "run", type: "accepted" }
    }
  }

  private dispatchRun(
    channel: AgentRunChannel,
    start: (reportOutcome: (outcome: AgentCommandOutcome) => void) => Promise<void>
  ): Promise<AgentCommandOutcome> {
    return new Promise<AgentCommandOutcome>((resolve) => {
      let outcomeReported = false
      const reportOutcome = (outcome: AgentCommandOutcome): void => {
        if (outcomeReported) {
          throw new Error("Agent command reported more than one outcome.")
        }
        outcomeReported = true
        resolve(outcome)
      }

      try {
        void start(reportOutcome).then(
          () => {
            if (!outcomeReported) {
              resolve({
                error: buildIpcErrorPayload(
                  channel,
                  new Error("Agent command completed without reporting an outcome.")
                ),
                type: "rejected"
              })
            }
          },
          (error: unknown) => {
            if (!outcomeReported) {
              resolve({
                error: buildIpcErrorPayload(channel, error),
                type: "rejected"
              })
            }
          }
        )
      } catch (error) {
        resolve({
          error: buildIpcErrorPayload(channel, error),
          type: "rejected"
        })
      }
    })
  }

  dispatchInvoke(
    params: AgentInvokeParams,
    sink: AgentStreamSink,
    options?: Omit<AgentRunOptions, "onCommandOutcome">
  ): Promise<AgentCommandOutcome> {
    return this.dispatchRun("agent:invoke", (reportOutcome) => {
      return this.invoke(params, sink, { ...options, onCommandOutcome: reportOutcome })
    })
  }

  dispatchEditLastUserMessageAndInvoke(
    params: AgentEditLastUserMessageAndInvokeParams,
    sink: AgentStreamSink,
    options?: Omit<AgentRunOptions, "onCommandOutcome">
  ): Promise<AgentCommandOutcome> {
    return this.dispatchRun("agent:editLastUserMessageAndInvoke", (reportOutcome) => {
      return this.editLastUserMessageAndInvoke(params, sink, {
        ...options,
        onCommandOutcome: reportOutcome
      })
    })
  }

  dispatchResume(
    params: AgentResumeParams,
    sink: AgentStreamSink,
    options?: Omit<AgentRunOptions<ResolvedHitlDecision>, "onCommandOutcome">
  ): Promise<AgentCommandOutcome> {
    return this.dispatchRun("agent:resume", (reportOutcome) => {
      return this.resume(params, sink, { ...options, onCommandOutcome: reportOutcome })
    })
  }

  async shutdown(): Promise<void> {
    await this.threadLifecycleGate.shutdown()
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
      modelId: requestedModelId,
      permissionMode: requestedPermissionMode,
      temporaryMode = false
    }: AgentInvokeParams,
    sink: AgentStreamSink,
    options?: AgentRunOptions
  ): Promise<void> {
    const channel = options?.channel ?? "agent:invoke"
    const commandOutcome = createAgentCommandOutcomeReporter(options?.onCommandOutcome)
    const modelId = requestedModelId ?? getDefaultModelId("llm")
    const messagePreview = summarizeMessageContent(message.content)

    console.log("[Agent] Received invoke request:", {
      channel,
      threadId,
      message: messagePreview.substring(0, 50),
      modelId,
      permissionMode: requestedPermissionMode
    })

    const claim = await this.claimThreadRun(threadId, channel, sink)
    const lease = claim.lease
    if (!lease) {
      commandOutcome.report(claim.outcome)
      return
    }
    const abortController = lease.abortController
    const activeRun = createActiveAgentServiceRun({
      controller: abortController,
      steeringBuffer: createAgentRunSteeringBuffer({
        onSteersApplied: options?.onSteersApplied
      }),
      turnId: message.id
    })
    let commandRejectionError: unknown = null
    let didReportRuntimeError = false
    let runExecutionStarted = false
    this.activeRuns.set(threadId, activeRun)
    options?.onCoreAdmitted?.()

    try {
      const thread = await awaitAbortableSetupRead(abortController.signal, () =>
        getThread(threadId)
      )
      const workspacePath = await awaitAbortableSetupRead(abortController.signal, () =>
        this.workspaceService.getWorkspacePath(threadId)
      )

      if (!workspacePath) {
        const error = new JingleIpcError({
          channel,
          code: "FAILED_PRECONDITION",
          message: "Please select a workspace folder before sending messages."
        })
        commandOutcome.reject(channel, error)
        return
      }

      const normalizedRefs = normalizeComposerMessageRefs(message.refs)
      const messageIdsToRemove = options?.getMessageIdsToRemove
        ? await awaitAbortableSetupRead(abortController.signal, options.getMessageIdsToRemove)
        : []

      const permissionMode = requestedPermissionMode ?? readThreadPermissionMode(thread)
      const locale = getAgentConfig().locale
      const extensionManifests = this.extensionRegistryReader.listManifests()
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
      const extensionMainDefinitions = readExtensionMainDefinitionsForRun({
        channel,
        readSnapshot: this.extensionRegistryReader.readMainDefinitionSnapshot,
        requiredExtensionNames: aiCapabilities.map(({ extensionName }) => extensionName)
      })
      const extensionToolRegistry = createNativeExtensionToolRegistry({
        definitions: extensionMainDefinitions,
        manifests: extensionManifests
      })
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
      const workspaceIdentity = await awaitAbortableSetupRead(abortController.signal, () =>
        resolveJingleWorkspaceIdentity(workspacePath, { signal: abortController.signal })
      )
      const jingleMemoryContextPack = await awaitAbortableSetupRead(abortController.signal, () =>
        this.jingleMemoryService.buildContextPack({
          signal: abortController.signal,
          temporaryMode,
          workspaceIdentity
        })
      )
      const extensionAiRuntime = createExtensionAiRuntime({
        aiCapabilities,
        aiCapabilityCatalog: extensionToolRegistry.withCatalogToolAccess(aiCapabilityCatalog),
        getAiCapabilityByExtensionName,
        getExtensionExecutionContext: (extensionName) =>
          resolveNativeExtensionExecutionContext({
            extensionName,
            platform: process.platform
          }),
        onLoadedAiCapabilitiesChanged: ({ aiCapabilities, runId }) =>
          updateRunExtensionAiCapabilitiesSnapshot(runId, {
            aiCapabilities
          }),
        registry: extensionToolRegistry,
        threadId,
        workspacePath
      })

      if (abortController.signal.aborted) {
        return
      }

      abortController.signal.throwIfAborted()
      const runHandle = createAgentRunHandle({
        jingleMemoryService: this.jingleMemoryService,
        runtime: this.agentRuntime,
        threadId,
        steeringBuffer: activeRun.steeringBuffer,
        workspacePath
      })

      if (abortController.signal.aborted) {
        return
      }

      const run = await runHandle.thread.startInvoke({
        aiCapabilities,
        extensionAiRuntime,
        jingleMemoryContextPack,
        jingleMemoryContextSnapshot:
          this.jingleMemoryService.createContextSnapshot(jingleMemoryContextPack),
        jingleMemoryTemporaryMode: jingleMemoryContextPack?.temporaryMode === true,
        modelId,
        permissionMode,
        userMessage: {
          contentPreview: messagePreview,
          id: message.id,
          refs: normalizedRefs
        },
        workspaceIdentity
      })
      activeRun.run = run
      const { runId } = run
      if (abortController.signal.aborted) {
        activeRun.markPreparationSettled()
        await run.abort()
        return
      }
      const providedInclusions = jingleMemoryContextPack
        ? buildProvidedContextInclusions({
            contextPack: jingleMemoryContextPack,
            runId,
            threadId
          })
        : []
      abortController.signal.throwIfAborted()
      options?.onRunAccepted?.()
      commandOutcome.report(claim.outcome)
      abortController.signal.throwIfAborted()
      activeRun.markPreparationSettled()
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

      const boundaryRecorderState = createAgentStreamBoundaryRecorderState({
        targetTurnId: message.id
      })
      runExecutionStarted = true
      const result = await run.execute({
        contextInclusions: providedInclusions,
        expectedMessageId: message.id,
        message: {
          content: message.content,
          id: message.id,
          refs: normalizedRefs
        },
        onChunk: async (chunk) => {
          abortController.signal.throwIfAborted()
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
        removeMessageIds: messageIdsToRemove,
        signal: abortController.signal,
        steeringBuffer: activeRun.steeringBuffer,
        title: initialTitle
      })
      activeRun.steeringBuffer.close()

      if (result.status === "completed") {
        sink.send({ type: "done" })
      }
    } catch (error) {
      activeRun.steeringBuffer.close()
      activeRun.markPreparationSettled()
      if (!commandOutcome.hasReported()) {
        commandRejectionError = abortController.signal.aborted
          ? createAgentCommandCancelledError(channel)
          : error
      }
      const reportableError = await resolveReportableRunError({
        error,
        executionStarted: runExecutionStarted,
        run: activeRun.run,
        signal: abortController.signal
      })
      if (reportableError && commandOutcome.wasAccepted()) {
        didReportRuntimeError = true
        reportAgentRuntimeError({
          channel,
          error: reportableError,
          label: "[Agent] Error:",
          sink
        })
      }
    } finally {
      activeRun.steeringBuffer.close()
      activeRun.markPreparationSettled()
      if (
        !commandOutcome.hasReported() &&
        commandRejectionError === null &&
        abortController.signal.aborted
      ) {
        commandRejectionError = createAgentCommandCancelledError(channel)
      }
      try {
        const currentRun = this.activeRuns.get(threadId)
        if (currentRun === activeRun && abortController.signal.aborted && activeRun.run) {
          try {
            await activeRun.run.abort()
          } catch (error) {
            if (!didReportRuntimeError) {
              reportAgentRuntimeError({
                channel,
                error,
                label: "[Agent] Abort persistence error:",
                sink
              })
            }
          }
        }
      } finally {
        if (this.activeRuns.get(threadId) === activeRun) {
          this.activeRuns.delete(threadId)
        }
        try {
          lease.complete()
        } finally {
          activeRun.markSettled()
          if (!commandOutcome.hasReported() && commandRejectionError !== null) {
            commandOutcome.reject(channel, commandRejectionError)
          }
        }
      }
    }
  }

  async resume(
    { threadId, decision, modelId: requestedModelId }: AgentResumeParams,
    sink: AgentStreamSink,
    options?: AgentRunOptions<ResolvedHitlDecision>
  ): Promise<void> {
    const channel = "agent:resume" as const
    const commandOutcome = createAgentCommandOutcomeReporter(options?.onCommandOutcome)
    console.log("[Agent] Received resume request:", {
      threadId,
      decision,
      modelId: requestedModelId
    })

    const claim = await this.claimThreadRun(threadId, "agent:resume", sink)
    const lease = claim.lease
    if (!lease) {
      commandOutcome.report(claim.outcome)
      return
    }
    const abortController = lease.abortController
    const activeRun = createActiveAgentServiceRun({
      controller: abortController,
      steeringBuffer: createAgentRunSteeringBuffer({
        onSteersApplied: options?.onSteersApplied
      }),
      turnId: null
    })
    let commandRejectionError: unknown = null
    let didReportRuntimeError = false
    let runExecutionStarted = false
    this.activeRuns.set(threadId, activeRun)
    options?.onCoreAdmitted?.()
    try {
      const workspacePath = await awaitAbortableSetupRead(abortController.signal, () =>
        this.workspaceService.getWorkspacePath(threadId)
      )

      if (!workspacePath) {
        const error = new JingleIpcError({
          channel,
          code: "FAILED_PRECONDITION",
          message: "Workspace path is required"
        })
        commandOutcome.reject(channel, error)
        return
      }

      const resumeTarget = await awaitAbortableSetupRead(abortController.signal, () =>
        resolveResumeTarget(threadId, decision)
      )
      const targetRun = await awaitAbortableSetupRead(abortController.signal, () =>
        getRun(resumeTarget.runId)
      )
      const targetJingleMemoryContextSnapshot = readJingleMemoryContextSnapshot(targetRun?.metadata)
      const currentWorkspaceIdentity = await awaitAbortableSetupRead(abortController.signal, () =>
        resolveJingleWorkspaceIdentity(workspacePath, { signal: abortController.signal })
      )
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

      const sourceRun = await awaitAbortableSetupRead(abortController.signal, () =>
        getRun(resumeTarget.runId)
      )
      if (!sourceRun) {
        throw new Error(`[Agent] Missing resume source run "${resumeTarget.runId}".`)
      }
      const modelId = requestedModelId ?? getDefaultModelId("llm")
      const permissionMode = readRunPermissionModeSnapshot(sourceRun)
      const resumedJingleMemoryContextSnapshot = readJingleMemoryContextSnapshot(sourceRun.metadata)
      const jingleMemoryContextPack = this.jingleMemoryService.rebuildContextPackFromSnapshot(
        resumedJingleMemoryContextSnapshot
      )
      const resumedWorkspaceIdentity = await awaitAbortableSetupRead(abortController.signal, () =>
        resolveJingleWorkspaceIdentity(workspacePath, { signal: abortController.signal })
      )
      const locale = getAgentConfig().locale
      const extensionManifests = this.extensionRegistryReader.listManifests()
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
      const aiCapabilityCatalog = listNativeExtensionAiCapabilityCatalogFromManifests(
        extensionManifests,
        process.platform,
        "en-US"
      )
      const extensionMainDefinitions = readExtensionMainDefinitionsForRun({
        channel,
        readSnapshot: this.extensionRegistryReader.readMainDefinitionSnapshot,
        requiredExtensionNames: runtimeAiCapabilities.map(({ extensionName }) => extensionName)
      })
      const extensionToolRegistry = createNativeExtensionToolRegistry({
        definitions: extensionMainDefinitions,
        manifests: extensionManifests
      })
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
      const extensionAiRuntime = createExtensionAiRuntime({
        aiCapabilities: runtimeAiCapabilities,
        aiCapabilityCatalog: extensionToolRegistry.withCatalogToolAccess(aiCapabilityCatalog),
        getAiCapabilityByExtensionName,
        getExtensionExecutionContext: (extensionName) =>
          resolveNativeExtensionExecutionContext({
            extensionName,
            platform: process.platform
          }),
        onLoadedAiCapabilitiesChanged: ({ aiCapabilities, runId }) =>
          updateRunExtensionAiCapabilitiesSnapshot(runId, {
            aiCapabilities
          }),
        registry: extensionToolRegistry,
        threadId,
        workspacePath
      })
      abortController.signal.throwIfAborted()
      const runHandle = createAgentRunHandle({
        jingleMemoryService: this.jingleMemoryService,
        runtime: this.agentRuntime,
        threadId,
        steeringBuffer: activeRun.steeringBuffer,
        workspacePath
      })

      if (abortController.signal.aborted) {
        return
      }

      const resolvedHitlDecision: ResolvedHitlDecision =
        decision.type === "corrected"
          ? {
              correction: decision.correction,
              request_id: resumeTarget.requestId,
              tool_call_id: resumeTarget.toolCallId,
              type: "corrected"
            }
          : {
              request_id: resumeTarget.requestId,
              tool_call_id: resumeTarget.toolCallId,
              type: decision.type
            }
      const run = await runHandle.thread.startResume({
        aiCapabilities: runtimeAiCapabilities,
        decision: resolvedHitlDecision,
        extensionAiRuntime,
        jingleMemoryContextPack,
        jingleMemoryTemporaryMode: jingleMemoryContextPack?.temporaryMode === true,
        modelId,
        permissionMode,
        runId: resumeTarget.runId,
        source: "resume",
        workspaceIdentity: resumedWorkspaceIdentity
      })
      activeRun.run = run
      const resumedRunId = run.runId
      let didSendResumedRunStarted = false
      const sendResumedRunStarted = (): void => {
        if (didSendResumedRunStarted) {
          return
        }
        didSendResumedRunStarted = true
        sink.send({ type: "run_started", runId: resumedRunId })
      }
      const acceptCommittedResumeDecision = (): void => {
        options?.onRunAccepted?.(resolvedHitlDecision)
        sendResumedRunStarted()
        commandOutcome.report(claim.outcome)
      }
      if (abortController.signal.aborted) {
        activeRun.markPreparationSettled()
        await run.abort()
        return
      }

      const resumeContextInclusions = jingleMemoryContextPack
        ? buildProvidedContextInclusions({
            contextPack: jingleMemoryContextPack,
            runId: resumedRunId,
            threadId
          })
        : []
      abortController.signal.throwIfAborted()
      activeRun.markPreparationSettled()

      const boundaryRecorderState = createAgentStreamBoundaryRecorderState({
        initialToolCallIds: [resumeTarget.toolCallId]
      })
      runExecutionStarted = true
      const result = await run.execute({
        contextInclusions: resumeContextInclusions,
        onDecisionCommitted: acceptCommittedResumeDecision,
        onChunk: async (chunk) => {
          abortController.signal.throwIfAborted()
          sendResumedRunStarted()
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
        signal: abortController.signal,
        steeringBuffer: activeRun.steeringBuffer
      })
      activeRun.steeringBuffer.close()

      if (result.status === "completed") {
        sendResumedRunStarted()
        sink.send({ type: "done" })
      } else if (result.status === "cancelled") {
        sendResumedRunStarted()
        sink.send({ type: "cancelled" })
      }
    } catch (error) {
      activeRun.steeringBuffer.close()
      activeRun.markPreparationSettled()
      if (!commandOutcome.hasReported()) {
        commandRejectionError = abortController.signal.aborted
          ? createAgentCommandCancelledError(channel)
          : error
      }
      const reportableError = await resolveReportableRunError({
        error,
        executionStarted: runExecutionStarted,
        run: activeRun.run,
        signal: abortController.signal
      })
      if (reportableError && commandOutcome.wasAccepted()) {
        didReportRuntimeError = true
        reportAgentRuntimeError({
          channel: "agent:resume",
          error: reportableError,
          label: "[Agent] Resume error:",
          sink
        })
      }
    } finally {
      activeRun.steeringBuffer.close()
      activeRun.markPreparationSettled()
      if (
        !commandOutcome.hasReported() &&
        commandRejectionError === null &&
        abortController.signal.aborted
      ) {
        commandRejectionError = createAgentCommandCancelledError(channel)
      }
      try {
        const currentRun = this.activeRuns.get(threadId)
        if (currentRun === activeRun && abortController.signal.aborted && activeRun.run) {
          try {
            await activeRun.run.abort()
          } catch (error) {
            if (!didReportRuntimeError) {
              reportAgentRuntimeError({
                channel: "agent:resume",
                error,
                label: "[Agent] Resume abort persistence error:",
                sink
              })
            }
          }
        }
      } finally {
        if (this.activeRuns.get(threadId) === activeRun) {
          this.activeRuns.delete(threadId)
        }
        try {
          lease.complete()
        } finally {
          activeRun.markSettled()
          if (!commandOutcome.hasReported() && commandRejectionError !== null) {
            commandOutcome.reject(channel, commandRejectionError)
          }
        }
      }
    }
  }

  async cancel({ threadId }: AgentCancelParams): Promise<boolean> {
    const activeRun = this.activeRuns.get(threadId)
    if (!activeRun) {
      return false
    }
    if (activeRun.controller.signal.aborted) {
      await activeRun.settled
      return false
    }

    activeRun.controller.abort()
    let didAbort = true
    try {
      await activeRun.preparationSettled
      if (activeRun.run) {
        didAbort = await activeRun.run.abort()
      }
    } finally {
      await activeRun.settled
    }
    return didAbort
  }

  steerActiveRun(
    threadId: string,
    message: AgentInvokeParams["message"],
    options: AgentSteerActiveRunOptions = {}
  ): JingleAgentSteerResult {
    const activeRun = this.activeRuns.get(threadId)
    if (!activeRun || activeRun.controller.signal.aborted) {
      return { reason: "no_active_run", type: "rejected" }
    }
    const activeRunId = activeRun.run?.runId ?? null

    if (
      options.expectedTurnId &&
      activeRun.turnId !== null &&
      activeRun.turnId !== options.expectedTurnId
    ) {
      return {
        reason: "active_turn_mismatch",
        runId: activeRunId,
        turnId: activeRun.turnId,
        type: "rejected"
      }
    }

    if (options.expectedRunId && activeRunId !== null && activeRunId !== options.expectedRunId) {
      return {
        reason: "active_run_mismatch",
        runId: activeRunId,
        turnId: activeRun.turnId,
        type: "rejected"
      }
    }

    const accepted = activeRun.steeringBuffer.accept({
      acceptedAt: options.acceptedAt,
      message: {
        content: message.content,
        id: message.id,
        refs: normalizeComposerMessageRefs(message.refs),
        text: extractMessageText(message.content).trim()
      },
      runId: activeRunId
    })
    if (!accepted) {
      return { reason: "no_active_run", type: "rejected" }
    }
    return { runId: accepted.runId, turnId: activeRun.turnId, type: "accepted" }
  }
}
