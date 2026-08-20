import type { DurableWindowThreadBindingSnapshot } from "@shared/durable-window"

export interface DurableWindowThreadBindingProjection {
  acknowledge: (
    snapshot: DurableWindowThreadBindingSnapshot
  ) => DurableWindowThreadBindingSnapshot | null
  dispose: () => void
  getCurrent: () => DurableWindowThreadBindingSnapshot | null
}

export function startDurableWindowThreadBindingProjection(input: {
  onError: (error: unknown) => void
  onSnapshot: (snapshot: DurableWindowThreadBindingSnapshot) => void
  read: () => Promise<DurableWindowThreadBindingSnapshot>
  subscribe: (listener: (snapshot: DurableWindowThreadBindingSnapshot) => void) => () => void
}): DurableWindowThreadBindingProjection {
  let active = true
  let current: DurableWindowThreadBindingSnapshot | null = null

  const accept = (snapshot: DurableWindowThreadBindingSnapshot, project: boolean): boolean => {
    if (!active) return false
    if (current?.revision === snapshot.revision && current.threadId !== snapshot.threadId) {
      input.onError(
        new Error("Durable window binding revision resolved to conflicting thread identities.")
      )
      return false
    }
    if (current && current.revision >= snapshot.revision) return false
    current = snapshot
    if (project) input.onSnapshot(snapshot)
    return true
  }

  const unsubscribe = input.subscribe((snapshot) => {
    accept(snapshot, true)
  })
  void input.read().then(
    (snapshot) => {
      accept(snapshot, true)
    },
    (error: unknown) => {
      // A live event is authoritative even if the initial snapshot read
      // rejects afterward. Do not erase a valid binding with a stale read
      // failure; only fail initialization when no snapshot was observed.
      if (active && current === null) input.onError(error)
    }
  )

  return {
    acknowledge: (snapshot) => {
      accept(snapshot, false)
      return current
    },
    dispose: () => {
      if (!active) return
      active = false
      unsubscribe()
    },
    getCurrent: () => current
  }
}
