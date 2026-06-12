import { randomUUID } from "crypto"
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint"
import {
  createRunExtensionAiCapabilitiesSnapshot,
  RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY,
  type ResolvedExtensionAiCapability
} from "@shared/extension-sources"
import {
  createRun,
  getRun,
  getThread,
  hasPendingHitlRequestForRun,
  updateRun,
  updateThread
} from "../db"
import { getCheckpointer } from "./runtime"
import { checkpointIncludesMessageId, extractTitleFromCheckpoint } from "./runtime-state"
import { shouldAutoGenerateThreadTitle } from "@shared/thread-title"
import type { PermissionModeName } from "@shared/permission-mode"
import { DEFAULT_PERMISSION_MODE } from "@shared/permission-mode"
import { mergeRunMetadata, RUN_PERMISSION_MODE_SNAPSHOT_METADATA_KEY } from "./permission-mode"
import {
  OPENWORK_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY,
  OPENWORK_MEMORY_TEMPORARY_MODE_METADATA_KEY,
  type OpenworkMemoryContextSnapshot
} from "@shared/openwork-memory"

type PersistedRunStatus = "pending" | "running" | "error" | "success" | "interrupted"
type ExistingRun = NonNullable<Awaited<ReturnType<typeof getRun>>>

const runMetadataUpdateQueues = new Map<string, Promise<void>>()

function resolveCheckpointRunStatus(tuple: CheckpointTuple | undefined): PersistedRunStatus {
  const interrupts = (tuple as { checkpoint?: { channel_values?: { __interrupt__?: unknown[] } } })
    ?.checkpoint?.channel_values?.__interrupt__
  return Array.isArray(interrupts) && interrupts.length > 0 ? "interrupted" : "success"
}

export async function beginAgentRun(
  threadId: string,
  modelId?: string,
  options?: {
    aiCapabilities?: ResolvedExtensionAiCapability[]
    openworkMemoryContextSnapshot?: OpenworkMemoryContextSnapshot | null
    openworkMemoryTemporaryMode?: boolean
    permissionMode?: PermissionModeName
  }
): Promise<{ runId: string }> {
  const runId = randomUUID()
  const permissionMode = options?.permissionMode ?? DEFAULT_PERMISSION_MODE
  const aiCapabilities = options?.aiCapabilities ?? []

  await createRun(runId, threadId, {
    status: "running",
    metadata: {
      modelId: modelId ?? null,
      [RUN_PERMISSION_MODE_SNAPSHOT_METADATA_KEY]: permissionMode,
      [OPENWORK_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY]:
        options?.openworkMemoryContextSnapshot ?? null,
      [OPENWORK_MEMORY_TEMPORARY_MODE_METADATA_KEY]: options?.openworkMemoryTemporaryMode ?? false,
      [RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY]:
        createRunExtensionAiCapabilitiesSnapshot({
          aiCapabilities,
          runId
        })
    }
  })

  await updateThread(threadId, {
    status: "busy"
  })

  return {
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
  const previous = runMetadataUpdateQueues.get(runId) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const run = await getRun(runId)
      if (!run) {
        return
      }

      await updateRun(runId, {
        ...(input.status !== undefined ? { status: input.status } : {}),
        metadata: input.merge(run)
      })
    })

  runMetadataUpdateQueues.set(runId, next)
  try {
    await next
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
  return mergeRunMetadata(run, metadata ?? {})
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

function mergeRunErrorMetadata(run: ExistingRun, error: unknown): Record<string, unknown> {
  return mergeRunMetadata(run, {
    error: error instanceof Error ? error.message : String(error)
  })
}

export async function resumeAgentRun(
  threadId: string,
  runId: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  const existing = await getRun(runId)

  if (!existing) {
    throw new Error(`[Agent] Cannot resume missing run "${runId}".`)
  }

  if (existing.thread_id !== threadId) {
    throw new Error(
      `[Agent] Cannot resume run "${runId}" from thread "${threadId}"; actual thread is "${existing.thread_id}".`
    )
  }

  if (existing.status && !["pending", "running", "interrupted"].includes(existing.status)) {
    throw new Error(`[Agent] Cannot resume run "${runId}" from status "${existing.status}".`)
  }

  await updateRunMetadata(runId, {
    status: "running",
    merge: (run) => mergeRunResumeMetadata(run, metadata)
  })

  await updateThread(threadId, {
    status: "busy"
  })
  return runId
}

export async function syncRunFromLatestCheckpoint(
  threadId: string,
  runId: string,
  options?: {
    expectedMessageId?: string
    interrupted?: boolean
  }
): Promise<PersistedRunStatus> {
  const checkpointer = await getCheckpointer(threadId)
  const latest = (await checkpointer.getTuple({
    configurable: {
      thread_id: threadId,
      run_id: runId
    }
  })) as CheckpointTuple | undefined

  if (!latest && !options?.interrupted) {
    throw new Error(`[Agent] Missing checkpoint for run "${runId}" in thread "${threadId}".`)
  }

  if (
    latest &&
    options?.expectedMessageId &&
    !checkpointIncludesMessageId(threadId, latest, options.expectedMessageId)
  ) {
    throw new Error(
      `[Agent] Latest checkpoint for run "${runId}" does not include submitted message "${options.expectedMessageId}".`
    )
  }

  const status = options?.interrupted ? "interrupted" : resolveCheckpointRunStatus(latest)
  const generatedTitle = extractTitleFromCheckpoint(latest)

  await updateRun(runId, {
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

  return status
}

export async function finalizeRunWithoutCheckpoint(
  threadId: string,
  runId: string,
  options?: {
    interrupted?: boolean
  }
): Promise<PersistedRunStatus> {
  const status: PersistedRunStatus = options?.interrupted ? "interrupted" : "success"

  await updateRun(runId, {
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
  error: unknown
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
      merge: (run) => mergeRunErrorMetadata(run, error)
    })

    await updateThread(threadId, {
      status: "interrupted"
    })
    return
  }

  await updateRunMetadata(runId, {
    status: "error",
    merge: (run) => mergeRunErrorMetadata(run, error)
  })

  await updateThread(threadId, {
    status: "error"
  })
}

export async function markRunAborted(threadId: string, runId: string): Promise<void> {
  try {
    await syncRunFromLatestCheckpoint(threadId, runId)
  } catch {
    // Ignore checkpoint sync failures on abort and just preserve the status.
  }

  await updateRun(runId, {
    status: "interrupted"
  })

  await updateThread(threadId, {
    status: "interrupted"
  })
}
