import { randomUUID } from "crypto"
import {
  AGENT_RUN_FAILURE_METADATA_KEY,
  encodeAgentRunFailure,
  type AgentRunFailure
} from "@shared/agent-run-failure"
import {
  buildJingleCheckpointLookupConfig,
  resolveJingleCheckpointRunStatus
} from "@jingle/langchain-agent-harness/transitional"
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
  type AppendAgentEventInput
} from "../db/agent-events"
import { serializeJsonValue } from "../db/utils"
import { getThread, updateThread } from "../db/threads"
import { hasPendingHitlRequestForRun } from "../db/hitl"
import { getCheckpointer } from "../checkpointer/runtime-checkpointer-manager"
import { extractThreadFactsFromCheckpoint } from "./runtime-state"
import { listProjectedThreadMessages } from "../db/message-state"
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
  createRunResumedEventInput,
  createRunStartedEventInput,
  createUserMessageCreatedEventInput
} from "./event-recorder"

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
    contentPreview: string
    refs: unknown[]
    userMessageId: string
  }
}

const runMetadataUpdateQueues = new Map<string, Promise<unknown>>()

export async function beginAgentRun(
  threadId: string,
  modelId: string | undefined,
  options: BeginAgentRunOptions
): Promise<{ run: ExistingRun; runId: string }> {
  const runId = randomUUID()
  const permissionMode = options?.permissionMode ?? DEFAULT_PERMISSION_MODE
  const aiCapabilities = options?.aiCapabilities ?? []

  const metadata = {
    modelId: modelId ?? null,
    [RUN_PERMISSION_MODE_SNAPSHOT_METADATA_KEY]: permissionMode,
    [JINGLE_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY]: options?.jingleMemoryContextSnapshot ?? null,
    [JINGLE_MEMORY_TEMPORARY_MODE_METADATA_KEY]: options?.jingleMemoryTemporaryMode ?? false,
    [RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY]: createRunExtensionAiCapabilitiesSnapshot(
      {
        aiCapabilities,
        runId
      }
    )
  }
  const startEventInputs: AppendAgentEventInput[] = [
    createRunStartedEventInput({
      modelId,
      permissionMode,
      runId,
      threadId,
      userMessageId: options.startEvent.userMessageId
    }),
    createUserMessageCreatedEventInput({
      contentPreview: options.startEvent.contentPreview,
      refs: options.startEvent.refs,
      runId,
      threadId,
      userMessageId: options.startEvent.userMessageId
    })
  ]
  const prisma = getPrismaClient()
  // Admission owns one durable commit; cancellation retains the run lease until it settles.
  const run = await prisma.$transaction(async (transaction) => {
    const now = BigInt(Date.now())
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
    await transaction.thread.update({
      data: {
        status: "busy",
        updatedAt: now
      },
      where: { threadId }
    })
    return mapRunRow(row)
  })
  commitAgentEventProjectionState(startEventInputs)

  return {
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

function mergeRunResumeMetadata(
  run: ExistingRun,
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> {
  return removeRunFailureMetadata(mergeRunMetadata(run, metadata ?? {}))
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

function mergeRunFailureMetadata(
  run: ExistingRun,
  failure: AgentRunFailure
): Record<string, unknown> {
  return mergeRunMetadata(run, {
    [AGENT_RUN_FAILURE_METADATA_KEY]: encodeAgentRunFailure(failure)
  })
}

export async function resumeAgentRun(
  threadId: string,
  runId: string,
  metadata: Record<string, unknown> | undefined,
  options: {
    resumeEvent: {
      modelId?: string
      requestId: string
    }
  }
): Promise<{ run: ExistingRun; runId: string }> {
  const resumeEventInputs: AppendAgentEventInput[] = [
    createRunResumedEventInput({
      modelId: options.resumeEvent.modelId,
      requestId: options.resumeEvent.requestId,
      runId,
      threadId
    })
  ]
  const run = await withRunMetadataLock(runId, async () => {
    const prisma = getPrismaClient()
    // Resume facts and the busy transition must become visible as one generation.
    return prisma.$transaction(async (transaction) => {
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

      if (existing.status && !["pending", "running", "interrupted"].includes(existing.status)) {
        throw new Error(`[Agent] Cannot resume run "${runId}" from status "${existing.status}".`)
      }

      const now = BigInt(Date.now())
      const resumedRow = await transaction.run.update({
        data: {
          metadata: serializeJsonValue(mergeRunResumeMetadata(existing, metadata)),
          status: "running",
          updatedAt: now
        },
        where: { runId }
      })
      await appendAgentEventsInTransaction(transaction, resumeEventInputs, { now })
      await transaction.thread.update({
        data: {
          status: "busy",
          updatedAt: now
        },
        where: { threadId }
      })
      return mapRunRow(resumedRow)
    })
  })
  commitAgentEventProjectionState(resumeEventInputs)

  return { run, runId }
}

export async function syncRunFromLatestCheckpointFacts(
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
    const projectedMessages = await listProjectedThreadMessages(threadId)
    const includesMessage = projectedMessages.some(
      (message) => message.message_id === options.expectedMessageId
    )
    if (!includesMessage) {
      throw new Error(
        `[Agent] Message projection for run "${runId}" does not include submitted message "${options.expectedMessageId}".`
      )
    }
  }

  const status = options?.interrupted ? "interrupted" : resolveJingleCheckpointRunStatus(latest)
  const facts = extractThreadFactsFromCheckpoint(threadId, latest, { runId })
  const generatedTitle = facts.title

  await updateRunMetadata(runId, {
    merge: mergeRunMetadataWithoutFailure,
    status
  })

  const thread = await getThread(threadId)
  const shouldSyncTitle =
    generatedTitle !== null &&
    shouldAutoGenerateThreadTitle({
      metadata: thread?.metadata ? JSON.parse(thread.metadata) : undefined,
      title: thread?.title ?? undefined
    })

  await updateThread(threadId, {
    status: status === "interrupted" ? "interrupted" : "idle",
    ...(shouldSyncTitle ? { title: generatedTitle } : {})
  })

  return {
    facts,
    hasCheckpoint: latest !== undefined,
    status
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

  await updateRunMetadata(runId, {
    merge: mergeRunMetadataWithoutFailure,
    status
  })

  await updateThread(threadId, {
    status: status === "interrupted" ? "interrupted" : "idle"
  })

  return status
}

export async function markRunFailed(
  threadId: string,
  runId: string,
  failure: AgentRunFailure
): Promise<void> {
  let syncedStatus: PersistedRunStatus | null = null
  try {
    syncedStatus = await syncRunFromLatestCheckpoint(threadId, runId)
  } catch {
    // Best effort: preserve the failure even if checkpoint sync fails.
  }

  if (syncedStatus === "interrupted" || (await hasPendingHitlRequestForRun(threadId, runId))) {
    await updateRunMetadata(runId, {
      status: "interrupted",
      merge: (run) => mergeRunFailureMetadata(run, failure)
    })

    await updateThread(threadId, {
      status: "interrupted"
    })
    return
  }

  await updateRunMetadata(runId, {
    status: "error",
    merge: (run) => mergeRunFailureMetadata(run, failure)
  })

  await updateThread(threadId, {
    status: "error"
  })
}

export async function markRunCancelled(threadId: string, runId: string): Promise<void> {
  await updateRun(runId, { status: "cancelled" })
  await updateThread(threadId, { status: "idle" })
}

export async function markRunAborted(threadId: string, runId: string): Promise<void> {
  try {
    await syncRunFromLatestCheckpoint(threadId, runId)
  } catch {
    // Ignore checkpoint sync failures on abort and just preserve the status.
  }

  await updateRunMetadata(runId, {
    merge: mergeRunMetadataWithoutFailure,
    status: "interrupted"
  })

  await updateThread(threadId, {
    status: "interrupted"
  })
}
