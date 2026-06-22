export interface ProjectionQueue<TJob> {
  enqueue(job: TJob): void
  flush(): Promise<void>
  markDirty(job: TJob): void
}

export interface CreateProjectionQueueOptions<TJob> {
  debounceMs: number
  getKey: (job: TJob) => string
  name: string
  onError?: (job: TJob, error: unknown) => Promise<void> | void
  run: (job: TJob) => Promise<void>
  stateKey?: string
}

interface ProjectionQueueState<TJob> {
  dirtyJobs: Map<string, TJob>
  drainQueued: boolean
  flushRequested: boolean
  queue: Promise<void>
  scheduledJobs: Map<string, TJob>
  timer: ReturnType<typeof setTimeout> | null
}

const PROJECTION_QUEUE_STATES_KEY = "__jingleProjectionQueueStates__"

function createProjectionQueueState<TJob>(): ProjectionQueueState<TJob> {
  return {
    dirtyJobs: new Map(),
    drainQueued: false,
    flushRequested: false,
    queue: Promise.resolve(),
    scheduledJobs: new Map(),
    timer: null
  }
}

function getSharedProjectionQueueState<TJob>(key: string): ProjectionQueueState<TJob> {
  const globalScope = globalThis as typeof globalThis & {
    [PROJECTION_QUEUE_STATES_KEY]?: Map<string, ProjectionQueueState<unknown>>
  }
  let states = globalScope[PROJECTION_QUEUE_STATES_KEY]
  if (!states) {
    states = new Map()
    globalScope[PROJECTION_QUEUE_STATES_KEY] = states
  }

  let state = states.get(key) as ProjectionQueueState<TJob> | undefined
  if (!state) {
    state = createProjectionQueueState()
    states.set(key, state as ProjectionQueueState<unknown>)
  }

  return state
}

export function createProjectionQueue<TJob>(
  options: CreateProjectionQueueOptions<TJob>
): ProjectionQueue<TJob> {
  const state = options.stateKey
    ? getSharedProjectionQueueState<TJob>(options.stateKey)
    : createProjectionQueueState<TJob>()

  const setJob = (jobs: Map<string, TJob>, job: TJob): void => {
    jobs.set(options.getKey(job), job)
  }

  const runJob = async (job: TJob): Promise<void> => {
    try {
      await options.run(job)
    } catch (error) {
      console.warn(`[${options.name}] Projection job failed.`, error)
      if (options.onError) {
        try {
          await options.onError(job, error)
        } catch (onErrorError) {
          console.warn(`[${options.name}] Projection error handler failed.`, onErrorError)
        }
      }
    }
  }

  const drainPending = async (): Promise<void> => {
    const jobs = state.flushRequested
      ? Array.from(state.dirtyJobs.entries())
      : Array.from(state.scheduledJobs.entries())
    state.flushRequested = false

    for (const [key] of jobs) {
      state.dirtyJobs.delete(key)
      state.scheduledJobs.delete(key)
    }

    for (const [, job] of jobs) {
      await runJob(job)
    }
  }

  const queueDrain = (input: { flush: boolean }): void => {
    if (input.flush) {
      state.flushRequested = true
    }

    if (state.drainQueued) {
      return
    }

    state.drainQueued = true
    state.queue = state.queue.then(async () => {
      try {
        await drainPending()
      } finally {
        state.drainQueued = false
        if (state.scheduledJobs.size > 0) {
          scheduleDrain()
        }
      }
    })
  }

  const scheduleDrain = (): void => {
    if (state.timer || state.drainQueued) {
      return
    }

    state.timer = setTimeout(() => {
      state.timer = null
      queueDrain({ flush: false })
    }, options.debounceMs)
    state.timer.unref?.()
  }

  return {
    enqueue(job) {
      setJob(state.dirtyJobs, job)
      setJob(state.scheduledJobs, job)
      scheduleDrain()
    },
    async flush() {
      for (;;) {
        if (state.timer) {
          clearTimeout(state.timer)
          state.timer = null
          queueDrain({ flush: true })
        } else if (
          (state.dirtyJobs.size > 0 || state.scheduledJobs.size > 0) &&
          !state.drainQueued
        ) {
          queueDrain({ flush: true })
        }

        await state.queue

        if (
          !state.timer &&
          !state.drainQueued &&
          state.dirtyJobs.size === 0 &&
          state.scheduledJobs.size === 0
        ) {
          return
        }
      }
    },
    markDirty(job) {
      setJob(state.dirtyJobs, job)
    }
  }
}
