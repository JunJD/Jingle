import type {
  ComputerUseBackend,
  ComputerUseBackendExecutionResult,
  ComputerUseObservation,
  ComputerUseObserveRequest,
  ComputerUseSemanticAction,
  ComputerUseTransactionResult
} from "./contract"
import { sameComputerUseWindowIdentity } from "./authorization"
import { ComputerUseActionLedger } from "./action-ledger"
import { ComputerUseResourceScheduler } from "./scheduler"
import { ComputerUseSessionManager } from "./session-manager"
import { ComputerUseObservationStore } from "./state-store"

function sameAction(left: ComputerUseSemanticAction, right: ComputerUseSemanticAction): boolean {
  return (
    left.kind === right.kind &&
    left.ref === right.ref &&
    left.value === right.value &&
    left.scrollAmount === right.scrollAmount &&
    sameKeys(left.keys, right.keys)
  )
}

function sameKeys(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): boolean {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((key, index) => key === right[index])
}

function mayRetryForeground(
  result: ComputerUseBackendExecutionResult,
  actions: readonly ComputerUseSemanticAction[]
): boolean {
  return (
    result.outcome === "didnt" &&
    result.steps.length === actions.length &&
    result.stoppedAt === undefined &&
    result.steps.every(
      (step, index) =>
        sameAction(step.action, actions[index]!) &&
        step.outcome === "didnt" &&
        step.evidence.noSideEffectProof &&
        step.evidence.verification === "failed"
    )
  )
}

export class ComputerUseTransactionCoordinator {
  constructor(
    private readonly backend: ComputerUseBackend,
    private readonly scheduler: ComputerUseResourceScheduler,
    private readonly sessions: ComputerUseSessionManager,
    private readonly ledger: ComputerUseActionLedger,
    private readonly observations = new ComputerUseObservationStore()
  ) {}

  async observe(request: ComputerUseObserveRequest): Promise<ComputerUseObservation> {
    request.signal?.throwIfAborted()
    const discovery = await this.backend.observe(request)
    return this.scheduler.read(
      discovery.resourceKey,
      async (epoch) => {
        request.signal?.throwIfAborted()
        const current = await this.backend.observe(request)
        if (
          current.resourceKey !== discovery.resourceKey ||
          !sameComputerUseWindowIdentity(current.window, discovery.window)
        ) {
          throw new Error("Computer-use target changed while it was being observed.")
        }
        return this.observations.create({ ...current, epoch })
      },
      request.signal
    )
  }

  async execute(input: {
    actions: readonly ComputerUseSemanticAction[]
    baseStateId: string
    runId: string
    sessionId: string
    signal?: AbortSignal
    threadId: string
    transactionId: string
  }): Promise<ComputerUseTransactionResult> {
    const actions = freeze(structuredClone(input.actions))
    const base = this.observations.get(input.baseStateId)
    if (!base) throw new Error("Computer-use state is missing or was evicted. Observe again.")
    this.validateActions(actions, base)
    const sessionSignal = this.sessions.signal(input.sessionId)
    this.sessions.assertAuthorized({
      observation: base,
      runId: input.runId,
      sessionId: input.sessionId,
      threadId: input.threadId
    })
    const attempt = await this.ledger.begin({
      runId: input.runId,
      sessionId: input.sessionId,
      transactionId: input.transactionId
    })
    const signal = input.signal
      ? AbortSignal.any([input.signal, sessionSignal])
      : sessionSignal
    const unsupported = this.preflight(actions, base.stateId, "background")
    if (unsupported) {
      await this.ledger.settle(attempt.attemptId, unsupported.outcome)
      return unsupported
    }
    let execution: ComputerUseBackendExecutionResult | undefined

    try {
      return await this.scheduler.write({
        expectedEpoch: base.epoch,
        // Conservative V1 boundary: every mutation holds the global lease until
        // a native route preflight can prove a semantic-only delivery.
        physicalInput: true,
        resourceKey: base.resourceKey,
        signal,
        work: async (commit) => {
          const backgroundAuthorization = this.sessions.assertAuthorized({
            observation: base,
            runId: input.runId,
            sessionId: input.sessionId,
            threadId: input.threadId
          })
          signal.throwIfAborted()
          await this.ledger.dispatched(attempt.attemptId)
          const nextEpoch = commit()
          execution = this.validateExecution(
            await this.backend.execute({
              actions,
              authorization: backgroundAuthorization,
              base,
              delivery: "background",
              signal
            }),
            actions,
            "background",
            base.stateId
          )
          if (mayRetryForeground(execution, actions)) {
            const foregroundUnavailable = this.preflight(
              actions,
              base.stateId,
              "foreground"
            )
            if (!foregroundUnavailable) {
              signal.throwIfAborted()
              const foregroundAuthorization = this.sessions.assertAuthorized({
                observation: base,
                runId: input.runId,
                sessionId: input.sessionId,
                threadId: input.threadId
              })
              execution = this.validateExecution(
                await this.backend.execute({
                  actions,
                  authorization: foregroundAuthorization,
                  base,
                  delivery: "foreground",
                  signal
                }),
                actions,
                "foreground",
                base.stateId
              )
            }
          }
          const successor = await this.backend.observe({
            applicationId: base.application.id,
            applicationName: base.application.name,
            signal,
            windowId: base.window.nativeId
          })
          const identityChanged =
            successor.resourceKey !== base.resourceKey ||
            !sameComputerUseWindowIdentity(successor.window, base.window)
          const result: ComputerUseTransactionResult = identityChanged
            ? { ...execution, outcome: "unknown" }
            : {
                ...execution,
                successor: this.observations.create({ ...successor, epoch: nextEpoch })
              }
          await this.ledger.settle(attempt.attemptId, result.outcome)
          return result
        }
      })
    } catch (error) {
      const current = this.ledger.get(attempt.attemptId)
      const cancelled =
        signal.aborted || (error instanceof DOMException && error.name === "AbortError")
      if (!cancelled && current?.phase === "queued") {
        await this.ledger.settle(attempt.attemptId, "unavailable")
        throw error
      }
      const outcome = await this.ledger.cancel(attempt.attemptId)
      if (outcome !== "unknown") return { baseStateId: base.stateId, outcome, steps: [] }
      const successor = await this.observeAfterUnknown(base)
      return {
        baseStateId: base.stateId,
        outcome,
        steps: execution?.steps ?? [],
        successor
      }
    }
  }

  private async observeAfterUnknown(
    base: ComputerUseObservation
  ): Promise<ComputerUseObservation | undefined> {
    try {
      return await this.scheduler.read(base.resourceKey, async (epoch) => {
        const successor = await this.backend.observe({
          applicationId: base.application.id,
          applicationName: base.application.name,
          windowId: base.window.nativeId
        })
        if (
          successor.resourceKey !== base.resourceKey ||
          !sameComputerUseWindowIdentity(successor.window, base.window)
        ) {
          return undefined
        }
        return this.observations.create({ ...successor, epoch })
      })
    } catch {
      return undefined
    }
  }

  private preflight(
    actions: readonly ComputerUseSemanticAction[],
    baseStateId: string,
    delivery: "background" | "foreground"
  ): ComputerUseBackendExecutionResult | null {
    for (const action of actions) {
      const capability = this.backend.matrix.capabilities.find(
        (candidate) => candidate.action === action.kind
      )
      if (capability?.[delivery] === "verified") continue
      const outcome = capability?.[delivery] === "refused" ? "refused" : "unavailable"
      return {
        baseStateId,
        outcome,
        steps: []
      }
    }
    return null
  }

  private validateActions(
    actions: readonly ComputerUseSemanticAction[],
    base: ComputerUseObservation
  ): void {
    if (actions.length === 0) throw new Error("Computer-use transaction requires actions.")
    const elements = new Map(base.elements.map((element) => [element.ref, element]))
    for (const action of actions) {
      const element = elements.get(action.ref)
      if (!element) throw new Error(`Computer-use ref ${action.ref} is not owned by ${base.stateId}.`)
      if (!element.actions.includes(action.kind)) {
        throw new Error(`Computer-use ref ${action.ref} does not support ${action.kind}.`)
      }
    }
  }

  private validateExecution(
    result: ComputerUseBackendExecutionResult,
    actions: readonly ComputerUseSemanticAction[],
    delivery: "background" | "foreground",
    baseStateId: string
  ): ComputerUseBackendExecutionResult {
    if (
      (result as ComputerUseTransactionResult).outcome === "cancelled_before_dispatch" ||
      result.steps.some(
        (step) =>
          (step as ComputerUseTransactionResult["steps"][number]).outcome ===
          "cancelled_before_dispatch"
      )
    ) {
      throw new Error("Computer-use backend reported pre-dispatch cancellation after dispatch.")
    }
    if (result.baseStateId !== baseStateId) {
      throw new Error("Computer-use backend result belongs to another base state.")
    }
    if (result.steps.length > actions.length) throw new Error("Computer-use backend returned extra steps.")
    if (result.stoppedAt !== undefined && result.stoppedAt !== result.steps.length - 1) {
      throw new Error("Computer-use backend returned an inconsistent stoppedAt boundary.")
    }
    result.steps.forEach((step, index) => {
      const action = actions[index]
      if (!action || !sameAction(step.action, action)) {
        throw new Error("Computer-use backend returned steps out of order.")
      }
      const capability = this.backend.matrix.capabilities.find(
        (candidate) => candidate.action === action.kind
      )
      if (!capability || capability[delivery] !== "verified") {
        throw new Error(`Computer-use backend executed unverified ${delivery} capability.`)
      }
      if (step.evidence.route !== capability.route) {
        throw new Error("Computer-use backend evidence route does not match its capability matrix.")
      }
      if (delivery === "background" && step.evidence.delivery === "global_input") {
        throw new Error("Computer-use backend used global input for a background action.")
      }
      if (step.outcome === "worked" && step.evidence.verification !== "verified") {
        throw new Error("Computer-use backend reported worked without verified evidence.")
      }
    })
    const stepOutcomes = new Set(result.steps.map((step) => step.outcome))
    if (result.outcome === "worked") {
      if (result.steps.length !== actions.length || stepOutcomes.size !== 1 || !stepOutcomes.has("worked")) {
        throw new Error("Computer-use backend returned an inconsistent worked transaction.")
      }
    } else if (result.outcome === "didnt") {
      if (result.steps.length !== actions.length || stepOutcomes.size !== 1 || !stepOutcomes.has("didnt")) {
        throw new Error("Computer-use backend returned an inconsistent didnt transaction.")
      }
    } else if (result.outcome === "refused" || result.outcome === "unavailable") {
      if ([...stepOutcomes].some((outcome) => outcome === "worked" || outcome === "unknown")) {
        throw new Error("Computer-use backend refusal contradicts dispatched step outcomes.")
      }
    }
    return result
  }
}

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested)
  return Object.freeze(value)
}

export function computerUseResultAllowsForegroundRetry(
  result: ComputerUseBackendExecutionResult,
  actions: readonly ComputerUseSemanticAction[] = result.steps.map((step) => step.action)
): boolean {
  return mayRetryForeground(result, actions)
}
