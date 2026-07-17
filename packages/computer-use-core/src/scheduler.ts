export class StaleComputerUseStateError extends Error {
  constructor(
    readonly resourceKey: string,
    readonly expectedEpoch: number,
    readonly actualEpoch: number
  ) {
    super(
      `Computer-use state is stale for ${resourceKey}: expected epoch ${expectedEpoch}, current epoch ${actualEpoch}.`
    )
    this.name = "StaleComputerUseStateError"
  }
}

interface ResourceRecord {
  epoch: number
  tail: Promise<void>
}

function enqueueAfter<T>(
  previous: Promise<void>,
  signal: AbortSignal | undefined,
  work: () => Promise<T>
): { result: Promise<T>; tail: Promise<void> } {
  let started = false
  let settled = false
  let resolveResult!: (value: T | PromiseLike<T>) => void
  let rejectResult!: (reason?: unknown) => void
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  const rejectOnce = (reason: unknown): void => {
    if (settled) return
    settled = true
    rejectResult(reason)
  }
  const onAbort = (): void => {
    if (!started) rejectOnce(signal?.reason ?? new DOMException("Aborted", "AbortError"))
  }

  signal?.addEventListener("abort", onAbort, { once: true })
  if (signal?.aborted) onAbort()

  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      if (signal?.aborted) {
        rejectOnce(signal.reason ?? new DOMException("Aborted", "AbortError"))
        return
      }
      started = true
      try {
        const value = await work()
        if (!settled) {
          settled = true
          resolveResult(value)
        }
      } catch (error) {
        rejectOnce(error)
      } finally {
        signal?.removeEventListener("abort", onAbort)
      }
    })

  return {
    result,
    tail: operation.then(
      () => undefined,
      () => undefined
    )
  }
}

export class ComputerUseResourceScheduler {
  private readonly resources = new Map<string, ResourceRecord>()
  private globalPhysicalInputTail = Promise.resolve()
  private closed = false

  epoch(resourceKey: string): number {
    return this.resource(resourceKey).epoch
  }

  async read<T>(
    resourceKey: string,
    work: (epoch: number) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    return this.enqueue(resourceKey, signal, (record) => work(record.epoch))
  }

  async readAt<T>(
    resourceKey: string,
    expectedEpoch: number,
    work: (epoch: number) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    return this.enqueue(resourceKey, signal, (record) => {
      this.assertEpoch(resourceKey, expectedEpoch, record)
      return work(record.epoch)
    })
  }

  async write<T>(input: {
    expectedEpoch: number
    physicalInput: boolean
    resourceKey: string
    signal?: AbortSignal
    work: (commit: () => number) => Promise<T>
  }): Promise<T> {
    return this.enqueue(input.resourceKey, input.signal, async (record) => {
      this.assertEpoch(input.resourceKey, input.expectedEpoch, record)
      input.signal?.throwIfAborted()
      const dispatch = () => {
        input.signal?.throwIfAborted()
        let committed = false
        const commit = (): number => {
          if (committed) throw new Error("Computer-use write was already committed.")
          input.signal?.throwIfAborted()
          committed = true
          record.epoch += 1
          return record.epoch
        }
        return input.work(commit)
      }
      if (!input.physicalInput) return dispatch()
      return this.withGlobalPhysicalInput(input.signal, dispatch)
    })
  }

  async close(): Promise<void> {
    this.closed = true
    await Promise.all([...this.resources.values()].map((record) => record.tail.catch(() => undefined)))
    await this.globalPhysicalInputTail.catch(() => undefined)
    this.resources.clear()
  }

  private assertEpoch(resourceKey: string, expectedEpoch: number, record: ResourceRecord): void {
    if (record.epoch !== expectedEpoch) {
      throw new StaleComputerUseStateError(resourceKey, expectedEpoch, record.epoch)
    }
  }

  private resource(resourceKey: string): ResourceRecord {
    const existing = this.resources.get(resourceKey)
    if (existing) return existing
    const created = { epoch: 0, tail: Promise.resolve() }
    this.resources.set(resourceKey, created)
    return created
  }

  private async enqueue<T>(
    resourceKey: string,
    signal: AbortSignal | undefined,
    work: (record: ResourceRecord) => Promise<T>
  ): Promise<T> {
    if (this.closed) throw new Error("Computer-use scheduler is closed.")
    signal?.throwIfAborted()
    const record = this.resource(resourceKey)
    const queued = enqueueAfter(record.tail, signal, () => work(record))
    record.tail = queued.tail
    return queued.result
  }

  private async withGlobalPhysicalInput<T>(
    signal: AbortSignal | undefined,
    work: () => Promise<T>
  ): Promise<T> {
    const queued = enqueueAfter(this.globalPhysicalInputTail, signal, work)
    this.globalPhysicalInputTail = queued.tail
    return queued.result
  }
}
