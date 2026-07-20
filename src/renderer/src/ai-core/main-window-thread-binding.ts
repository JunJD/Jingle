import type { MainWindowThreadBindingSnapshot } from "@shared/durable-window"

export interface MainWindowThreadBindingProjection {
  acknowledge: (snapshot: MainWindowThreadBindingSnapshot) => MainWindowThreadBindingSnapshot | null
  dispose: () => void
  getCurrent: () => MainWindowThreadBindingSnapshot | null
}

export function startMainWindowThreadBindingProjection(input: {
  onError: (error: unknown) => void
  onSnapshot: (snapshot: MainWindowThreadBindingSnapshot) => void
  read: () => Promise<MainWindowThreadBindingSnapshot>
  subscribe: (listener: (snapshot: MainWindowThreadBindingSnapshot) => void) => () => void
}): MainWindowThreadBindingProjection {
  let active = true
  let current: MainWindowThreadBindingSnapshot | null = null

  const accept = (snapshot: MainWindowThreadBindingSnapshot, project: boolean): boolean => {
    if (!active || (current && current.revision >= snapshot.revision)) {
      return false
    }
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
      if (active) input.onError(error)
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
