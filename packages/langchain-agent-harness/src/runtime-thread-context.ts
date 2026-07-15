import type { RuntimeExecutionContext } from "./runtime-execution-context"
import { RuntimeThreadBusyError } from "./runtime-execution-context"
import type { RuntimeRunStart } from "./runtime-contract"
import type { RuntimeExecutionFactory } from "./runtime-execution-factory"
import type { RuntimeThreadScope } from "./runtime-scope"

interface RuntimeThreadRunReservation {
  status: "starting"
  token: symbol
}

type RuntimeThreadRunState =
  | RuntimeExecutionContext
  | (RuntimeRunStart & {
      createRunExecution: RuntimeExecutionFactory
      status: "admitted"
    })
  | RuntimeThreadRunReservation

interface RuntimeThreadActiveState {
  currentRun: RuntimeThreadRunState
  scope: RuntimeThreadScope
}

export interface RuntimeThreadContext {
  activateRun(executionContext: RuntimeExecutionContext): void
  admitRun(
    reservation: RuntimeThreadRunReservation,
    admission: RuntimeRunStart & {
      createRunExecution: RuntimeExecutionFactory
    }
  ): void
  releaseRunReservation(reservation: RuntimeThreadRunReservation): void
  reserveRun(): RuntimeThreadRunReservation
  settleRun(runId: string): void
  thread: RuntimeThreadScope
}

export interface RuntimeThreadContextRegistry {
  context(thread: RuntimeThreadScope): RuntimeThreadContext
}

export function createRuntimeThreadContextRegistry(): RuntimeThreadContextRegistry {
  const activeThreads = new Map<string, RuntimeThreadActiveState>()

  return {
    context(thread) {
      const scope = copyRuntimeThreadScope(thread)
      const active = activeThreads.get(scope.threadId)
      if (active) {
        assertRuntimeThreadScopeMatches(active.scope, scope)
      }

      return {
        activateRun(executionContext) {
          const active = readActiveThread(activeThreads, scope)
          const currentRun = active.currentRun
          if (
            !("runId" in currentRun) ||
            currentRun.runId !== executionContext.runId ||
            !("modelId" in currentRun) ||
            currentRun.modelId !== executionContext.modelId
          ) {
            throw new Error(
              `[RuntimeThread] Run execution scope does not match run "${executionContext.runId}".`
            )
          }
          if ("resolveExecution" in currentRun) {
            if (currentRun !== executionContext) {
              throw new RuntimeThreadBusyError(currentRun.runId)
            }
            return
          }
          executionContext.bindExecution(currentRun.createRunExecution)
          active.currentRun = executionContext
        },
        admitRun(reservation, admission) {
          const active = readActiveThread(activeThreads, scope)
          if (active.currentRun !== reservation) {
            throw new Error("[RuntimeThread] Run admission reservation is no longer active.")
          }
          active.currentRun = { ...admission, status: "admitted" }
        },
        releaseRunReservation(reservation) {
          const active = activeThreads.get(scope.threadId)
          if (!active) return
          assertRuntimeThreadScopeMatches(active.scope, scope)
          if (active.currentRun === reservation) {
            activeThreads.delete(scope.threadId)
          }
        },
        reserveRun() {
          const current = activeThreads.get(scope.threadId)
          if (current) {
            assertRuntimeThreadScopeMatches(current.scope, scope)
            const runId = "runId" in current.currentRun ? current.currentRun.runId : "starting"
            throw new RuntimeThreadBusyError(runId)
          }

          const reservation: RuntimeThreadRunReservation = {
            status: "starting",
            token: Symbol("runtime-thread-run-reservation")
          }
          activeThreads.set(scope.threadId, {
            currentRun: reservation,
            scope
          })
          return reservation
        },
        settleRun(runId) {
          const active = activeThreads.get(scope.threadId)
          if (!active) return
          assertRuntimeThreadScopeMatches(active.scope, scope)
          const currentRun = active.currentRun
          if (!("runId" in currentRun) || currentRun.runId !== runId) {
            return
          }
          if ("resolveExecution" in currentRun) {
            currentRun.dispose()
          }
          activeThreads.delete(scope.threadId)
        },
        thread: scope
      }
    }
  }
}

export function createRuntimeThreadContext(thread: RuntimeThreadScope): RuntimeThreadContext {
  return createRuntimeThreadContextRegistry().context(thread)
}

class RuntimeThreadScopeMismatchError extends Error {
  constructor(input: { active: RuntimeThreadScope; requested: RuntimeThreadScope }) {
    super(
      `[RuntimeThread] Active thread "${input.requested.threadId}" belongs to workspace ` +
        `"${input.active.workspacePath}", not "${input.requested.workspacePath}".`
    )
    this.name = "RuntimeThreadScopeMismatchError"
  }
}

function assertRuntimeThreadScopeMatches(
  active: RuntimeThreadScope,
  requested: RuntimeThreadScope
): void {
  if (active.threadId !== requested.threadId || active.workspacePath !== requested.workspacePath) {
    throw new RuntimeThreadScopeMismatchError({ active, requested })
  }
}

function copyRuntimeThreadScope(scope: RuntimeThreadScope): RuntimeThreadScope {
  return {
    threadId: scope.threadId,
    workspacePath: scope.workspacePath
  }
}

function readActiveThread(
  activeThreads: Map<string, RuntimeThreadActiveState>,
  scope: RuntimeThreadScope
): RuntimeThreadActiveState {
  const active = activeThreads.get(scope.threadId)
  if (!active) {
    throw new Error(`[RuntimeThread] Thread "${scope.threadId}" has no active operation.`)
  }
  assertRuntimeThreadScopeMatches(active.scope, scope)
  return active
}
