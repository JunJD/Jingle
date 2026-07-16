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

export class ComputerUseResourceScheduler {
  private readonly resources = new Map<string, ResourceRecord>()
  private globalPhysicalInputTail = Promise.resolve()
  private closed = false

  epoch(resourceKey: string): number {
    return this.resource(resourceKey).epoch
  }

  async read<T>(resourceKey: string, work: (epoch: number) => Promise<T>): Promise<T> {
    return this.enqueue(resourceKey, undefined, (record) => work(record.epoch))
  }

  async readAt<T>(
    resourceKey: string,
    expectedEpoch: number,
    work: (epoch: number) => Promise<T>
  ): Promise<T> {
    return this.enqueue(resourceKey, undefined, (record) => {
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
    const previous = record.tail
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    record.tail = previous.catch(() => undefined).then(() => next)
    await previous.catch(() => undefined)
    try {
      signal?.throwIfAborted()
      return await work(record)
    } finally {
      release()
    }
  }

  private async withGlobalPhysicalInput<T>(
    signal: AbortSignal | undefined,
    work: () => Promise<T>
  ): Promise<T> {
    const previous = this.globalPhysicalInputTail
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    this.globalPhysicalInputTail = previous.catch(() => undefined).then(() => next)
    await previous.catch(() => undefined)
    try {
      signal?.throwIfAborted()
      return await work()
    } finally {
      release()
    }
  }
}
