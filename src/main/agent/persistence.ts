import { randomUUID } from "crypto"
import type { HITLDecision } from "@shared/hitl"
import type { ModelRuntimeSelection } from "@shared/app-types"
import {
  readRunModelRuntimeSelection,
  withModelRuntimeSelection
} from "@shared/model-runtime-selection"
import { AGENT_RUN_FAILURE_METADATA_KEY, type AgentRunFailure } from "@shared/agent-run-failure"
import { buildJingleCheckpointLookupConfig } from "@jingle/langchain-agent-harness/transitional"
import {
  createRunExtensionAiCapabilitiesSnapshot,
  RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY,
  type ResolvedExtensionAiCapability
} from "@shared/extension-sources"
import { getRun, mapRunRow, updateRun } from "../db/runs"
import { getPrismaClient } from "../db/client"
import {
  appendAgentEventsInTransaction,
  commitAgentEventProjectionState,
  reserveUserMessageAdmissionSequence,
  type AppendAgentEventInput
} from "../db/agent-events"
import { serializeJsonValue } from "../db/utils"
import { getThread, updateThread } from "../db/threads"
import { parsePersistedHitlAllowedDecisions } from "../db/hitl"
import { getCheckpointer } from "../checkpointer/runtime-checkpointer-manager"
import { JingleIpcError } from "../ipc/error"
import { commitRunFailureTerminalInTransaction } from "../db/run-failure-terminal"
import { extractThreadFactsFromCheckpoint } from "./runtime-state"
import { listCanonicalMainThreadMessages } from "../db/message-state"
import { shouldAutoGenerateThreadTitle } from "@shared/thread-title"
import type { PermissionModeName } from "@shared/permission-mode"
import { DEFAULT_PERMISSION_MODE } from "@shared/permission-mode"
import { mergeRunMetadata, RUN_PERMISSION_MODE_SNAPSHOT_METADATA_KEY } from "./permission-mode"
import {
  JINGLE_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY,
  JINGLE_MEMORY_TEMPORARY_MODE_METADATA_KEY,
  type JingleMemoryContextSnapshot
} from "@shared/jingle-memory"
import {
  createApprovalResolvedEventInput,
  createRunFinishedEventInput,
  createRunInterruptedEventInput,
  createRunResumedEventInput,
  createRunStartedEventInput,
  createUserMessageCreatedEventInput
} from "./event-recorder"
import type { RunModelRuntimeSelectionResumeAdmission } from "../model-provider/runtime-selection-admission"
import { isDurableTerminalRunFinishedPayload } from "./run-lifecycle-facts"

type PersistedRunStatus = "pending" | "running" | "error" | "success" | "interrupted" | "cancelled"
type ExistingRun = NonNullable<Awaited<ReturnType<typeof getRun>>>
type AgentRunCheckpointFacts = ReturnType<typeof extractThreadFactsFromCheckpoint>

export interface SyncedRunCheckpointFacts {
  facts: AgentRunCheckpointFacts
  hasCheckpoint: boolean
  status: PersistedRunStatus
}

interface BeginAgentRunOptions {
  aiCapabilities?: ResolvedExtensionAiCapability[]
  jingleMemoryContextSnapshot?: JingleMemoryContextSnapshot | null
  jingleMemoryTemporaryMode?: boolean
  permissionMode?: PermissionModeName
  startEvent: {
    composerText?: string
    contentPreview: string
    refs: unknown[]
    removeMessageIds?: string[]
    userMessageId: string
  }
}

const runMetadataUpdateQueues = new Map<string, Promise<unknown>>()
export async function beginAgentRun(
  threadId: string,
  selection: ModelRuntimeSelection,
  options: BeginAgentRunOptions
): Promise<{
  admission: { eventId: string; sequence: number }
  run: ExistingRun
  runId: string
}> {
  const runId = randomUUID()
  const permissionMode = options?.permissionMode ?? DEFAULT_PERMISSION_MODE
  const aiCapabilities = options?.aiCapabilities ?? []

  const metadata = withModelRuntimeSelection(
    {
      [RUN_PERMISSION_MODE_SNAPSHOT_METADATA_KEY]: permissionMode,
      [JINGLE_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY]: options?.jingleMemoryContextSnapshot ?? null,
      [JINGLE_MEMORY_TEMPORARY_MODE_METADATA_KEY]: options?.jingleMemoryTemporaryMode ?? false,
      [RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY]:
        createRunExtensionAiCapabilitiesSnapshot({
          aiCapabilities,
          runId
        })
    },
    selection
  )
  const runStartedEventInput = createRunStartedEventInput({
    permissionMode,
    runId,
    selection: requireReadyRunModelRuntimeSelection(metadata),
    threadId,
    userMessageId: options.startEvent.userMessageId
  })
  const startEventInputsRef: { current: AppendAgentEventInput[] | null } = { current: null }
  const admissionRef: { current: { eventId: string; sequence: number } | null } = {
    current: null
  }
  const prisma = getPrismaClient()
  // Admission owns one durable commit; cancellation retains the run lease until it settles.
  const run = await prisma.$transaction(async (transaction) => {
    const now = BigInt(Date.now())
    const admissionSequence = await reserveUserMessageAdmissionSequence(transaction, threadId, now)
    const admission = { eventId: randomUUID(), sequence: admissionSequence }
    admissionRef.current = admission
    const startEventInputs = [
      runStartedEventInput,
      createUserMessageCreatedEventInput({
        admission,
        composerText: options.startEvent.composerText,
        contentPreview: options.startEvent.contentPreview,
        refs: options.startEvent.refs,
        removeMessageIds: options.startEvent.removeMessageIds ?? [],
        runId,
        threadId,
        userMessageId: options.startEvent.userMessageId
      })
    ]
    const row = await transaction.run.create({
      data: {
        assistantId: null,
        createdAt: now,
        kwargs: null,
        metadata: serializeJsonValue(metadata),
        runId,
        status: "running",
        threadId,
        updatedAt: now
      }
    })
    await appendAgentEventsInTransaction(transaction, startEventInputs, { now })
    startEventInputsRef.current = startEventInputs
    await transaction.thread.update({
      data: {
        status: "busy",
        updatedAt: now
      },
      where: { threadId }
    })
    return mapRunRow(row)
  })
  if (!startEventInputsRef.current || admissionRef.current === null) {
    throw new Error("[AgentPersistence] Missing committed invoke admission events.")
  }
  commitAgentEventProjectionState(startEventInputsRef.current)

  return {
    admission: admissionRef.current,
    run,
    runId
  }
}

export async function updateRunExtensionAiCapabilitiesSnapshot(
  runId: string,
  input: {
    aiCapabilities: ResolvedExtensionAiCapability[]
  }
): Promise<void> {
  await updateRunMetadata(runId, {
    merge: (run) =>
      mergeRunExtensionAiCapabilitiesSnapshotMetadata(run, {
        aiCapabilities: input.aiCapabilities,
        runId
      })
  })
}

async function updateRunMetadata(
  runId: string,
  input: {
    merge: (run: ExistingRun) => Record<string, unknown>
    status?: string
  }
): Promise<void> {
  await withRunMetadataLock(runId, async () => {
    const run = await getRun(runId)
    if (!run) {
      return
    }

    await updateRun(runId, {
      ...(input.status !== undefined ? { status: input.status } : {}),
      metadata: input.merge(run)
    })
  })
}

async function withRunMetadataLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
  const previous = runMetadataUpdateQueues.get(runId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)

  runMetadataUpdateQueues.set(runId, next)
  try {
    return await next
  } finally {
    if (runMetadataUpdateQueues.get(runId) === next) {
      runMetadataUpdateQueues.delete(runId)
    }
  }
}

function parsePersistedRunMetadataForResume(run: ExistingRun): Record<string, unknown> {
  if (run.metadata === null) {
    return {}
  }

  try {
    const parsed = JSON.parse(run.metadata) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Report the durable fact as invalid below.
  }
  throw new JingleIpcError({
    channel: "agent:resume",
    code: "FAILED_PRECONDITION",
    message: "The source run metadata is invalid and cannot be resumed safely."
  })
}

function requireReadyRunModelRuntimeSelection(
  metadata: Record<string, unknown>
): ModelRuntimeSelection {
  const state = readRunModelRuntimeSelection(metadata)
  if (state.kind !== "ready") {
    throw new Error("Run admission is missing its canonical model runtime selection.")
  }
  return state.selection
}

function isSameModelRuntimeSelection(
  left: ModelRuntimeSelection,
  right: ModelRuntimeSelection
): boolean {
  return (
    left.version === right.version &&
    left.modelId === right.modelId &&
    left.thinkingEffort === right.thinkingEffort
  )
}

function mergeRunResumeMetadata(
  run: ExistingRun,
  metadata: Record<string, unknown> | undefined,
  admission: RunModelRuntimeSelectionResumeAdmission
): { metadata: Record<string, unknown>; selection: ModelRuntimeSelection } {
  const persistedMetadata = parsePersistedRunMetadataForResume(run)
  const state = readRunModelRuntimeSelection(persistedMetadata)
  let selection: ModelRuntimeSelection
  if (admission.kind === "persisted") {
    if (
      state.kind !== "ready" ||
      !isSameModelRuntimeSelection(state.selection, admission.selection)
    ) {
      throw new JingleIpcError({
        channel: "agent:resume",
        code: "CONFLICT",
        message: "The source run model runtime selection changed before resume admission."
      })
    }
    selection = state.selection
  } else {
    if (
      state.kind !== "legacy_missing_effort" ||
      state.modelId !== admission.expectedLegacyModelId
    ) {
      throw new JingleIpcError({
        channel: "agent:resume",
        code: "CONFLICT",
        message: "The source run legacy model identity changed before recovery admission."
      })
    }
    selection = admission.selection
  }

  const merged = removeRunFailureMetadata({ ...persistedMetadata, ...(metadata ?? {}) })
  return {
    metadata:
      admission.kind === "legacy_upgrade" ? withModelRuntimeSelection(merged, selection) : merged,
    selection
  }
}

function removeRunFailureMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const next = { ...metadata }
  delete next[AGENT_RUN_FAILURE_METADATA_KEY]
  delete next.error
  return next
}

function mergeRunMetadataWithoutFailure(run: ExistingRun): Record<string, unknown> {
  return removeRunFailureMetadata(mergeRunMetadata(run, {}))
}

function mergeRunExtensionAiCapabilitiesSnapshotMetadata(
  run: ExistingRun,
  input: {
    aiCapabilities: ResolvedExtensionAiCapability[]
    runId: string
  }
): Record<string, unknown> {
  return mergeRunMetadata(run, {
    [RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY]: createRunExtensionAiCapabilitiesSnapshot(
      {
        aiCapabilities: input.aiCapabilities,
        runId: input.runId
      }
    )
  })
}

export async function commitAgentResumeDecision(
  threadId: string,
  runId: string,
  decision: HITLDecision & { request_id: string; tool_call_id: string },
  metadata: Record<string, unknown> | undefined,
  options: {
    modelRuntimeSelectionAdmission?: RunModelRuntimeSelectionResumeAdmission
  }
): Promise<{ run: ExistingRun; runId: string } | null> {
  const approvalEvent = createApprovalResolvedEventInput({
    decision,
    requestId: decision.request_id,
    runId,
    threadId
  })
  const eventInputsRef: { current: AppendAgentEventInput[] | null } = { current: null }

  const committed = await withRunMetadataLock(runId, async () => {
    const prisma = getPrismaClient()
    return prisma.$transaction(async (transaction) => {
      const request = await transaction.hitlRequest.findUnique({
        where: { requestId: decision.request_id }
      })
      if (!request) {
        throw new Error(`[Agent] Cannot resume missing HITL request "${decision.request_id}".`)
      }
      if (
        request.threadId !== threadId ||
        request.runId !== runId ||
        request.toolCallId !== decision.tool_call_id
      ) {
        throw new Error(
          `[Agent] HITL request "${decision.request_id}" does not match its resume owner.`
        )
      }
      if (request.status !== "pending") {
        return null
      }

      const allowedDecisions = parsePersistedHitlAllowedDecisions(
        request.requestId,
        request.allowedDecisions
      )
      if (!allowedDecisions.includes(decision.type)) {
        throw new Error(
          `[Agent] HITL request "${decision.request_id}" does not allow decision "${decision.type}".`
        )
      }

      const existingRow = await transaction.run.findUnique({ where: { runId } })
      if (!existingRow) {
        throw new Error(`[Agent] Cannot resume missing run "${runId}".`)
      }
      const existing = mapRunRow(existingRow)
      if (existing.thread_id !== threadId) {
        throw new Error(
          `[Agent] Cannot resume run "${runId}" from thread "${threadId}"; actual thread is "${existing.thread_id}".`
        )
      }
      const finishedEvents = await transaction.agentEvent.findMany({
        select: { payload: true },
        where: { runId, type: "run.finished" }
      })
      if (finishedEvents.some((event) => isDurableTerminalRunFinishedPayload(event.payload))) {
        throw new JingleIpcError({
          channel: "agent:resume",
          code: "CONFLICT",
          message: `[Agent] Cannot resume terminal run "${runId}".`
        })
      }
      if (existing.status && !["pending", "running", "interrupted"].includes(existing.status)) {
        throw new Error(`[Agent] Cannot resume run "${runId}" from status "${existing.status}".`)
      }

      const now = BigInt(Date.now())
      const terminalDecline = decision.type === "user_declined"
      const resumeMutation = terminalDecline
        ? null
        : options.modelRuntimeSelectionAdmission
          ? mergeRunResumeMetadata(existing, metadata, options.modelRuntimeSelectionAdmission)
          : (() => {
              throw new JingleIpcError({
                channel: "agent:resume",
                code: "FAILED_PRECONDITION",
                message: "Resume admission is missing its model runtime selection."
              })
            })()
      const eventInputs: AppendAgentEventInput[] = terminalDecline
        ? [
            approvalEvent,
            createRunFinishedEventInput({
              completionReason: "user_declined",
              runId,
              status: "cancelled",
              threadId
            })
          ]
        : [
            approvalEvent,
            createRunResumedEventInput({
              requestId: decision.request_id,
              runId,
              selection: resumeMutation!.selection,
              threadId
            })
          ]
      const resolution = await transaction.hitlRequest.updateMany({
        data: {
          decision: serializeJsonValue(decision),
          resolvedAt: now,
          status:
            decision.type === "approve"
              ? "approved"
              : decision.type === "user_declined"
                ? "user_declined"
                : "corrected",
          updatedAt: now
        },
        where: {
          requestId: decision.request_id,
          status: "pending"
        }
      })
      if (resolution.count === 0) {
        return null
      }

      const updatedRow = await transaction.run.update({
        data: {
          metadata: serializeJsonValue(
            terminalDecline ? mergeRunMetadataWithoutFailure(existing) : resumeMutation!.metadata
          ),
          ...(terminalDecline
            ? { status: "cancelled" }
            : {
                status: "running"
              }),
          updatedAt: now
        },
        where: { runId }
      })
      await appendAgentEventsInTransaction(transaction, eventInputs, { now })
      eventInputsRef.current = eventInputs
      await transaction.thread.update({
        data: {
          status: terminalDecline ? "idle" : "busy",
          updatedAt: now
        },
        where: { threadId }
      })
      return mapRunRow(updatedRow)
    })
  })

  if (!committed) {
    return null
  }
  if (!eventInputsRef.current) {
    throw new Error("Resume admission committed without its durable event batch.")
  }
  commitAgentEventProjectionState(eventInputsRef.current)
  return { run: committed, runId }
}

export async function syncRunFromLatestCheckpointFacts(
  threadId: string,
  runId: string,
  options?: {
    expectedMessageId?: string
    interrupted?: boolean
  }
): Promise<SyncedRunCheckpointFacts> {
  await commitRunLifecycleTerminal({
    operation: "complete",
    runId,
    status: options?.interrupted ? "interrupted" : "success",
    threadId
  })

  try {
    return await projectRunCompletionCheckpointFacts(threadId, runId, options)
  } catch (error) {
    console.error(
      `[Agent] Run "${runId}" reached durable terminal state but checkpoint projection failed:`,
      error
    )
    return {
      facts: extractThreadFactsFromCheckpoint(threadId, undefined, { runId }),
      hasCheckpoint: false,
      status: options?.interrupted ? "interrupted" : "success"
    }
  }
}

export async function projectRunCompletionCheckpointFacts(
  threadId: string,
  runId: string,
  options?: {
    expectedMessageId?: string
    interrupted?: boolean
  }
): Promise<SyncedRunCheckpointFacts> {
  const checkpointer = await getCheckpointer(threadId)
  const latest = await checkpointer.getTuple(
    buildJingleCheckpointLookupConfig({
      checkpointRunId: runId,
      threadId
    })
  )
  if (!latest && !options?.interrupted) {
    throw new Error(`[Agent] Missing checkpoint for run "${runId}" in thread "${threadId}".`)
  }
  if (options?.expectedMessageId) {
    const canonicalMessages = await listCanonicalMainThreadMessages(threadId)
    const includesMessage = canonicalMessages.some(
      (message) => message.message_id === options.expectedMessageId
    )
    if (!includesMessage) {
      throw new Error(
        `[Agent] Canonical message state for run "${runId}" does not include submitted message "${options.expectedMessageId}".`
      )
    }
  }

  const facts = extractThreadFactsFromCheckpoint(threadId, latest, { runId })
  if (facts.title !== null) {
    const thread = await getThread(threadId)
    const shouldSyncTitle = shouldAutoGenerateThreadTitle({
      metadata: thread?.metadata ? JSON.parse(thread.metadata) : undefined,
      title: thread?.title ?? undefined
    })
    if (shouldSyncTitle) {
      await updateThread(threadId, { title: facts.title })
    }
  }
  return {
    facts,
    hasCheckpoint: latest !== undefined,
    status: options?.interrupted ? "interrupted" : "success"
  }
}

export async function syncRunFromLatestCheckpoint(
  threadId: string,
  runId: string,
  options?: {
    expectedMessageId?: string
    interrupted?: boolean
  }
): Promise<PersistedRunStatus> {
  const synced = await syncRunFromLatestCheckpointFacts(threadId, runId, options)
  return synced.status
}

export async function finalizeRunWithoutCheckpoint(
  threadId: string,
  runId: string,
  options?: {
    interrupted?: boolean
  }
): Promise<PersistedRunStatus> {
  const status: PersistedRunStatus = options?.interrupted ? "interrupted" : "success"
  await commitRunLifecycleTerminal({
    operation: "complete",
    runId,
    status,
    threadId
  })

  return status
}

export async function markRunFailed(
  threadId: string,
  runId: string,
  failure: AgentRunFailure
): Promise<"error" | "interrupted"> {
  const terminal = await withRunMetadataLock(runId, async () => {
    const prisma = getPrismaClient()
    return prisma.$transaction(async (transaction) => {
      const existingRow = await transaction.run.findUnique({ where: { runId } })
      if (!existingRow) {
        throw new Error(`[Agent] Cannot fail missing run "${runId}".`)
      }
      const existing = mapRunRow(existingRow)
      if (existing.thread_id !== threadId) {
        throw new Error(
          `[Agent] Cannot fail run "${runId}" from thread "${threadId}"; actual thread is "${existing.thread_id}".`
        )
      }
      const [pendingHitlCount, latestLifecycleEvent] = await Promise.all([
        transaction.hitlRequest.count({
          where: { runId, status: "pending", threadId }
        }),
        transaction.agentEvent.findFirst({
          orderBy: { seq: "desc" },
          select: { type: true },
          where: {
            runId,
            type: { in: ["run.started", "run.resumed", "run.finished"] }
          }
        })
      ])
      const canCommitFailure =
        existing.status === "pending" ||
        existing.status === "running" ||
        (existing.status === "interrupted" && pendingHitlCount > 0)
      if (!canCommitFailure || latestLifecycleEvent?.type === "run.finished") {
        throw new JingleIpcError({
          channel: "agent:runtime",
          code: "CONFLICT",
          message: `[Agent] Cannot fail run "${runId}" from settled status "${existing.status ?? "unknown"}".`
        })
      }

      const status: "error" | "interrupted" = pendingHitlCount > 0 ? "interrupted" : "error"
      const event = await commitRunFailureTerminalInTransaction(transaction, {
        expectedRunStatus: existing.status!,
        failure,
        runId,
        runMetadata: existing.metadata,
        status,
        threadId
      })
      if (!event) {
        throw new JingleIpcError({
          channel: "agent:runtime",
          code: "CONFLICT",
          message: `[Agent] Run "${runId}" reached another terminal state before failure commit.`
        })
      }
      return { event, status }
    })
  })
  commitAgentEventProjectionState([terminal.event])
  return terminal.status
}

export async function markRunCancelled(threadId: string, runId: string): Promise<void> {
  await commitRunLifecycleTerminal({
    completionReason: "user_declined",
    operation: "cancel",
    runId,
    status: "cancelled",
    threadId
  })
}

export async function markRunAborted(threadId: string, runId: string): Promise<void> {
  await commitRunLifecycleTerminal({
    completionReason: "aborted",
    operation: "abort",
    runId,
    status: "interrupted",
    threadId
  })
}

async function commitRunLifecycleTerminal(input: {
  completionReason?: "aborted" | "user_declined"
  operation: "abort" | "cancel" | "complete"
  runId: string
  status: "cancelled" | "interrupted" | "success"
  threadId: string
}): Promise<void> {
  const durableTerminal = input.status !== "interrupted" || input.completionReason === "aborted"
  const eventInputs: AppendAgentEventInput[] = [
    ...(input.status === "interrupted"
      ? [
          createRunInterruptedEventInput({
            runId: input.runId,
            status: "interrupted" as const,
            threadId: input.threadId
          })
        ]
      : []),
    createRunFinishedEventInput({
      ...(input.completionReason ? { completionReason: input.completionReason } : {}),
      runId: input.runId,
      status: input.status,
      threadId: input.threadId
    })
  ]

  await withRunMetadataLock(input.runId, async () => {
    const prisma = getPrismaClient()
    await prisma.$transaction(async (transaction) => {
      const [existingRow, threadRow, existingFinishedEvents] = await Promise.all([
        transaction.run.findUnique({ where: { runId: input.runId } }),
        transaction.thread.findUnique({ where: { threadId: input.threadId } }),
        transaction.agentEvent.findMany({
          select: { payload: true },
          where: { runId: input.runId, type: "run.finished" }
        })
      ])
      if (!existingRow) {
        throw new Error(`[Agent] Cannot ${input.operation} missing run "${input.runId}".`)
      }
      const existing = mapRunRow(existingRow)
      if (existing.thread_id !== input.threadId) {
        throw new Error(
          `[Agent] Cannot ${input.operation} run "${input.runId}" from thread "${input.threadId}"; actual thread is "${existing.thread_id}".`
        )
      }
      if (!threadRow) {
        throw new Error(
          `[Agent] Cannot ${input.operation} run "${input.runId}" without its thread.`
        )
      }
      if (
        existingFinishedEvents.some((event) =>
          isDurableTerminalRunFinishedPayload(event.payload)
        ) ||
        (existing.status !== "pending" && existing.status !== "running")
      ) {
        throw new JingleIpcError({
          channel: "agent:runtime",
          code: "CONFLICT",
          message: `[Agent] Cannot ${input.operation} terminal run "${input.runId}" from status "${existing.status ?? "unknown"}".`
        })
      }

      const now = BigInt(Date.now())
      const transition = await transaction.run.updateMany({
        data: {
          metadata: serializeJsonValue(mergeRunMetadataWithoutFailure(existing)),
          status: input.status,
          updatedAt: now
        },
        where: { runId: input.runId, status: { in: ["pending", "running"] } }
      })
      if (transition.count === 0) {
        throw new JingleIpcError({
          channel: "agent:runtime",
          code: "CONFLICT",
          message: `[Agent] Run "${input.runId}" reached another terminal state before ${input.status} commit.`
        })
      }

      if (durableTerminal) {
        await transaction.hitlRequest.updateMany({
          data: {
            decision: serializeJsonValue({
              type: input.completionReason === "aborted" ? "run_aborted" : "run_terminal"
            }),
            resolvedAt: now,
            status: "cancelled",
            updatedAt: now
          },
          where: { runId: input.runId, status: "pending", threadId: input.threadId }
        })
      }

      await appendAgentEventsInTransaction(transaction, eventInputs, { now })
      await transaction.thread.update({
        data: {
          status: input.status === "interrupted" ? "interrupted" : "idle",
          updatedAt: now
        },
        where: { threadId: input.threadId }
      })
    })
  })
  try {
    commitAgentEventProjectionState(eventInputs)
  } catch (error) {
    console.error(
      `[Agent] Run "${input.runId}" reached durable ${input.status} state but trace projection scheduling failed:`,
      error
    )
  }
}
