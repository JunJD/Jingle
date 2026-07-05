export interface JingleThreadStateStore<TState> {
  deleteThreadState: (threadId: string) => void
  ensureThreadState: (threadId: string) => boolean
  getThreadState: (threadId: string) => TState | null
  subscribeThread: (threadId: string, listener: () => void) => () => void
  updateThreadState: (threadId: string, updater: (current: TState) => TState) => void
}

export interface JingleThreadStateStoreOptions<TState> {
  createState: (threadId: string) => TState
}

export function createJingleThreadStateStore<TState>(
  options: JingleThreadStateStoreOptions<TState>
): JingleThreadStateStore<TState> {
  const threadListeners = new Map<string, Set<() => void>>()
  let threadStates: Record<string, TState> = {}

  function emitThread(threadId: string): void {
    threadListeners.get(threadId)?.forEach((listener) => listener())
  }

  function ensureThreadState(threadId: string): boolean {
    if (threadStates[threadId]) {
      return false
    }

    threadStates = {
      ...threadStates,
      [threadId]: options.createState(threadId)
    }
    emitThread(threadId)
    return true
  }

  function deleteThreadState(threadId: string): void {
    if (!Object.hasOwn(threadStates, threadId)) {
      return
    }

    const { [threadId]: _deletedThreadState, ...restThreadStates } = threadStates
    void _deletedThreadState
    threadStates = restThreadStates
    emitThread(threadId)
  }

  function updateThreadState(threadId: string, updater: (current: TState) => TState): void {
    const current = threadStates[threadId] ?? options.createState(threadId)
    const next = updater(current)
    if (Object.is(next, current)) {
      return
    }

    threadStates = {
      ...threadStates,
      [threadId]: next
    }
    emitThread(threadId)
  }

  function subscribeThread(threadId: string, listener: () => void): () => void {
    let listeners = threadListeners.get(threadId)
    if (!listeners) {
      listeners = new Set()
      threadListeners.set(threadId, listeners)
    }

    listeners.add(listener)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        threadListeners.delete(threadId)
      }
    }
  }

  return {
    deleteThreadState,
    ensureThreadState,
    getThreadState: (threadId) => threadStates[threadId] ?? null,
    subscribeThread,
    updateThreadState
  }
}
