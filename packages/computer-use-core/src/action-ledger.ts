import type {
  ComputerUseActionKind,
  ComputerUseAuthorizationGrant,
  ComputerUseObservation,
  ComputerUseOutcome,
  ComputerUseSemanticAction,
  ComputerUseStepResult,
  ComputerUseTransactionResult,
  ComputerUseWindowIdentity
} from "./contract"
import { sameComputerUseWindowIdentity } from "./authorization"
import {
  parseComputerUseSemanticAction,
  parseComputerUseSemanticActions,
  sameComputerUseSemanticAction
} from "./semantic-action"

const ACTION_KINDS = new Set<ComputerUseActionKind>([
  "keypress",
  "press",
  "scroll",
  "set_value",
  "type_text"
])
const ATTEMPT_PHASES = new Set<ComputerUseAttemptPhase>(["dispatched", "queued", "settled"])
const OUTCOMES = new Set<ComputerUseOutcome>([
  "cancelled_before_dispatch",
  "didnt",
  "refused",
  "unavailable",
  "unknown",
  "worked"
])

export type ComputerUseAttemptPhase = "queued" | "dispatched" | "settled"
export type ComputerUseActionAttemptSource = "durable" | "local"

export interface ComputerUseActionAttempt {
  actions: readonly ComputerUseSemanticAction[]
  attemptId: string
  authorization: ComputerUseAuthorizationGrant
  baseStateId: string
  dispatchedAt?: number
  phase: ComputerUseAttemptPhase
  revision: number
  result?: ComputerUseTransactionResult
  startedAt: number
  settledAt?: number
  target: ComputerUseActionTarget
}

export interface ComputerUseActionTarget {
  applicationId: string
  resourceKey: string
  window: ComputerUseWindowIdentity
}

export type ComputerUseActionAttemptReservation =
  | { status: "reserved" }
  | { attempt: ComputerUseActionAttempt; status: "exists" }

export interface ComputerUseActionAttemptClaim {
  attempt: ComputerUseActionAttempt
  source: ComputerUseActionAttemptSource
  status: "existing" | "reserved"
}

export type ComputerUseActionAttemptTransition =
  | { attempt: ComputerUseActionAttempt; status: "applied" }
  | { attempt: ComputerUseActionAttempt; status: "conflict" }

export type ComputerUseActionLedgerPortTransition =
  | { status: "applied" }
  | { current: ComputerUseActionAttempt; status: "conflict" }

export interface ComputerUseActionLedgerPort {
  read(attemptId: string): Promise<ComputerUseActionAttempt | undefined>
  reserve(attempt: ComputerUseActionAttempt): Promise<ComputerUseActionAttemptReservation>
  transition(input: {
    attempt: ComputerUseActionAttempt
    expectedPhase: Exclude<ComputerUseAttemptPhase, "settled">
    expectedRevision: number
  }): Promise<ComputerUseActionLedgerPortTransition>
}

export function parseComputerUseActionAttempt(
  input: unknown,
  expectedAttemptId?: string
): ComputerUseActionAttempt {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Computer-use action attempt must be an object.")
  }
  return normalizeAttempt(input as ComputerUseActionAttempt, expectedAttemptId)
}

export class ComputerUseActionLedger {
  private readonly attempts = new Map<string, ComputerUseActionAttempt>()
  private readonly attemptSources = new Map<string, ComputerUseActionAttemptSource>()
  private readonly reservations = new Map<string, Promise<ComputerUseActionAttemptClaim>>()

  constructor(private readonly port: ComputerUseActionLedgerPort) {}

  async find(transactionId: string): Promise<ComputerUseActionAttemptClaim | undefined> {
    const attemptId = normalizeId(transactionId, "transactionId")
    const local = this.attempts.get(attemptId)
    if (local) {
      return {
        attempt: local,
        source: this.attemptSources.get(attemptId) ?? "local",
        status: "existing"
      }
    }
    const reservation = this.reservations.get(attemptId)
    if (reservation) {
      const claim = await reservation
      return { ...claim, status: "existing" }
    }
    const durable = await this.port.read(attemptId)
    if (!durable) return undefined
    const attempt = normalizeAttempt(durable, attemptId)
    this.attempts.set(attemptId, attempt)
    this.attemptSources.set(attemptId, "durable")
    return { attempt, source: "durable", status: "existing" }
  }

  async begin(input: {
    actions: readonly ComputerUseSemanticAction[]
    authorization: ComputerUseAuthorizationGrant
    baseStateId: string
    target: ComputerUseActionTarget
    transactionId: string
  }): Promise<ComputerUseActionAttemptClaim> {
    const attemptId = normalizeId(input.transactionId, "transactionId")
    const local = this.attempts.get(attemptId)
    if (local) {
      return {
        attempt: local,
        source: this.attemptSources.get(attemptId) ?? "local",
        status: "existing"
      }
    }
    const pending = this.reservations.get(attemptId)
    if (pending) {
      const claim = await pending
      return { ...claim, status: "existing" }
    }
    const reservation = this.reserve({ ...input, transactionId: attemptId })
    this.reservations.set(attemptId, reservation)
    try {
      return await reservation
    } finally {
      this.reservations.delete(attemptId)
    }
  }

  async dispatched(attemptId: string): Promise<ComputerUseActionAttemptTransition> {
    const attempt = this.require(attemptId)
    if (attempt.phase !== "queued") {
      throw new Error(
        `Computer-use action attempt ${attemptId} cannot dispatch from ${attempt.phase}.`
      )
    }
    return this.transition(attempt, {
      ...attempt,
      dispatchedAt: Date.now(),
      phase: "dispatched",
      revision: attempt.revision + 1
    })
  }

  async settle(
    attemptId: string,
    result: ComputerUseTransactionResult
  ): Promise<ComputerUseTransactionResult> {
    const attempt = this.require(attemptId)
    if (attempt.phase === "settled") {
      if (!attempt.result)
        throw new Error(`Computer-use action attempt ${attemptId} lost its result.`)
      return attempt.result
    }
    if (result.baseStateId !== attempt.baseStateId) {
      throw new Error(`Computer-use result does not belong to action attempt ${attemptId}.`)
    }
    const transition = await this.transition(attempt, {
      ...attempt,
      phase: "settled",
      revision: attempt.revision + 1,
      result,
      settledAt: Date.now()
    })
    if (transition.attempt.phase === "settled") return transition.attempt.result!
    if (attempt.phase === "queued" && transition.attempt.phase === "dispatched") {
      return this.settle(attemptId, {
        baseStateId: attempt.baseStateId,
        outcome: "unknown",
        steps: []
      })
    }
    throw new Error(
      `Computer-use action attempt ${attemptId} conflicted with ${transition.attempt.phase}.`
    )
  }

  async cancel(attemptId: string): Promise<ComputerUseTransactionResult> {
    const attempt = this.require(attemptId)
    if (attempt.phase === "settled") {
      if (!attempt.result)
        throw new Error(`Computer-use action attempt ${attemptId} lost its result.`)
      return attempt.result
    }
    return this.settle(attemptId, {
      baseStateId: attempt.baseStateId,
      outcome: attempt.phase === "queued" ? "cancelled_before_dispatch" : "unknown",
      steps: []
    })
  }

  get(attemptId: string): ComputerUseActionAttempt | undefined {
    return this.attempts.get(attemptId)
  }

  private async reserve(input: {
    actions: readonly ComputerUseSemanticAction[]
    authorization: ComputerUseAuthorizationGrant
    baseStateId: string
    target: ComputerUseActionTarget
    transactionId: string
  }): Promise<ComputerUseActionAttemptClaim> {
    const attempt = normalizeAttempt({
      actions: input.actions,
      attemptId: input.transactionId,
      authorization: input.authorization,
      baseStateId: input.baseStateId,
      phase: "queued",
      revision: 0,
      startedAt: Date.now(),
      target: input.target
    })
    const reservation = await this.port.reserve(attempt)
    if (reservation.status === "exists") {
      const existing = normalizeAttempt(reservation.attempt, attempt.attemptId)
      this.attempts.set(existing.attemptId, existing)
      this.attemptSources.set(existing.attemptId, "durable")
      return { attempt: existing, source: "durable", status: "existing" }
    }
    this.attempts.set(attempt.attemptId, attempt)
    this.attemptSources.set(attempt.attemptId, "local")
    return { attempt, source: "local", status: "reserved" }
  }

  private require(attemptId: string): ComputerUseActionAttempt {
    const attempt = this.attempts.get(attemptId)
    if (!attempt) throw new Error(`Unknown computer-use action attempt ${attemptId}.`)
    return attempt
  }

  private async transition(
    previous: ComputerUseActionAttempt,
    next: ComputerUseActionAttempt
  ): Promise<ComputerUseActionAttemptTransition> {
    if (previous.phase === "settled") {
      throw new Error(`Settled computer-use action attempt ${previous.attemptId} is immutable.`)
    }
    const normalized = normalizeAttempt(next, previous.attemptId)
    const transition = await this.port.transition({
      attempt: normalized,
      expectedPhase: previous.phase,
      expectedRevision: previous.revision
    })
    if (transition.status === "applied") {
      this.attempts.set(normalized.attemptId, normalized)
      this.attemptSources.set(normalized.attemptId, "local")
      return { attempt: normalized, status: "applied" }
    }
    const current = normalizeAttempt(transition.current, previous.attemptId)
    if (!sameComputerUseActionAttemptIdentity(current, previous)) {
      throw new Error(
        "Computer-use durable transition conflict changed immutable attempt identity."
      )
    }
    if (current.revision <= previous.revision) {
      throw new Error("Computer-use durable transition conflict did not advance its revision.")
    }
    this.attempts.set(current.attemptId, current)
    this.attemptSources.set(current.attemptId, "durable")
    return { attempt: current, status: "conflict" }
  }
}

function normalizeAttempt(
  input: ComputerUseActionAttempt,
  expectedAttemptId?: string
): ComputerUseActionAttempt {
  const attempt = structuredClone(input)
  attempt.attemptId = normalizeId(attempt.attemptId, "attemptId")
  attempt.baseStateId = normalizeId(attempt.baseStateId, "baseStateId")
  if (expectedAttemptId !== undefined && attempt.attemptId !== expectedAttemptId) {
    throw new Error("Computer-use durable ledger returned another action attempt.")
  }
  if (!Number.isFinite(attempt.startedAt)) {
    throw new Error("Computer-use action attempt startedAt must be finite.")
  }
  if (!ATTEMPT_PHASES.has(attempt.phase)) {
    throw new Error("Computer-use action attempt has an invalid phase.")
  }
  if (!Number.isInteger(attempt.revision) || attempt.revision < 0) {
    throw new Error("Computer-use action attempt revision must be a non-negative integer.")
  }
  attempt.actions = parseComputerUseSemanticActions(attempt.actions, "action attempt.actions")
  if (!attempt.authorization || typeof attempt.authorization !== "object") {
    throw new Error("Computer-use action attempt requires authorization evidence.")
  }
  attempt.authorization.runId = normalizeId(attempt.authorization.runId, "authorization.runId")
  attempt.authorization.sessionId = normalizeId(
    attempt.authorization.sessionId,
    "authorization.sessionId"
  )
  attempt.authorization.threadId = normalizeId(
    attempt.authorization.threadId,
    "authorization.threadId"
  )
  if (!Number.isFinite(attempt.authorization.expiresAt)) {
    throw new Error("Computer-use authorization expiresAt must be finite.")
  }
  assertWindowIdentity(attempt.authorization.window, "authorization.window")
  if (!attempt.target || typeof attempt.target !== "object") {
    throw new Error("Computer-use action attempt requires target identity evidence.")
  }
  attempt.target.applicationId = normalizeId(attempt.target.applicationId, "target.applicationId")
  attempt.target.resourceKey = normalizeId(attempt.target.resourceKey, "target.resourceKey")
  assertWindowIdentity(attempt.target.window, "target.window")
  if (!sameComputerUseWindowIdentity(attempt.target.window, attempt.authorization.window)) {
    throw new Error("Computer-use authorization and target window identities do not match.")
  }
  if (
    attempt.dispatchedAt !== undefined &&
    (!Number.isFinite(attempt.dispatchedAt) || attempt.dispatchedAt < attempt.startedAt)
  ) {
    throw new Error("Computer-use action attempt has an invalid dispatch time.")
  }
  if (attempt.phase === "queued" && attempt.dispatchedAt !== undefined) {
    throw new Error("Queued computer-use action attempt cannot contain dispatch evidence.")
  }
  if (attempt.phase === "dispatched" && attempt.dispatchedAt === undefined) {
    throw new Error("Dispatched computer-use action attempt requires dispatch evidence.")
  }
  const expectedRevision =
    attempt.phase === "queued"
      ? 0
      : attempt.phase === "dispatched"
        ? 1
        : attempt.dispatchedAt !== undefined
          ? 2
          : 1
  if (attempt.revision !== expectedRevision) {
    throw new Error("Computer-use action attempt revision contradicts its phase history.")
  }
  if (attempt.phase === "settled") {
    if (
      !attempt.result ||
      typeof attempt.settledAt !== "number" ||
      !Number.isFinite(attempt.settledAt)
    ) {
      throw new Error("Settled computer-use action attempt requires a durable result and time.")
    }
    if (attempt.settledAt < attempt.startedAt) {
      throw new Error("Computer-use action attempt settled before it started.")
    }
    if (attempt.dispatchedAt !== undefined && attempt.settledAt < attempt.dispatchedAt) {
      throw new Error("Computer-use action attempt settled before it dispatched.")
    }
    if (attempt.result.baseStateId !== attempt.baseStateId) {
      throw new Error("Durable computer-use result belongs to another base state.")
    }
    assertResult(attempt.result, attempt.actions, attempt.target)
    assertTerminalTransition(attempt)
  } else if (attempt.result !== undefined || attempt.settledAt !== undefined) {
    throw new Error("Unsettled computer-use action attempt cannot contain a terminal result.")
  }
  return freeze(attempt)
}

function sameComputerUseActionAttemptIdentity(
  left: ComputerUseActionAttempt,
  right: ComputerUseActionAttempt
): boolean {
  return (
    left.attemptId === right.attemptId &&
    left.baseStateId === right.baseStateId &&
    left.startedAt === right.startedAt &&
    left.authorization.expiresAt === right.authorization.expiresAt &&
    left.authorization.runId === right.authorization.runId &&
    left.authorization.sessionId === right.authorization.sessionId &&
    left.authorization.threadId === right.authorization.threadId &&
    sameComputerUseWindowIdentity(left.authorization.window, right.authorization.window) &&
    left.target.applicationId === right.target.applicationId &&
    left.target.resourceKey === right.target.resourceKey &&
    sameComputerUseWindowIdentity(left.target.window, right.target.window) &&
    left.actions.length === right.actions.length &&
    left.actions.every((action, index) =>
      sameComputerUseSemanticAction(action, right.actions[index]!)
    )
  )
}

function assertResult(
  result: ComputerUseTransactionResult,
  actions: readonly ComputerUseSemanticAction[],
  target: ComputerUseActionTarget
): void {
  if (!OUTCOMES.has(result.outcome))
    throw new Error("Durable computer-use result has an invalid outcome.")
  if (!Array.isArray(result.steps) || result.steps.length > actions.length) {
    throw new Error("Durable computer-use result has an invalid step prefix.")
  }
  if (
    result.stoppedAt !== undefined &&
    (!Number.isInteger(result.stoppedAt) || result.stoppedAt !== result.steps.length - 1)
  ) {
    throw new Error("Durable computer-use result has an inconsistent stoppedAt boundary.")
  }
  result.steps.forEach((step, index) => assertStep(step, actions[index]!, index))
  const stepOutcomes = new Set(result.steps.map((step) => step.outcome))
  if (
    result.outcome === "worked" &&
    (result.stoppedAt !== undefined ||
      result.steps.length !== actions.length ||
      stepOutcomes.size !== 1 ||
      !stepOutcomes.has("worked"))
  ) {
    throw new Error("Durable computer-use worked result has inconsistent steps.")
  }
  if (
    result.outcome === "didnt" &&
    (result.steps.length !== actions.length ||
      stepOutcomes.size !== 1 ||
      !stepOutcomes.has("didnt"))
  ) {
    throw new Error(`Durable computer-use ${result.outcome} result has inconsistent steps.`)
  }
  if (
    (result.outcome === "worked" || result.outcome === "didnt") &&
    result.successor === undefined
  ) {
    throw new Error(`Durable computer-use ${result.outcome} result requires a successor state.`)
  }
  if (
    result.outcome === "cancelled_before_dispatch" &&
    (result.steps.length !== 0 || result.successor !== undefined)
  ) {
    throw new Error("Durable pre-dispatch cancellation contains dispatched evidence.")
  }
  if (result.outcome === "unknown") {
    const hasStoppedPrefix = result.steps.length > 0 && result.stoppedAt === result.steps.length - 1
    const hasCompleteCoreEvidence =
      result.stoppedAt === undefined &&
      (result.steps.length === 0 || result.steps.length === actions.length)
    if (!hasStoppedPrefix && !hasCompleteCoreEvidence) {
      throw new Error("Durable computer-use unknown result has an invalid step boundary.")
    }
  }
  if (result.outcome === "refused" || result.outcome === "unavailable") {
    if (result.steps.length === 0) {
      if (result.stoppedAt !== undefined) {
        throw new Error("Durable computer-use empty refusal has a stoppedAt boundary.")
      }
    } else if (
      result.stoppedAt !== result.steps.length - 1 ||
      result.steps.at(-1)?.outcome !== result.outcome ||
      result.steps
        .slice(0, -1)
        .some((step) => step.outcome === "worked" || step.outcome === "unknown")
    ) {
      throw new Error("Durable computer-use refusal has an inconsistent stopped step prefix.")
    }
  }
  if (result.successor) {
    assertObservation(result.successor, "result.successor")
    if (
      result.successor.application.id !== target.applicationId ||
      result.successor.resourceKey !== target.resourceKey
    ) {
      throw new Error("Durable computer-use successor belongs to another target resource.")
    }
    if (!sameComputerUseWindowIdentity(result.successor.window, target.window)) {
      throw new Error("Durable computer-use successor belongs to another window generation.")
    }
    if (result.successor.stateId === result.baseStateId) {
      throw new Error("Durable computer-use successor reused its base state identity.")
    }
  }
}

function assertTerminalTransition(attempt: ComputerUseActionAttempt): void {
  const result = attempt.result!
  if (attempt.dispatchedAt === undefined) {
    if (!["cancelled_before_dispatch", "refused", "unavailable"].includes(result.outcome)) {
      throw new Error("Undispatched computer-use action attempt has an executed terminal outcome.")
    }
    if (
      result.steps.length !== 0 ||
      result.stoppedAt !== undefined ||
      result.successor !== undefined
    ) {
      throw new Error("Undispatched computer-use action attempt contains dispatch evidence.")
    }
    return
  }
  if (result.outcome === "cancelled_before_dispatch") {
    throw new Error("Dispatched computer-use action attempt cannot be cancelled before dispatch.")
  }
}

function assertStep(
  step: ComputerUseStepResult,
  action: ComputerUseSemanticAction,
  index: number
): void {
  if (!step || typeof step !== "object") {
    throw new Error(`Durable computer-use result.steps[${index}] must be an object.`)
  }
  step.action = parseComputerUseSemanticAction(step.action, `durable result.steps[${index}].action`)
  if (!sameComputerUseSemanticAction(step.action, action)) {
    throw new Error("Durable computer-use result steps are not an ordered action prefix.")
  }
  if (!OUTCOMES.has(step.outcome) || step.outcome === "cancelled_before_dispatch") {
    throw new Error(`Durable computer-use result.steps[${index}] has an invalid outcome.`)
  }
  const evidence = step.evidence
  if (!evidence || typeof evidence !== "object") {
    throw new Error(`Durable computer-use result.steps[${index}] requires evidence.`)
  }
  if (!["global_input", "semantic", "targeted_input"].includes(evidence.delivery)) {
    throw new Error(`Durable computer-use result.steps[${index}] has invalid delivery evidence.`)
  }
  if (typeof evidence.noSideEffectProof !== "boolean") {
    throw new Error(`Durable computer-use result.steps[${index}] has invalid side-effect evidence.`)
  }
  normalizeId(evidence.route, `result.steps[${index}].evidence.route`)
  if (!["failed", "unverifiable", "verified"].includes(evidence.verification)) {
    throw new Error(
      `Durable computer-use result.steps[${index}] has invalid verification evidence.`
    )
  }
  const evidenceIsConsistent =
    (step.outcome === "worked" &&
      evidence.verification === "verified" &&
      !evidence.noSideEffectProof) ||
    (step.outcome === "unknown" &&
      evidence.verification === "unverifiable" &&
      !evidence.noSideEffectProof) ||
    ((step.outcome === "didnt" || step.outcome === "refused" || step.outcome === "unavailable") &&
      evidence.verification === "failed" &&
      evidence.noSideEffectProof)
  if (!evidenceIsConsistent) {
    throw new Error(`Durable computer-use result.steps[${index}] has contradictory evidence.`)
  }
}

function assertObservation(observation: ComputerUseObservation, path: string): void {
  if (!observation || typeof observation !== "object") {
    throw new Error(`Computer-use ${path} must be an observation.`)
  }
  normalizeId(observation.application.id, `${path}.application.id`)
  normalizeId(observation.application.name, `${path}.application.name`)
  normalizeId(observation.resourceKey, `${path}.resourceKey`)
  normalizeId(observation.stateId, `${path}.stateId`)
  if (!Number.isFinite(observation.capturedAt) || !Number.isInteger(observation.epoch)) {
    throw new Error(`Computer-use ${path} has invalid time or epoch facts.`)
  }
  assertWindowIdentity(observation.window, `${path}.window`)
  if (!Array.isArray(observation.elements)) {
    throw new Error(`Computer-use ${path}.elements must be an array.`)
  }
  const refs = new Set<string>()
  observation.elements.forEach((element, index) => {
    if (!element || typeof element !== "object") {
      throw new Error(`Computer-use ${path}.elements[${index}] must be an object.`)
    }
    const ref = normalizeId(element.ref, `${path}.elements[${index}].ref`)
    normalizeId(element.role, `${path}.elements[${index}].role`)
    if (!Number.isInteger(element.index) || element.index < 0 || !Array.isArray(element.actions)) {
      throw new Error(`Computer-use ${path}.elements[${index}] has invalid index or actions.`)
    }
    for (const action of element.actions) {
      if (!ACTION_KINDS.has(action)) {
        throw new Error(`Computer-use ${path}.elements[${index}] has an invalid action.`)
      }
    }
    if (refs.has(ref)) throw new Error(`Computer-use ${path} contains duplicate semantic refs.`)
    refs.add(ref)
  })
}

function assertWindowIdentity(window: ComputerUseAuthorizationGrant["window"], path: string): void {
  if (!window || typeof window !== "object") {
    throw new Error(`Computer-use ${path} must be a window identity.`)
  }
  normalizeId(window.generation, `${path}.generation`)
  normalizeId(window.nativeId, `${path}.nativeId`)
  if (!Number.isInteger(window.pid) || window.pid <= 0) {
    throw new Error(`Computer-use ${path}.pid must be a positive integer.`)
  }
  if (!["linux", "macos", "windows"].includes(window.platform)) {
    throw new Error(`Computer-use ${path}.platform is invalid.`)
  }
}

function normalizeId(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Computer-use ${field} must not be empty.`)
  return normalized
}

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested)
  return Object.freeze(value)
}
