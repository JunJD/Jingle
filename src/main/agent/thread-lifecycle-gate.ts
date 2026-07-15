function createCompletion(): {
  completion: Promise<void>
  resolve: () => void
} {
  let resolve: () => void = () => {}
  const completion = new Promise<void>((next) => {
    resolve = next
  })

  return {
    completion,
    resolve
  }
}

interface ActiveThreadRun {
  completion: Promise<void>
  controller: AbortController
  resolveCompletion: () => void
}

export interface ThreadRunLease {
  readonly abortController: AbortController
  readonly signal: AbortSignal
  complete: () => void
}

export type ThreadRunClaim =
  | {
      lease: ThreadRunLease
      status: "accepted"
    }
  | {
      status: "deleting"
    }
  | {
      status: "running"
    }

export class ThreadLifecycleGate {
  private readonly deletions = new Map<string, Promise<void>>()
  private readonly runs = new Map<string, ActiveThreadRun>()
  private readonly transitions = new Map<string, Promise<void>>()

  async claimRun(threadId: string): Promise<ThreadRunClaim> {
    if (this.deletions.has(threadId)) {
      return { status: "deleting" }
    }

    return this.runTransition(threadId, async () => {
      if (this.deletions.has(threadId)) {
        return { status: "deleting" }
      }

      if (this.runs.has(threadId)) {
        return { status: "running" }
      }

      const controller = new AbortController()
      const { completion, resolve } = createCompletion()
      const record: ActiveThreadRun = {
        completion,
        controller,
        resolveCompletion: resolve
      }
      this.runs.set(threadId, record)

      return {
        lease: {
          abortController: controller,
          complete: () => {
            if (this.runs.get(threadId) === record) {
              this.runs.delete(threadId)
            }
            record.resolveCompletion()
          },
          signal: controller.signal
        },
        status: "accepted"
      }
    })
  }

  async withDeletion(threadId: string, operation: () => Promise<void>): Promise<void> {
    const existingDeletion = this.deletions.get(threadId)
    if (existingDeletion) {
      await existingDeletion
      return
    }

    const deletion = this.runTransition(threadId, async () => {
      await this.stopActiveRun(threadId)
      await operation()
    })
    this.deletions.set(threadId, deletion)

    try {
      await deletion
    } finally {
      if (this.deletions.get(threadId) === deletion) {
        this.deletions.delete(threadId)
      }
    }
  }

  private async runTransition<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.transitions.get(threadId) ?? Promise.resolve()
    let release: () => void = () => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => current)
    this.transitions.set(threadId, queued)

    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.transitions.get(threadId) === queued) {
        this.transitions.delete(threadId)
      }
    }
  }

  private async stopActiveRun(threadId: string): Promise<void> {
    const run = this.runs.get(threadId)
    if (!run) {
      return
    }

    run.controller.abort()
    await run.completion
  }
}
