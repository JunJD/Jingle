import {
  computerUseBackendFailurePrecludesSuccessorObservation,
  type ComputerUseBackend,
  type ComputerUseBackendExecutionResult,
  type ComputerUseIdentifyRequest,
  type ComputerUseObservation,
  type ComputerUseObserveRequest,
  type ComputerUseSemanticAction,
  type ComputerUseTraceEvent,
  type ComputerUseTraceOperation,
  type ComputerUseTraceSink,
  type ComputerUseTransactionResult
} from "./contract"
import { sameComputerUseWindowIdentity } from "./authorization"
import { ComputerUseActionLedger, type ComputerUseActionAttemptClaim } from "./action-ledger"
import { parseComputerUseSemanticActions, sameComputerUseSemanticAction } from "./semantic-action"
import { computerUseResultAllowsForegroundRetry } from "./retry-disposition"
import { ComputerUseResourceScheduler } from "./scheduler"
import { ComputerUseSessionManager } from "./session-manager"
import { ComputerUseObservationStore } from "./state-store"

export class ComputerUseTransactionCoordinator {
  constructor(
    private readonly backend: ComputerUseBackend,
    private readonly scheduler: ComputerUseResourceScheduler,
    private readonly sessions: ComputerUseSessionManager,
    private readonly ledger: ComputerUseActionLedger,
    private readonly observations = new ComputerUseObservationStore(),
    private readonly traceSink: ComputerUseTraceSink = { record: () => undefined }
  ) {}

  async identify(request: ComputerUseIdentifyRequest) {
    request.signal?.throwIfAborted()
    return this.backend.identify(request)
  }

  async observe(request: ComputerUseObserveRequest): Promise<ComputerUseObservation> {
    request.signal?.throwIfAborted()
    return this.scheduler.read(
      request.target.resourceKey,
      async (epoch) => {
        request.signal?.throwIfAborted()
        const current = await this.backend.observe(request)
        if (
          current.application.id !== request.target.application.id ||
          current.resourceKey !== request.target.resourceKey ||
          !sameComputerUseWindowIdentity(current.window, request.target.window)
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
    const actions = parseComputerUseSemanticActions(input.actions, "transaction.actions")
    const base = this.observations.get(input.baseStateId)
    let sessionSignal: AbortSignal | undefined
    let authorization: ReturnType<ComputerUseSessionManager["assertAuthorized"]> | undefined
    let authorizationError: unknown
    if (base) {
      try {
        sessionSignal = this.sessions.signal(input.sessionId)
        authorization = this.sessions.assertAuthorized({
          observation: base,
          runId: input.runId,
          sessionId: input.sessionId,
          threadId: input.threadId
        })
      } catch (error) {
        authorizationError = error
      }
    }
    const existing = await this.ledger.find(input.transactionId)
    if (existing) return this.recover(existing, input, actions, base)
    if (!base) throw new Error("Computer-use state is missing or was evicted. Observe again.")
    if (authorizationError) throw authorizationError
    if (!authorization || !sessionSignal) {
      throw new Error("Computer-use authorization was not captured for this transaction.")
    }
    this.validateActions(actions, base)
    const claim = await this.ledger.begin({
      actions,
      authorization,
      baseStateId: base.stateId,
      target: {
        applicationId: base.application.id,
        resourceKey: base.resourceKey,
        window: base.window
      },
      transactionId: input.transactionId
    })
    if (claim.status === "existing") return this.recover(claim, input, actions, base)
    const attempt = claim.attempt
    const signal = input.signal ? AbortSignal.any([input.signal, sessionSignal]) : sessionSignal
    if (signal.aborted) {
      return this.ledger.cancel(attempt.attemptId)
    }
    const initialDelivery = actions[0]?.kind === "activate" ? "foreground" : "background"
    const unsupported = this.preflight(actions, base.stateId, initialDelivery)
    if (unsupported) {
      return this.ledger.settle(attempt.attemptId, unsupported)
    }
    let execution: ComputerUseBackendExecutionResult | undefined
    let operation: ComputerUseTraceOperation = "scheduler"

    try {
      return await this.scheduler.write({
        expectedEpoch: base.epoch,
        // Conservative V1 boundary: every mutation holds the global lease until
        // a native route preflight can prove a semantic-only delivery.
        physicalInput: true,
        resourceKey: base.resourceKey,
        signal,
        work: async (commit) => {
          const initialAuthorization = this.sessions.assertAuthorized({
            observation: base,
            runId: input.runId,
            sessionId: input.sessionId,
            threadId: input.threadId
          })
          signal.throwIfAborted()
          const dispatch = await this.ledger.dispatched(attempt.attemptId)
          if (dispatch.status === "conflict") {
            return this.recover(
              { attempt: dispatch.attempt, source: "durable", status: "existing" },
              input,
              actions,
              base
            )
          }
          const nextEpoch = commit()
          operation = initialDelivery === "background" ? "execute_background" : "execute_foreground"
          execution = this.validateExecution(
            await this.backend.execute({
              actions,
              authorization: initialAuthorization,
              base,
              delivery: initialDelivery,
              signal
            }),
            actions,
            initialDelivery,
            base.stateId
          )
          if (
            initialDelivery === "background" &&
            computerUseResultAllowsForegroundRetry(execution, actions)
          ) {
            const foregroundUnavailable = this.preflight(actions, base.stateId, "foreground")
            if (!foregroundUnavailable) {
              signal.throwIfAborted()
              const foregroundAuthorization = this.sessions.assertAuthorized({
                observation: base,
                runId: input.runId,
                sessionId: input.sessionId,
                threadId: input.threadId
              })
              operation = "execute_foreground"
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
          operation = "observe_successor"
          const successor = await this.backend.observe({
            signal,
            target: {
              application: base.application,
              resourceKey: base.resourceKey,
              window: base.window
            }
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
          return this.ledger.settle(attempt.attemptId, result)
        }
      })
    } catch (error) {
      const current = this.ledger.get(attempt.attemptId)
      this.recordFailure({
        dispatchOccurred: current?.phase === "dispatched",
        error,
        operation,
        runId: input.runId,
        threadId: input.threadId,
        transactionId: input.transactionId
      })
      const cancelled =
        signal.aborted || (error instanceof DOMException && error.name === "AbortError")
      if (!cancelled && current?.phase === "queued") {
        await this.ledger.settle(attempt.attemptId, {
          baseStateId: base.stateId,
          outcome: "unavailable",
          steps: []
        })
        throw error
      }
      if (current?.phase === "queued") return this.ledger.cancel(attempt.attemptId)
      const successor = computerUseBackendFailurePrecludesSuccessorObservation(error)
        ? undefined
        : await this.observeAfterUnknown(base, {
            runId: input.runId,
            threadId: input.threadId,
            transactionId: input.transactionId
          })
      return this.ledger.settle(attempt.attemptId, {
        baseStateId: base.stateId,
        outcome: "unknown",
        steps: execution?.steps ?? [],
        ...(successor ? { successor } : {})
      })
    }
  }

  private async recover(
    claim: ComputerUseActionAttemptClaim,
    input: {
      baseStateId: string
      runId: string
      sessionId: string
      threadId: string
    },
    actions: readonly ComputerUseSemanticAction[],
    base: ComputerUseObservation | undefined
  ): Promise<ComputerUseTransactionResult> {
    const { attempt } = claim
    const matches =
      attempt.baseStateId === input.baseStateId &&
      attempt.authorization.runId === input.runId &&
      attempt.authorization.sessionId === input.sessionId &&
      attempt.authorization.threadId === input.threadId &&
      (!base ||
        (attempt.target.applicationId === base.application.id &&
          attempt.target.resourceKey === base.resourceKey &&
          sameComputerUseWindowIdentity(attempt.target.window, base.window))) &&
      attempt.actions.length === actions.length &&
      attempt.actions.every((action, index) =>
        sameComputerUseSemanticAction(action, actions[index]!)
      )
    if (!matches) {
      return freeze({ baseStateId: input.baseStateId, outcome: "refused", steps: [] })
    }
    if (attempt.phase === "settled") {
      if (!attempt.result)
        throw new Error(`Computer-use action attempt ${attempt.attemptId} lost its result.`)
      return attempt.result
    }
    if (claim.source === "local") {
      return freeze({
        baseStateId: input.baseStateId,
        outcome: attempt.phase === "queued" ? "refused" : "unknown",
        steps: []
      })
    }
    return this.ledger.cancel(attempt.attemptId)
  }

  private async observeAfterUnknown(
    base: ComputerUseObservation,
    trace: { runId: string; threadId: string; transactionId: string }
  ): Promise<ComputerUseObservation | undefined> {
    try {
      return await this.scheduler.read(base.resourceKey, async (epoch) => {
        const successor = await this.backend.observe({
          target: {
            application: base.application,
            resourceKey: base.resourceKey,
            window: base.window
          }
        })
        if (
          successor.resourceKey !== base.resourceKey ||
          !sameComputerUseWindowIdentity(successor.window, base.window)
        ) {
          return undefined
        }
        return this.observations.create({ ...successor, epoch })
      })
    } catch (error) {
      this.recordFailure({
        dispatchOccurred: true,
        error,
        operation: "observe_recovery",
        ...trace
      })
      return undefined
    }
  }

  private recordFailure(input: {
    dispatchOccurred: boolean
    error: unknown
    operation: ComputerUseTraceOperation
    runId: string
    threadId: string
    transactionId: string
  }): void {
    const event: ComputerUseTraceEvent = {
      dispatchOccurred: input.dispatchOccurred,
      environment: this.backend.matrix.environment,
      errorCode: readDiagnosticCode(input.error, "code") ?? readErrorName(input.error),
      kind: "operation_failed",
      ...(readDiagnosticCode(input.error, "nativeCode")
        ? { nativeCode: readDiagnosticCode(input.error, "nativeCode")! }
        : {}),
      operation: input.operation,
      platform: this.backend.matrix.platform,
      runId: input.runId,
      threadId: input.threadId,
      transactionId: input.transactionId
    }
    try {
      this.traceSink.record(Object.freeze(event))
    } catch {
      // Diagnostics must never replace the canonical ledger outcome.
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
    const activation = actions.find((action) => action.kind === "activate")
    if (activation) {
      if (actions.length !== 1) {
        throw new Error("Computer-use activate must be a single-action transaction.")
      }
      const roots = base.elements.filter((element) => element.index === 0)
      if (roots.length !== 1 || roots[0]?.ref !== activation.ref) {
        throw new Error("Computer-use activate ref must identify the current window root.")
      }
    }
    const elements = new Map(base.elements.map((element) => [element.ref, element]))
    for (const action of actions) {
      const element = elements.get(action.ref)
      if (!element)
        throw new Error(`Computer-use ref ${action.ref} is not owned by ${base.stateId}.`)
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
    if (result.steps.length > actions.length)
      throw new Error("Computer-use backend returned extra steps.")
    if (result.stoppedAt !== undefined && result.stoppedAt !== result.steps.length - 1) {
      throw new Error("Computer-use backend returned an inconsistent stoppedAt boundary.")
    }
    result.steps.forEach((step, index) => {
      const action = actions[index]
      if (!action || !sameComputerUseSemanticAction(step.action, action)) {
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
      const evidenceIsConsistent =
        (step.outcome === "worked" &&
          step.evidence.verification === "verified" &&
          !step.evidence.noSideEffectProof) ||
        (step.outcome === "unknown" &&
          step.evidence.verification === "unverifiable" &&
          !step.evidence.noSideEffectProof) ||
        ((step.outcome === "didnt" ||
          step.outcome === "refused" ||
          step.outcome === "unavailable") &&
          step.evidence.verification === "failed" &&
          step.evidence.noSideEffectProof)
      if (!evidenceIsConsistent) {
        throw new Error("Computer-use backend returned contradictory step evidence.")
      }
    })
    const stepOutcomes = new Set(result.steps.map((step) => step.outcome))
    if (result.outcome === "worked") {
      if (
        result.stoppedAt !== undefined ||
        result.steps.length !== actions.length ||
        stepOutcomes.size !== 1 ||
        !stepOutcomes.has("worked")
      ) {
        throw new Error("Computer-use backend returned an inconsistent worked transaction.")
      }
    } else if (result.outcome === "didnt") {
      if (
        result.steps.length !== actions.length ||
        stepOutcomes.size !== 1 ||
        !stepOutcomes.has("didnt")
      ) {
        throw new Error("Computer-use backend returned an inconsistent didnt transaction.")
      }
    } else if (result.outcome === "unknown") {
      if (result.steps.length === 0 || result.stoppedAt !== result.steps.length - 1) {
        throw new Error("Computer-use backend returned unknown without a stopped step prefix.")
      }
    } else if (result.outcome === "refused" || result.outcome === "unavailable") {
      if (result.steps.length === 0) {
        if (result.stoppedAt !== undefined) {
          throw new Error("Computer-use backend empty refusal contains a stoppedAt boundary.")
        }
      } else if (
        result.stoppedAt !== result.steps.length - 1 ||
        result.steps.at(-1)?.outcome !== result.outcome ||
        result.steps
          .slice(0, -1)
          .some((step) => step.outcome === "worked" || step.outcome === "unknown")
      ) {
        throw new Error("Computer-use backend refusal has an inconsistent stopped step prefix.")
      }
    }
    return result
  }
}

function readDiagnosticCode(error: unknown, key: "code" | "nativeCode"): string | null {
  if (!error || typeof error !== "object") return null
  const value = (error as Record<string, unknown>)[key]
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : null
}

function readErrorName(error: unknown): string {
  if (!(error instanceof Error)) return "unknown"
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name) ? error.name : "Error"
}

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested)
  return Object.freeze(value)
}
