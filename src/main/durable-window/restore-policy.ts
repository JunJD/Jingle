export type PersistedThreadBindingDiscardReason = "archived" | "missing"

export type PersistedThreadBindingResolution =
  | { action: "restore"; threadId: string | null }
  | {
      action: "discard"
      reason: PersistedThreadBindingDiscardReason
      threadId: string
    }

export interface PersistedThreadBindingLookup {
  getThread: (threadId: string) => Promise<{ archivedAt: number | null } | null>
}

export interface DiscardedPersistedThreadBinding {
  reason: PersistedThreadBindingDiscardReason
  threadId: string
  windowId: string
}

export interface DurableWindowRestoreRepairDiagnostic {
  archivedBindingCount: number
  missingBindingCount: number
  sampleBindings: DiscardedPersistedThreadBinding[]
  surface: "main" | "thread-window"
}

const MAX_REPAIR_DIAGNOSTIC_SAMPLES = 5

export class DurableWindowRestoreGate {
  private applicationQuitting = false

  isApplicationQuitting(): boolean {
    return this.applicationQuitting
  }

  markApplicationQuitting(): void {
    this.applicationQuitting = true
  }
}

export class DurableWindowRestorePolicy {
  constructor(private readonly lookup: PersistedThreadBindingLookup) {}

  async resolve(threadId: string | null): Promise<PersistedThreadBindingResolution> {
    if (threadId === null) return { action: "restore", threadId: null }

    const thread = await this.lookup.getThread(threadId)
    if (!thread) return { action: "discard", reason: "missing", threadId }
    if (thread.archivedAt !== null) {
      return { action: "discard", reason: "archived", threadId }
    }
    return { action: "restore", threadId }
  }
}

export function summarizeDurableWindowRestoreRepairs(
  surface: DurableWindowRestoreRepairDiagnostic["surface"],
  discarded: readonly DiscardedPersistedThreadBinding[]
): DurableWindowRestoreRepairDiagnostic {
  let archivedBindingCount = 0
  let missingBindingCount = 0
  for (const binding of discarded) {
    if (binding.reason === "archived") archivedBindingCount += 1
    else missingBindingCount += 1
  }

  return {
    archivedBindingCount,
    missingBindingCount,
    sampleBindings: discarded.slice(0, MAX_REPAIR_DIAGNOSTIC_SAMPLES),
    surface
  }
}
