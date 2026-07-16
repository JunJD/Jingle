import type { DiagnosticsLogger } from "../diagnostics/logger"
import { getThreadDigest, type UpsertReadyThreadDigestInput } from "../db/thread-digests"
import { JingleIpcError } from "../ipc/error"
import {
  commitThreadDigestProjection,
  prepareThreadDigestProjection
} from "../projection/thread-digest-projection"
import type { ThreadDigestRecord } from "@shared/thread-digest"

interface ActiveDigestGeneration {
  controller: AbortController
  phase: "committing" | "generating"
  promise: Promise<ThreadDigestRecord>
}

export interface ThreadDigestProjectionPort {
  commit(input: UpsertReadyThreadDigestInput): Promise<void>
  prepare(threadId: string, signal: AbortSignal): Promise<UpsertReadyThreadDigestInput>
}

type ThreadDigestChangedListener = (digest: ThreadDigestRecord) => void
type ThreadDigestDiagnostics = Pick<DiagnosticsLogger, "error" | "info">

const NOOP_DIAGNOSTICS: ThreadDigestDiagnostics = {
  error: () => {},
  info: () => {}
}

const DEFAULT_PROJECTION: ThreadDigestProjectionPort = {
  commit: commitThreadDigestProjection,
  prepare: prepareThreadDigestProjection
}

export class ThreadDigestService {
  private readonly activeGenerations = new Map<string, ActiveDigestGeneration>()
  private readonly changedListeners = new Set<ThreadDigestChangedListener>()
  private readonly deletedThreads = new Set<string>()
  private readonly deletions = new Map<string, Promise<void>>()
  private shuttingDown = false

  constructor(
    private readonly diagnostics: ThreadDigestDiagnostics = NOOP_DIAGNOSTICS,
    private readonly projection: ThreadDigestProjectionPort = DEFAULT_PROJECTION
  ) {}

  get(threadId: string): Promise<ThreadDigestRecord | null> {
    return getThreadDigest(threadId)
  }

  onChanged(listener: ThreadDigestChangedListener): () => void {
    this.changedListeners.add(listener)
    return () => {
      this.changedListeners.delete(listener)
    }
  }

  generate(threadId: string): Promise<ThreadDigestRecord> {
    if (this.shuttingDown) {
      throw new JingleIpcError({
        channel: "threadDigest:generate",
        code: "UNAVAILABLE",
        message: "The application is shutting down."
      })
    }
    if (this.deletedThreads.has(threadId)) {
      throw new JingleIpcError({
        channel: "threadDigest:generate",
        code: "NOT_FOUND",
        message: "The thread no longer exists."
      })
    }
    if (this.deletions.has(threadId)) {
      throw new JingleIpcError({
        channel: "threadDigest:generate",
        code: "FAILED_PRECONDITION",
        message: "The thread is being deleted."
      })
    }

    const active = this.activeGenerations.get(threadId)
    if (active) {
      return active.promise
    }

    const controller = new AbortController()
    const generation: ActiveDigestGeneration = {
      controller,
      phase: "generating",
      promise: Promise.resolve()
        .then(() =>
          this.runGeneration(threadId, controller.signal, () => {
            generation.phase = "committing"
          })
        )
        .finally(() => {
          if (this.activeGenerations.get(threadId) === generation) {
            this.activeGenerations.delete(threadId)
          }
        })
    }
    this.activeGenerations.set(threadId, generation)
    return generation.promise
  }

  withThreadDeletion(
    threadId: string,
    operation: (waitForDigest: () => Promise<void>) => Promise<void>
  ): Promise<void> {
    if (this.shuttingDown) {
      throw new JingleIpcError({
        channel: "threads:delete",
        code: "UNAVAILABLE",
        message: "The application is shutting down."
      })
    }

    const existing = this.deletions.get(threadId)
    if (existing) {
      return existing
    }

    let resolveDeletion: () => void = () => {}
    let rejectDeletion: (error: unknown) => void = () => {}
    const deletion = new Promise<void>((resolve, reject) => {
      resolveDeletion = resolve
      rejectDeletion = reject
    })
    this.deletions.set(threadId, deletion)
    const digestSettled = (async (): Promise<void> => {
      const generation = this.activeGenerations.get(threadId)
      if (generation) {
        if (generation.phase === "generating") {
          generation.controller.abort()
        }
        await generation.promise.catch(() => undefined)
      }
    })()

    let operationPromise: Promise<void>
    try {
      operationPromise = operation(() => digestSettled)
    } catch (error) {
      operationPromise = Promise.reject(error)
    }
    void operationPromise.then(
      () => {
        this.deletedThreads.add(threadId)
        resolveDeletion()
      },
      (error: unknown) => {
        rejectDeletion(error)
      }
    )
    const clearDeletion = (): void => {
      if (this.deletions.get(threadId) === deletion) {
        this.deletions.delete(threadId)
      }
    }
    void deletion.then(clearDeletion, clearDeletion)
    return deletion
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const generations = [...this.activeGenerations.values()]
    for (const generation of generations) {
      if (generation.phase === "generating") {
        generation.controller.abort()
      }
    }
    await Promise.allSettled([
      ...generations.map((generation) => generation.promise),
      ...this.deletions.values()
    ])
  }

  private async runGeneration(
    threadId: string,
    signal: AbortSignal,
    admitCommit: () => void
  ): Promise<ThreadDigestRecord> {
    this.diagnostics.info("Thread digest generation started", { threadId })
    try {
      const projection = await this.projection.prepare(threadId, signal)
      signal.throwIfAborted()
      admitCommit()
      await this.projection.commit(projection)
      const digest = await getThreadDigest(threadId)
      if (!digest || digest.status !== "ready" || !digest.summary) {
        throw new Error(
          `Thread digest generation did not produce a ready digest for "${threadId}".`
        )
      }

      this.diagnostics.info("Thread digest generation completed", {
        digestUpdatedAt: digest.updatedAt,
        messageCount: digest.messageCount,
        projectedThroughSeq: digest.projectedThroughSeq,
        threadId
      })
      if (!this.shuttingDown && !this.deletions.has(threadId)) {
        for (const listener of this.changedListeners) {
          try {
            listener(digest)
          } catch (error) {
            this.diagnostics.error("Thread digest change listener failed", {
              digestUpdatedAt: digest.updatedAt,
              error: error instanceof Error ? error.message : String(error),
              projectedThroughSeq: digest.projectedThroughSeq,
              threadId
            })
          }
        }
      }
      return digest
    } catch (error) {
      const fields = {
        error: error instanceof Error ? error.message : String(error),
        threadId
      }
      if (signal.aborted) {
        this.diagnostics.info("Thread digest generation canceled", fields)
      } else {
        this.diagnostics.error("Thread digest generation failed", fields)
      }
      throw error
    }
  }
}
