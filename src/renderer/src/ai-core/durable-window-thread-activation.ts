import type { DurableWindowThreadBindingSnapshot } from "@shared/durable-window"

export type DurableWindowThreadActivationProjection =
  | {
      bindingRevision: null
      error: null
      phase: "initializing"
      threadId: string | null
    }
  | {
      bindingRevision: number
      error: null
      phase: "pending" | "ready"
      threadId: string | null
    }
  | {
      bindingRevision: number | null
      error: string
      phase: "failed"
      threadId: string | null
    }

export interface DurableWindowThreadActivationCoordinator {
  acceptBinding: (snapshot: DurableWindowThreadBindingSnapshot) => Promise<void>
  clearError: () => void
  dispose: () => void
  getState: () => DurableWindowThreadActivationProjection
  requestActivation: (threadId: string) => Promise<DurableWindowThreadBindingSnapshot>
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createDurableWindowThreadActivationCoordinator(input: {
  bind: (threadId: string) => Promise<DurableWindowThreadBindingSnapshot>
  cleanup: (threadId: string) => void
  hydrate: (threadId: string) => Promise<void>
  onBinding: (snapshot: DurableWindowThreadBindingSnapshot) => void
  onState: (state: DurableWindowThreadActivationProjection) => void
}): DurableWindowThreadActivationCoordinator {
  let active = true
  let generation = 0
  let state: DurableWindowThreadActivationProjection = {
    bindingRevision: null,
    error: null,
    phase: "initializing",
    threadId: null
  }
  let pending:
    | { promise: Promise<void>; revision: number; threadId: string; work: Promise<void> }
    | undefined

  const publish = (next: DurableWindowThreadActivationProjection): void => {
    if (!active) return
    state = Object.freeze(next)
    input.onState(state)
  }

  const activateBinding = (
    snapshot: DurableWindowThreadBindingSnapshot,
    retryFailed: boolean
  ): Promise<void> => {
    if (!active) return Promise.resolve()
    if (state.bindingRevision !== null && snapshot.revision < state.bindingRevision) {
      return Promise.resolve()
    }
    if (snapshot.revision === state.bindingRevision && snapshot.threadId !== state.threadId) {
      return Promise.reject(
        new Error("Durable window binding revision resolved to conflicting thread identities.")
      )
    }
    if (pending?.revision === snapshot.revision && pending.threadId === snapshot.threadId) {
      return pending.promise
    }
    if (
      snapshot.revision === state.bindingRevision &&
      snapshot.threadId === state.threadId &&
      (state.phase === "ready" || (state.phase === "failed" && !retryFailed))
    ) {
      return state.phase === "failed" ? Promise.reject(new Error(state.error)) : Promise.resolve()
    }

    generation += 1
    const activationGeneration = generation
    input.onBinding(snapshot)
    if (snapshot.threadId === null) {
      pending = undefined
      publish({
        bindingRevision: snapshot.revision,
        error: null,
        phase: "ready",
        threadId: null
      })
      return Promise.resolve()
    }

    const threadId = snapshot.threadId
    publish({
      bindingRevision: snapshot.revision,
      error: null,
      phase: "pending",
      threadId
    })
    const work = pending?.threadId === threadId ? pending.work : input.hydrate(threadId)
    const promise = work.then(
      () => {
        if (!active || activationGeneration !== generation) {
          if (!active || state.threadId !== threadId) input.cleanup(threadId)
          return
        }
        pending = undefined
        publish({
          bindingRevision: snapshot.revision,
          error: null,
          phase: "ready",
          threadId
        })
      },
      (error: unknown) => {
        if (!active || activationGeneration !== generation) {
          if (!active || state.threadId !== threadId) input.cleanup(threadId)
          return
        }
        input.cleanup(threadId)
        pending = undefined
        publish({
          bindingRevision: snapshot.revision,
          error: toErrorMessage(error),
          phase: "failed",
          threadId
        })
        throw error
      }
    )
    pending = { promise, revision: snapshot.revision, threadId, work }
    return promise
  }

  return {
    acceptBinding: (snapshot) => activateBinding(snapshot, false),
    clearError: () => {
      if (state.phase !== "failed" || state.bindingRevision === null) return
      publish({
        bindingRevision: state.bindingRevision,
        error: null,
        phase: "ready",
        threadId: state.threadId
      })
    },
    dispose: () => {
      if (!active) return
      active = false
      generation += 1
      pending = undefined
    },
    getState: () => state,
    requestActivation: async (threadId) => {
      const snapshot = await input.bind(threadId)
      if (snapshot.threadId !== threadId) {
        await activateBinding(snapshot, false)
        throw new Error("Durable window committed a different thread binding.")
      }
      await activateBinding(snapshot, true)
      if (state.bindingRevision !== snapshot.revision || state.threadId !== snapshot.threadId) {
        if (state.bindingRevision === null) {
          throw new Error("Durable window binding became unavailable during activation.")
        }
        return {
          revision: state.bindingRevision,
          threadId: state.threadId
        }
      }
      return snapshot
    }
  }
}
