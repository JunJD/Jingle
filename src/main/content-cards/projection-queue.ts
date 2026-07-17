import { finalizeAssistantContentPartsForRun } from "../db/assistant-content-parts"
import {
  blockAssistantContentProjection,
  claimAssistantContentProjection,
  completeAssistantContentProjection,
  ensureAssistantContentProjectionPending,
  failAssistantContentProjection,
  markAssistantContentProjectionDirty,
  recoverAssistantContentProjectionJobs,
  resumeAssistantContentProjectionForRepairedMessage
} from "../db/assistant-content-projection-jobs"
import { createProjectionQueue } from "../projection/projection-queue"

interface AssistantContentProjectionJob {
  runId: string
}

type ProjectionPersistenceRequest =
  | { mode: "dirty"; runId: string }
  | {
      allowBlockedRetry: boolean
      blockedSource?: { messageId: string; sourceRevision: string }
      mode: "ensure"
      runId: string
    }
  | { messageId: string; mode: "resume-blocked-message"; runId: string }

const BASE_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const persistenceTasks = new Set<Promise<void>>()
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
let lifecycleStarted = false
let recoveryAttemptCount = 0
let recoveryAbortController: AbortController | null = null
let recoveryTask: Promise<void> | null = null
let recoveryTimer: ReturnType<typeof setTimeout> | null = null
let shuttingDown = false

interface ProjectionIssue {
  error: unknown
  eventCode:
    | "assistant_content_projection.dirty_persistence_failed"
    | "assistant_content_projection.derived_corruption_repaired"
    | "assistant_content_projection.execution_failed"
    | "assistant_content_projection.failure_persistence_failed"
    | "assistant_content_projection.input_blocked"
    | "assistant_content_projection.recovery_failed"
  operation: string
  runId?: string
  summary: string
}

async function recordProjectionIssue(issue: ProjectionIssue): Promise<void> {
  try {
    const { diagnosticsGraph } = await import("../diagnostics/instance")
    diagnosticsGraph.capture({
      component: "assistant-content-projection",
      eventCode: issue.eventCode,
      evidence: [{ kind: "error", value: issue.error }],
      fingerprint: issue.eventCode,
      level: "warn",
      operation: issue.operation,
      recoverable: true,
      refs: issue.runId ? [{ id: issue.runId, kind: "agent-run" }] : [],
      stateImpact: "content-cards-stale",
      summary: issue.summary
    })
  } catch {
    console.error("[AssistantContentProjector] Failed to record a projection diagnostic.")
  }
}

function clearRetry(runId: string): void {
  const timer = retryTimers.get(runId)
  if (!timer) return
  clearTimeout(timer)
  retryTimers.delete(runId)
}

function scheduleRetry(job: AssistantContentProjectionJob, attemptCount = 1): void {
  if (shuttingDown || retryTimers.has(job.runId)) return
  const delayMs = Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attemptCount - 1)
  )
  const timer = setTimeout(() => {
    retryTimers.delete(job.runId)
    assistantContentProjectionQueue.enqueue(job)
  }, delayMs)
  timer.unref?.()
  retryTimers.set(job.runId, timer)
}

function schedulePersistenceRetry(input: ProjectionPersistenceRequest): void {
  if (shuttingDown || retryTimers.has(input.runId)) return
  const timer = setTimeout(() => {
    retryTimers.delete(input.runId)
    void trackPersistence(persistAndWake(input))
  }, BASE_RETRY_DELAY_MS)
  timer.unref?.()
  retryTimers.set(input.runId, timer)
}

const assistantContentProjectionQueue = createProjectionQueue<AssistantContentProjectionJob>({
  debounceMs: 0,
  getKey: (job) => job.runId,
  maxConcurrency: 2,
  name: "AssistantContentProjector",
  run: async (job) => {
    let claim: Awaited<ReturnType<typeof claimAssistantContentProjection>> = null
    try {
      claim = await claimAssistantContentProjection(job.runId)
      if (!claim) return
      const finalized = await finalizeAssistantContentPartsForRun({
        runId: claim.runId,
        threadId: claim.threadId
      })
      if (finalized.repairedCorruptions.length > 0) {
        await recordProjectionIssue({
          error: finalized.repairedCorruptions[0]!.error,
          eventCode: "assistant_content_projection.derived_corruption_repaired",
          operation: "rebuild-derived-projection",
          runId: job.runId,
          summary: "Corrupt assistant content projection was rebuilt from canonical content"
        })
      }
      if (finalized.blockedInputs.length > 0) {
        const blocked = finalized.blockedInputs[0]!
        const persisted = await blockAssistantContentProjection(claim, finalized.blockedInputs)
        if (!persisted) {
          assistantContentProjectionQueue.enqueue(job)
          return
        }
        clearRetry(job.runId)
        await recordProjectionIssue({
          error: blocked.error,
          eventCode: "assistant_content_projection.input_blocked",
          operation: "project-assistant-content",
          runId: job.runId,
          summary: "Assistant content projection is blocked by invalid persisted input"
        })
        return
      }
      const completed = await completeAssistantContentProjection(claim)
      if (completed) clearRetry(job.runId)
      else assistantContentProjectionQueue.enqueue(job)
    } catch (error) {
      await recordProjectionIssue({
        error,
        eventCode: "assistant_content_projection.execution_failed",
        operation: "project-assistant-content",
        runId: job.runId,
        summary: "Assistant content projection failed and remains retryable"
      })
      if (!claim) {
        schedulePersistenceRetry({ allowBlockedRetry: false, mode: "ensure", runId: job.runId })
        return
      }
      try {
        await failAssistantContentProjection(claim, error)
        scheduleRetry(job, claim.attemptCount)
      } catch (persistenceError) {
        await recordProjectionIssue({
          error: persistenceError,
          eventCode: "assistant_content_projection.failure_persistence_failed",
          operation: "persist-projection-failure",
          runId: job.runId,
          summary: "Assistant content projection failure state could not be persisted"
        })
        schedulePersistenceRetry({ mode: "dirty", runId: job.runId })
      }
    }
  },
  stateKey: "assistant-content-parts"
})

async function persistAndWake(input: ProjectionPersistenceRequest): Promise<void> {
  try {
    let scheduled: boolean
    if (input.mode === "dirty") {
      scheduled = await markAssistantContentProjectionDirty(input.runId)
    } else if (input.mode === "ensure") {
      scheduled = await ensureAssistantContentProjectionPending(input.runId, {
        allowBlockedRetry: input.allowBlockedRetry,
        blockedSource: input.blockedSource
      })
    } else {
      scheduled = await resumeAssistantContentProjectionForRepairedMessage(
        input.runId,
        input.messageId
      )
    }
    if (!scheduled) return
    clearRetry(input.runId)
    assistantContentProjectionQueue.enqueue({ runId: input.runId })
  } catch (error) {
    await recordProjectionIssue({
      error,
      eventCode: "assistant_content_projection.dirty_persistence_failed",
      operation: "persist-projection-dirty-state",
      runId: input.runId,
      summary: "Assistant content projection dirty state could not be persisted"
    })
    schedulePersistenceRetry(input)
  }
}

function trackPersistence(task: Promise<void>): Promise<void> {
  persistenceTasks.add(task)
  void task.then(
    () => persistenceTasks.delete(task),
    () => persistenceTasks.delete(task)
  )
  return task
}

export async function enqueueAssistantContentProjection(input: { runId: string }): Promise<void> {
  await trackPersistence(persistAndWake({ mode: "dirty", runId: input.runId }))
}

export async function ensureAssistantContentProjectionScheduled(
  runId: string,
  options: {
    allowBlockedRetry: boolean
    blockedSource?: { messageId: string; sourceRevision: string }
  }
): Promise<void> {
  await trackPersistence(
    persistAndWake({
      allowBlockedRetry: options.allowBlockedRetry,
      blockedSource: options.blockedSource,
      mode: "ensure",
      runId
    })
  )
}

export async function resumeAssistantContentProjectionForRepairedSource(
  runId: string,
  messageId: string
): Promise<void> {
  await trackPersistence(persistAndWake({ messageId, mode: "resume-blocked-message", runId }))
}

function scheduleRecoveryRetry(): void {
  if (shuttingDown || recoveryTimer) return
  const delayMs = Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * 2 ** Math.max(0, recoveryAttemptCount - 1)
  )
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    void runRecovery()
  }, delayMs)
  recoveryTimer.unref?.()
}

function runRecovery(): Promise<void> {
  if (recoveryTask) return recoveryTask
  const abortController = new AbortController()
  recoveryAbortController = abortController
  recoveryTask = (async () => {
    try {
      await recoverAssistantContentProjectionJobs({
        onBatch: async (runIds) => {
          for (const runId of runIds) assistantContentProjectionQueue.enqueue({ runId })
          await assistantContentProjectionQueue.flush()
        },
        signal: abortController.signal
      })
      recoveryAttemptCount = 0
    } catch (error) {
      recoveryAttemptCount += 1
      await recordProjectionIssue({
        error,
        eventCode: "assistant_content_projection.recovery_failed",
        operation: "recover-projection-jobs",
        summary: "Assistant content projection recovery failed and will be retried"
      })
      scheduleRecoveryRetry()
    }
  })().finally(() => {
    if (recoveryAbortController === abortController) recoveryAbortController = null
    recoveryTask = null
  })
  return recoveryTask
}

export function startAssistantContentProjectionLifecycle(): Promise<void> {
  if (lifecycleStarted) return recoveryTask ?? Promise.resolve()
  lifecycleStarted = true
  shuttingDown = false
  return runRecovery()
}

export async function flushAssistantContentProjection(): Promise<void> {
  lifecycleStarted = false
  shuttingDown = true
  recoveryAbortController?.abort()
  if (recoveryTimer) clearTimeout(recoveryTimer)
  recoveryTimer = null
  for (const timer of retryTimers.values()) clearTimeout(timer)
  retryTimers.clear()
  await Promise.allSettled([...(recoveryTask ? [recoveryTask] : []), ...persistenceTasks])
  await assistantContentProjectionQueue.flush()
}
