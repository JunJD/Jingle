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
import {
  assistantContentProjectionChangedEventSchema,
  assistantContentProjectionJobRevision
} from "@shared/assistant-content-part"
import { assistantContentProjectionEvents } from "./events"
import {
  asAssistantContentProjectionPersistenceFailure,
  assistantContentProjectionFailureCause,
  classifyAssistantContentProjectionFailure,
  summarizeAssistantContentProjectionError,
  type ProjectionFailure
} from "./projection-error"

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

const PERSISTENCE_RETRY_DELAY_MS = 1_000
const MAX_RECOVERY_RETRY_DELAY_MS = 30_000
const MAX_TIMER_DELAY_MS = 2_147_483_647
const persistenceTasks = new Set<Promise<unknown>>()
const persistenceRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
let durableRetryDeadline: bigint | null = null
let durableRetryTimer: ReturnType<typeof setTimeout> | null = null
let durableRetryWakePending = false
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
    | "assistant_content_projection.change_delivery_failed"
    | "assistant_content_projection.execution_failed"
    | "assistant_content_projection.failure_persistence_failed"
    | "assistant_content_projection.input_blocked"
    | "assistant_content_projection.recovery_failed"
  operation: string
  recoverable?: boolean
  runId?: string
  summary: string
}

async function publishChangedProjections(input: {
  changedProjections: readonly {
    contentRevision: string
    messageId: string
    projectionFingerprint: string
  }[]
  runId: string
  threadId: string
}): Promise<void> {
  for (const changed of input.changedProjections) {
    try {
      assistantContentProjectionEvents.publish(
        assistantContentProjectionChangedEventSchema.parse({
          kind: "ready",
          messageId: changed.messageId,
          projectionFingerprint: changed.projectionFingerprint,
          revision: changed.contentRevision,
          threadId: input.threadId
        })
      )
    } catch (error) {
      await recordProjectionIssue({
        error,
        eventCode: "assistant_content_projection.change_delivery_failed",
        operation: "publish-projection-change",
        runId: input.runId,
        summary:
          "Assistant content projection changed but its renderer event could not be published"
      })
    }
  }
}

async function publishProjectionIssueStatus(input: {
  claim: NonNullable<Awaited<ReturnType<typeof claimAssistantContentProjection>>>
  status: "blocked" | "exhausted" | "failed" | "parked"
}): Promise<void> {
  try {
    assistantContentProjectionEvents.publish(
      assistantContentProjectionChangedEventSchema.parse({
        kind: "issue",
        revision: assistantContentProjectionJobRevision(input.claim),
        runId: input.claim.runId,
        status: input.status,
        threadId: input.claim.threadId
      })
    )
  } catch (error) {
    await recordProjectionIssue({
      error,
      eventCode: "assistant_content_projection.change_delivery_failed",
      operation: "publish-projection-status-change",
      runId: input.claim.runId,
      summary:
        "Assistant content projection status changed but its renderer event could not be published"
    })
  }
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
      recoverable: issue.recoverable ?? true,
      refs: issue.runId ? [{ id: issue.runId, kind: "agent-run" }] : [],
      stateImpact: "content-cards-stale",
      summary: issue.summary
    })
  } catch {
    console.error("[AssistantContentProjector] Failed to record a projection diagnostic.")
  }
}

function clearPersistenceRetry(runId: string): void {
  const timer = persistenceRetryTimers.get(runId)
  if (!timer) return
  clearTimeout(timer)
  persistenceRetryTimers.delete(runId)
}

function scheduleDurableRetry(nextAttemptAt: bigint): void {
  if (shuttingDown || (durableRetryDeadline !== null && durableRetryDeadline <= nextAttemptAt))
    return
  if (durableRetryTimer) clearTimeout(durableRetryTimer)
  durableRetryDeadline = nextAttemptAt
  const remainingMs = nextAttemptAt - BigInt(Date.now())
  const delayMs = Math.max(0, Math.min(MAX_TIMER_DELAY_MS, Number(remainingMs)))
  durableRetryTimer = setTimeout(() => {
    durableRetryDeadline = null
    durableRetryTimer = null
    if (!recoveryTask) {
      void runRecovery()
      return
    }
    if (durableRetryWakePending) return
    durableRetryWakePending = true
    void recoveryTask.finally(() => {
      if (!durableRetryWakePending) return
      durableRetryWakePending = false
      if (!shuttingDown && !recoveryTimer) void runRecovery()
    })
  }, delayMs)
  durableRetryTimer.unref?.()
}

function schedulePersistenceRetry(input: ProjectionPersistenceRequest): void {
  if (shuttingDown || persistenceRetryTimers.has(input.runId)) return
  const timer = setTimeout(() => {
    persistenceRetryTimers.delete(input.runId)
    void trackPersistence(persistAndWake(input))
  }, PERSISTENCE_RETRY_DELAY_MS)
  timer.unref?.()
  persistenceRetryTimers.set(input.runId, timer)
}

interface PersistProjectionFailureInput {
  claim: NonNullable<Awaited<ReturnType<typeof claimAssistantContentProjection>>>
  error: unknown
  job: AssistantContentProjectionJob
}

function scheduleFailurePersistenceRetry(input: PersistProjectionFailureInput): void {
  if (shuttingDown || persistenceRetryTimers.has(input.job.runId)) return
  const timer = setTimeout(() => {
    persistenceRetryTimers.delete(input.job.runId)
    void trackPersistence(persistProjectionFailure(input))
  }, PERSISTENCE_RETRY_DELAY_MS)
  timer.unref?.()
  persistenceRetryTimers.set(input.job.runId, timer)
}

async function persistProjectionFailure(input: PersistProjectionFailureInput): Promise<void> {
  try {
    let settlement: Awaited<ReturnType<typeof failAssistantContentProjection>>
    try {
      settlement = await failAssistantContentProjection(input.claim, input.error)
    } catch (error) {
      throw asAssistantContentProjectionPersistenceFailure(error)
    }
    if (!settlement) {
      assistantContentProjectionQueue.enqueue(input.job)
      return
    }
    clearPersistenceRetry(input.job.runId)
    await publishProjectionIssueStatus({ claim: input.claim, status: settlement.status })
    if (settlement.status === "failed" && settlement.nextAttemptAt !== null) {
      scheduleDurableRetry(settlement.nextAttemptAt)
    }
  } catch (error) {
    const failureError = asAssistantContentProjectionPersistenceFailure(error)
    const failure = classifyAssistantContentProjectionFailure(failureError)
    await recordProjectionIssue({
      error: assistantContentProjectionFailureCause(failureError),
      eventCode: "assistant_content_projection.failure_persistence_failed",
      operation: "persist-projection-failure",
      recoverable: failure.kind === "retryable",
      runId: input.job.runId,
      summary: "Assistant content projection failure state could not be persisted"
    })
    if (failure.kind === "retryable") scheduleFailurePersistenceRetry(input)
  }
}

const assistantContentProjectionQueue = createProjectionQueue<AssistantContentProjectionJob>({
  debounceMs: 0,
  getKey: (job) => job.runId,
  maxConcurrency: 2,
  name: "AssistantContentProjector",
  run: async (job) => {
    let claim: Awaited<ReturnType<typeof claimAssistantContentProjection>> = null
    try {
      try {
        claim = await claimAssistantContentProjection(job.runId)
      } catch (error) {
        throw asAssistantContentProjectionPersistenceFailure(error)
      }
      if (!claim) return
      let finalized: Awaited<ReturnType<typeof finalizeAssistantContentPartsForRun>>
      try {
        finalized = await finalizeAssistantContentPartsForRun({
          runId: claim.runId,
          threadId: claim.threadId
        })
      } catch (error) {
        throw asAssistantContentProjectionPersistenceFailure(error)
      }
      // Finalization is committed here. Its invalidation must not depend on a job-generation CAS.
      await publishChangedProjections({
        changedProjections: finalized.changedProjections,
        runId: job.runId,
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
        let persisted: boolean
        try {
          persisted = await blockAssistantContentProjection(claim, finalized.blockedInputs)
        } catch (error) {
          throw asAssistantContentProjectionPersistenceFailure(error)
        }
        if (!persisted) {
          assistantContentProjectionQueue.enqueue(job)
          return
        }
        clearPersistenceRetry(job.runId)
        await publishProjectionIssueStatus({ claim, status: "blocked" })
        await recordProjectionIssue({
          error: blocked.error,
          eventCode: "assistant_content_projection.input_blocked",
          operation: "project-assistant-content",
          runId: job.runId,
          summary: "Assistant content projection is blocked by invalid persisted input"
        })
        return
      }
      let completed: boolean
      try {
        completed = await completeAssistantContentProjection(claim)
      } catch (error) {
        throw asAssistantContentProjectionPersistenceFailure(error)
      }
      if (completed) {
        clearPersistenceRetry(job.runId)
      } else assistantContentProjectionQueue.enqueue(job)
    } catch (error) {
      const failureError = asAssistantContentProjectionPersistenceFailure(error)
      const failure = classifyAssistantContentProjectionFailure(failureError)
      await recordProjectionIssue({
        error: assistantContentProjectionFailureCause(failureError),
        eventCode: "assistant_content_projection.execution_failed",
        operation: "project-assistant-content",
        recoverable: failure.kind === "retryable",
        runId: job.runId,
        summary:
          failure.kind === "retryable"
            ? "Assistant content projection failed with a bounded retryable error"
            : "Assistant content projection failed with a terminal error"
      })
      if (!claim) {
        if (failure.kind === "retryable") {
          schedulePersistenceRetry({ allowBlockedRetry: false, mode: "ensure", runId: job.runId })
        }
        return
      }
      await persistProjectionFailure({ claim, error: failureError, job })
    }
  },
  stateKey: "assistant-content-parts"
})

export type AssistantContentProjectionScheduleOutcome =
  | { status: "active" }
  | { status: "inactive" }
  | { detail: string; failure: ProjectionFailure; status: "failed" }

async function persistAndWake(
  input: ProjectionPersistenceRequest
): Promise<AssistantContentProjectionScheduleOutcome> {
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
    if (!scheduled) return { status: "inactive" }
    clearPersistenceRetry(input.runId)
    assistantContentProjectionQueue.enqueue({ runId: input.runId })
    return { status: "active" }
  } catch (error) {
    const failureError = asAssistantContentProjectionPersistenceFailure(error)
    const failure = classifyAssistantContentProjectionFailure(failureError)
    await recordProjectionIssue({
      error: assistantContentProjectionFailureCause(failureError),
      eventCode: "assistant_content_projection.dirty_persistence_failed",
      operation: "persist-projection-dirty-state",
      recoverable: failure.kind === "retryable",
      runId: input.runId,
      summary: "Assistant content projection dirty state could not be persisted"
    })
    if (failure.kind === "retryable") schedulePersistenceRetry(input)
    return {
      detail: summarizeAssistantContentProjectionError(
        assistantContentProjectionFailureCause(failureError)
      ),
      failure,
      status: "failed"
    }
  }
}

function trackPersistence<T>(task: Promise<T>): Promise<T> {
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
): Promise<AssistantContentProjectionScheduleOutcome> {
  return trackPersistence(
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
): Promise<AssistantContentProjectionScheduleOutcome> {
  return trackPersistence(persistAndWake({ messageId, mode: "resume-blocked-message", runId }))
}

function scheduleRecoveryRetry(): void {
  if (shuttingDown || recoveryTimer) return
  const delayMs = Math.min(
    MAX_RECOVERY_RETRY_DELAY_MS,
    PERSISTENCE_RETRY_DELAY_MS * 2 ** Math.max(0, recoveryAttemptCount - 1)
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
        onDeferred: scheduleDurableRetry,
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
  if (durableRetryTimer) clearTimeout(durableRetryTimer)
  durableRetryDeadline = null
  durableRetryTimer = null
  durableRetryWakePending = false
  for (const timer of persistenceRetryTimers.values()) clearTimeout(timer)
  persistenceRetryTimers.clear()
  await Promise.allSettled([...(recoveryTask ? [recoveryTask] : []), ...persistenceTasks])
  await assistantContentProjectionQueue.flush()
}
