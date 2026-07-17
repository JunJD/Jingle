import type {
  ExtensionRuntimeSessionError,
  ExtensionRuntimeSessionIssueSnapshot
} from "@shared/extension-runtime-protocol"

export class ExtensionRuntimeIssueSnapshotCache {
  private activeSessionId: string | null = null
  private readonly revisions = new Map<string, number>()
  private readonly snapshots = new Map<string, ExtensionRuntimeSessionIssueSnapshot>()
  private subscriptionGeneration = 0

  apply(snapshot: ExtensionRuntimeSessionIssueSnapshot): boolean {
    if (snapshot.sessionId !== this.activeSessionId) {
      return false
    }
    if ((this.revisions.get(snapshot.sessionId) ?? -1) >= snapshot.revision) {
      return false
    }
    this.revisions.set(snapshot.sessionId, snapshot.revision)
    this.snapshots.set(snapshot.sessionId, snapshot)
    return true
  }

  applyTerminal(error: ExtensionRuntimeSessionError): boolean {
    return this.apply({
      issues: [],
      revision: error.issueRevision,
      sessionId: error.sessionId,
      terminal: true
    })
  }

  applySubscriptionSnapshot(
    generation: number,
    snapshot: ExtensionRuntimeSessionIssueSnapshot
  ): boolean {
    return generation === this.subscriptionGeneration && this.apply(snapshot)
  }

  beginSubscription(): number {
    this.subscriptionGeneration += 1
    return this.subscriptionGeneration
  }

  beginSessionAdmission(sessionId: string): void {
    if (sessionId === this.activeSessionId) {
      return
    }
    this.activeSessionId = sessionId
    this.clear()
  }

  clear(): void {
    this.revisions.clear()
    this.snapshots.clear()
  }

  endSubscription(): void {
    this.subscriptionGeneration += 1
    this.clear()
  }

  endSession(sessionId: string): void {
    if (sessionId !== this.activeSessionId) {
      return
    }
    this.activeSessionId = null
    this.clear()
  }

  isSubscriptionCurrent(generation: number): boolean {
    return generation === this.subscriptionGeneration
  }

  values(): ExtensionRuntimeSessionIssueSnapshot[] {
    return Array.from(this.snapshots.values())
  }
}
