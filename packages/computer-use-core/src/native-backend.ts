import {
  COMPUTER_USE_NATIVE_RESPONSE_LIMITS,
  JINGLE_COMPUTER_USE_PROTOCOL_VERSION
} from "./contract"
import {
  COMPUTER_USE_NATIVE_ACTIONS as ACTIONS,
  createComputerUseNativeProbeRequest,
  validateComputerUseNativeCapabilityMatrix
} from "../native-policy.mjs"
import type {
  ComputerUseActionKind,
  ComputerUseBackend,
  ComputerUseBackendEnvironment,
  ComputerUseBackendExecutionOutcome,
  ComputerUseBackendExecutionResult,
  ComputerUseBackendObservation,
  ComputerUseBackendStepResult,
  ComputerUseCapabilityMatrix,
  ComputerUseElement,
  ComputerUseExecuteRequest,
  ComputerUseIdentifyRequest,
  ComputerUseObserveRequest,
  ComputerUsePlatform,
  ComputerUseSemanticAction,
  ComputerUseTargetIdentity,
  ComputerUseWindowIdentity
} from "./contract"
import {
  parseComputerUseSemanticAction,
  parseComputerUseSemanticActions,
  sameComputerUseSemanticAction
} from "./semantic-action"
import { sameComputerUseWindowIdentity } from "./authorization"

export type JingleComputerUseNativeRequest =
  | {
      environment: ComputerUseBackendEnvironment
      method: "probe"
      protocolVersion: typeof JINGLE_COMPUTER_USE_PROTOCOL_VERSION
      requestPermission: boolean
    }
  | {
      environment: ComputerUseBackendEnvironment
      method: "identify"
      protocolVersion: typeof JINGLE_COMPUTER_USE_PROTOCOL_VERSION
      request: Omit<ComputerUseIdentifyRequest, "signal">
    }
  | {
      environment: ComputerUseBackendEnvironment
      method: "observe"
      protocolVersion: typeof JINGLE_COMPUTER_USE_PROTOCOL_VERSION
      request: Omit<ComputerUseObserveRequest, "signal">
    }
  | {
      environment: ComputerUseBackendEnvironment
      method: "execute"
      protocolVersion: typeof JINGLE_COMPUTER_USE_PROTOCOL_VERSION
      request: Omit<ComputerUseExecuteRequest, "signal">
    }
  | { method: "dispose_session"; sessionId: string }

export interface JingleComputerUseNativeBridge {
  invoke(request: JingleComputerUseNativeRequest, signal?: AbortSignal): Promise<unknown>
}

export class ComputerUseNativeProtocolError extends Error {
  readonly code = "invalid_native_response"

  constructor(
    readonly method: "execute" | "identify" | "observe" | "probe",
    message: string
  ) {
    super(message)
    this.name = "ComputerUseNativeProtocolError"
  }
}

export async function createJingleComputerUseNativeBackend(
  environment: ComputerUseBackendEnvironment,
  bridge: JingleComputerUseNativeBridge,
  signal?: AbortSignal
): Promise<ComputerUseBackend> {
  signal?.throwIfAborted()
  const rawMatrix = await bridge.invoke(
    createComputerUseNativeProbeRequest(environment, environment === "macos-quartz"),
    signal
  )
  signal?.throwIfAborted()
  return new NativeComputerUseBackend(
    bridge,
    decodeNativeResponse("probe", () =>
      validateComputerUseNativeCapabilityMatrix(environment, rawMatrix)
    )
  )
}

class NativeComputerUseBackend implements ComputerUseBackend {
  constructor(
    private readonly bridge: JingleComputerUseNativeBridge,
    readonly matrix: ComputerUseCapabilityMatrix
  ) {}

  async identify(request: ComputerUseIdentifyRequest): Promise<ComputerUseTargetIdentity> {
    request.signal?.throwIfAborted()
    const signal = request.signal
    const nativeRequest = encodeNativeIdentifyRequest(request)
    const result = await this.bridge.invoke(
      {
        environment: this.matrix.environment,
        method: "identify",
        protocolVersion: JINGLE_COMPUTER_USE_PROTOCOL_VERSION,
        request: nativeRequest
      },
      signal
    )
    signal?.throwIfAborted()
    return decodeNativeResponse("identify", () => {
      const target = decodeNativeTargetIdentity(
        this.matrix.platform,
        decodeNativeOperationResponse(this.matrix.environment, "identify", result)
      )
      assertNativeIdentifyTargetMatches(nativeRequest, target)
      return target
    })
  }

  async observe(request: ComputerUseObserveRequest): Promise<ComputerUseBackendObservation> {
    request.signal?.throwIfAborted()
    const signal = request.signal
    const nativeRequest = encodeNativeObserveRequest(request)
    const result = await this.bridge.invoke(
      {
        environment: this.matrix.environment,
        method: "observe",
        protocolVersion: JINGLE_COMPUTER_USE_PROTOCOL_VERSION,
        request: nativeRequest
      },
      signal
    )
    signal?.throwIfAborted()
    return decodeNativeResponse("observe", () => {
      const observation = decodeNativeObservation(
        this.matrix.platform,
        decodeNativeOperationResponse(this.matrix.environment, "observe", result)
      )
      assertNativeTargetMatches(nativeRequest.target, observation)
      return observation
    })
  }

  async execute(request: ComputerUseExecuteRequest): Promise<ComputerUseBackendExecutionResult> {
    request.signal?.throwIfAborted()
    const signal = request.signal
    const actions = parseComputerUseSemanticActions(request.actions, "native execution actions")
    for (const action of actions) {
      const capability = this.matrix.capabilities.find(
        (candidate) => candidate.action === action.kind
      )
      const support = capability?.[request.delivery]
      if (!capability || support !== "verified") {
        return {
          baseStateId: request.base.stateId,
          outcome: support === "refused" ? "refused" : "unavailable",
          steps: []
        }
      }
    }
    const nativeRequest = encodeNativeExecuteRequest(request, actions, this.matrix.platform)
    const result = await this.bridge.invoke(
      {
        environment: this.matrix.environment,
        method: "execute",
        protocolVersion: JINGLE_COMPUTER_USE_PROTOCOL_VERSION,
        request: nativeRequest
      },
      signal
    )
    signal?.throwIfAborted()
    return decodeNativeResponse("execute", () =>
      decodeNativeExecutionResult(
        decodeNativeOperationResponse(this.matrix.environment, "execute", result),
        nativeRequest,
        this.matrix
      )
    )
  }

  async disposeSession(sessionId: string): Promise<void> {
    await this.bridge.invoke({ method: "dispose_session", sessionId })
  }
}

function encodeNativeObserveRequest(
  request: ComputerUseObserveRequest
): Omit<ComputerUseObserveRequest, "signal"> {
  return deepFreeze({
    target: decodeNativeTargetIdentity(
      request.target.window.platform,
      projectNativeTargetIdentity(request.target)
    )
  })
}

function encodeNativeIdentifyRequest(
  request: ComputerUseIdentifyRequest
): Omit<ComputerUseIdentifyRequest, "signal"> {
  const result: Omit<ComputerUseIdentifyRequest, "signal"> = {
    applicationId: readString(
      request.applicationId,
      "identify.applicationId",
      COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
    )
  }
  if (request.applicationName !== undefined) {
    result.applicationName = readString(
      request.applicationName,
      "identify.applicationName",
      COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text
    )
  }
  if (request.windowId !== undefined) {
    result.windowId = readString(
      request.windowId,
      "identify.windowId",
      COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
    )
  }
  return deepFreeze(result)
}

function encodeNativeExecuteRequest(
  request: ComputerUseExecuteRequest,
  actions: readonly ComputerUseSemanticAction[],
  platform: ComputerUsePlatform
): Omit<ComputerUseExecuteRequest, "signal"> {
  const authorization = request.authorization
  if (!isRecord(authorization)) {
    throw new Error("Computer-use native authorization has an invalid envelope.")
  }
  const expiresAt = readFiniteNumber(authorization.expiresAt, "authorization.expiresAt")
  const delivery = readDelivery(request.delivery)
  const base = encodeNativeBaseObservation(request.base, platform)
  return deepFreeze({
    actions,
    authorization: {
      expiresAt,
      runId: readString(
        authorization.runId,
        "authorization.runId",
        COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
      ),
      sessionId: readString(
        authorization.sessionId,
        "authorization.sessionId",
        COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
      ),
      threadId: readString(
        authorization.threadId,
        "authorization.threadId",
        COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
      ),
      window: decodeNativeWindowIdentity(
        projectNativeWindowIdentity(authorization.window),
        platform
      )
    },
    base,
    delivery
  })
}

function encodeNativeBaseObservation(
  value: ComputerUseExecuteRequest["base"],
  platform: ComputerUsePlatform
): ComputerUseExecuteRequest["base"] {
  if (!isRecord(value)) {
    throw new Error("Computer-use native base observation has an invalid envelope.")
  }
  const observation = decodeNativeObservation(platform, projectNativeObservation(value))
  return deepFreeze({
    ...observation,
    epoch: readNonNegativeInteger(value.epoch, "base.epoch"),
    stateId: readString(value.stateId, "base.stateId", COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token)
  })
}

function projectNativeObservation(value: Record<string, unknown>): Record<string, unknown> {
  const application = isRecord(value.application) ? value.application : {}
  const elements = isDenseArray(value.elements, COMPUTER_USE_NATIVE_RESPONSE_LIMITS.elements)
    ? value.elements.map((element) => projectNativeElement(element))
    : value.elements
  return {
    application: { id: application.id, name: application.name },
    capturedAt: value.capturedAt,
    elements,
    resourceKey: value.resourceKey,
    sourceTruncated: value.sourceTruncated,
    window: projectNativeWindowIdentity(value.window)
  }
}

function projectNativeTargetIdentity(value: ComputerUseTargetIdentity): Record<string, unknown> {
  return {
    application: { id: value.application.id, name: value.application.name },
    resourceKey: value.resourceKey,
    window: projectNativeWindowIdentity(value.window)
  }
}

function projectNativeElement(value: unknown): unknown {
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {
    actions: isDenseArray(value.actions, ACTIONS.length)
      ? value.actions.map((action) => action)
      : value.actions,
    index: value.index,
    ref: value.ref,
    role: value.role
  }
  for (const key of ["description", "identifier", "title", "value"] as const) {
    if (Object.hasOwn(value, key)) result[key] = value[key]
  }
  return result
}

function projectNativeWindowIdentity(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    generation: value.generation,
    nativeId: value.nativeId,
    pid: value.pid,
    platform: value.platform
  }
}

function isComputerUseActionKind(value: unknown): value is ComputerUseActionKind {
  return typeof value === "string" && ACTIONS.includes(value as ComputerUseActionKind)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function hasExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key))
}

function decodeNativeOperationResponse(
  environment: ComputerUseBackendEnvironment,
  method: "execute" | "identify" | "observe",
  value: unknown
): unknown {
  if (
    !hasExactKeys(value, ["environment", "method", "protocolVersion", "result"]) ||
    value.environment !== environment ||
    value.method !== method ||
    value.protocolVersion !== JINGLE_COMPUTER_USE_PROTOCOL_VERSION
  ) {
    throw new Error(
      `Computer-use native ${method} response belongs to another environment or protocol.`
    )
  }
  return value.result
}

function decodeNativeResponse<T>(
  method: ComputerUseNativeProtocolError["method"],
  decode: () => T
): T {
  try {
    return decode()
  } catch (error) {
    if (error instanceof ComputerUseNativeProtocolError) throw error
    throw new ComputerUseNativeProtocolError(
      method,
      error instanceof Error ? error.message : `Computer-use native ${method} response is invalid.`
    )
  }
}

function assertNativeTargetMatches(
  expected: ComputerUseTargetIdentity,
  actual: ComputerUseTargetIdentity
): void {
  if (
    actual.application.id !== expected.application.id ||
    actual.resourceKey !== expected.resourceKey ||
    !sameComputerUseWindowIdentity(actual.window, expected.window)
  ) {
    throw new Error("Computer-use native observation belongs to another target identity.")
  }
}

function assertNativeIdentifyTargetMatches(
  request: Omit<ComputerUseIdentifyRequest, "signal">,
  target: ComputerUseTargetIdentity
): void {
  if (
    target.application.id !== request.applicationId ||
    (request.windowId !== undefined && target.window.nativeId !== request.windowId)
  ) {
    throw new Error("Computer-use native identification belongs to another selector.")
  }
}

function decodeNativeObservation(
  platform: ComputerUsePlatform,
  value: unknown
): ComputerUseBackendObservation {
  if (
    !hasExactKeys(value, [
      "application",
      "capturedAt",
      "elements",
      "resourceKey",
      "sourceTruncated",
      "window"
    ])
  ) {
    throw new Error("Computer-use native observation has an invalid envelope.")
  }
  if (typeof value.sourceTruncated !== "boolean") {
    throw new Error("Computer-use native observation has invalid source completeness.")
  }
  const presentationState = { sourceTruncated: value.sourceTruncated }
  const target = decodeNativeTargetIdentity(
    platform,
    {
      application: value.application,
      resourceKey: value.resourceKey,
      window: value.window
    },
    presentationState
  )
  const capturedAt = readNonNegativeInteger(value.capturedAt, "capturedAt")
  if (!isDenseArray(value.elements, COMPUTER_USE_NATIVE_RESPONSE_LIMITS.elements)) {
    throw new Error("Computer-use native observation has an invalid element count.")
  }
  const refs = new Set<string>()
  const elements = value.elements.map((candidate, index) => {
    const element = decodeNativeElement(candidate, index, presentationState)
    if (element.index !== index) {
      throw new Error("Computer-use native observation element indexes are not canonical.")
    }
    if (refs.has(element.ref)) {
      throw new Error("Computer-use native observation contains duplicate semantic refs.")
    }
    if (element.actions.includes("activate") && (platform !== "macos" || index !== 0)) {
      throw new Error("Computer-use native observation exposes activate outside the macOS root.")
    }
    refs.add(element.ref)
    return element
  })
  return deepFreeze({
    ...target,
    capturedAt,
    elements,
    sourceTruncated: presentationState.sourceTruncated
  })
}

function decodeNativeTargetIdentity(
  platform: ComputerUsePlatform,
  value: unknown,
  presentationState?: { sourceTruncated: boolean }
): ComputerUseTargetIdentity {
  if (!hasExactKeys(value, ["application", "resourceKey", "window"])) {
    throw new Error("Computer-use native target identity has an invalid envelope.")
  }
  if (!hasExactKeys(value.application, ["id", "name"])) {
    throw new Error("Computer-use native target has an invalid application identity.")
  }
  return deepFreeze({
    application: {
      id: readString(
        value.application.id,
        "application.id",
        COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
      ),
      name: readPresentationString(value.application.name, "application.name", presentationState)
    },
    resourceKey: readString(
      value.resourceKey,
      "resourceKey",
      COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
    ),
    window: decodeNativeWindowIdentity(value.window, platform)
  })
}

function decodeNativeWindowIdentity(
  value: unknown,
  platform: ComputerUsePlatform
): ComputerUseWindowIdentity {
  if (!hasExactKeys(value, ["generation", "nativeId", "pid", "platform"])) {
    throw new Error("Computer-use native observation has an invalid window identity.")
  }
  if (value.platform !== platform) {
    throw new Error("Computer-use native observation belongs to another platform.")
  }
  const pid = readNonNegativeInteger(value.pid, "window.pid")
  if (pid === 0) throw new Error("Computer-use native observation has an invalid process id.")
  return {
    generation: readString(
      value.generation,
      "window.generation",
      COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
    ),
    nativeId: readString(
      value.nativeId,
      "window.nativeId",
      COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
    ),
    pid,
    platform
  }
}

function decodeNativeElement(
  value: unknown,
  offset: number,
  presentationState: { sourceTruncated: boolean }
): ComputerUseElement {
  if (
    !hasExactKeys(
      value,
      ["actions", "index", "ref", "role"],
      ["description", "identifier", "title", "value"]
    )
  ) {
    throw new Error(`Computer-use native element ${offset} has an invalid shape.`)
  }
  if (!isDenseArray(value.actions, ACTIONS.length)) {
    throw new Error(`Computer-use native element ${offset} has invalid actions.`)
  }
  const actions = value.actions.map((action) => {
    if (!isComputerUseActionKind(action)) {
      throw new Error(`Computer-use native element ${offset} has invalid actions.`)
    }
    return action
  })
  if (new Set(actions).size !== actions.length) {
    throw new Error(`Computer-use native element ${offset} has duplicate actions.`)
  }
  return {
    actions,
    ...readOptionalTextFields(
      value,
      ["description", "identifier", "title", "value"],
      presentationState
    ),
    index: readNonNegativeInteger(value.index, `elements[${offset}].index`),
    ref: readString(
      value.ref,
      `elements[${offset}].ref`,
      COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
    ),
    role: readString(
      value.role,
      `elements[${offset}].role`,
      COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
    )
  }
}

function decodeNativeExecutionResult(
  value: unknown,
  request: ComputerUseExecuteRequest,
  matrix: ComputerUseCapabilityMatrix
): ComputerUseBackendExecutionResult {
  if (!hasExactKeys(value, ["baseStateId", "outcome", "steps"], ["stoppedAt"])) {
    throw new Error("Computer-use native execution result has an invalid envelope.")
  }
  const baseStateId = readString(
    value.baseStateId,
    "baseStateId",
    COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
  )
  if (baseStateId !== request.base.stateId) {
    throw new Error("Computer-use native execution result belongs to another base state.")
  }
  const outcome = readExecutionOutcome(value.outcome, "outcome")
  if (
    !isDenseArray(value.steps, COMPUTER_USE_NATIVE_RESPONSE_LIMITS.actions) ||
    value.steps.length > request.actions.length ||
    value.steps.length > COMPUTER_USE_NATIVE_RESPONSE_LIMITS.actions
  ) {
    throw new Error("Computer-use native execution result has an invalid step count.")
  }
  const steps = value.steps.map((candidate, index) =>
    decodeNativeStep(candidate, request.actions[index]!, matrix, index)
  )
  const stoppedAt = Object.hasOwn(value, "stoppedAt")
    ? readNonNegativeInteger(value.stoppedAt, "stoppedAt")
    : undefined
  if (stoppedAt !== undefined && stoppedAt !== steps.length - 1) {
    throw new Error("Computer-use native execution result has an invalid stoppedAt boundary.")
  }
  assertNativeExecutionConsistency(outcome, steps, request.actions.length, stoppedAt)
  return deepFreeze({
    baseStateId,
    outcome,
    steps,
    ...(stoppedAt === undefined ? {} : { stoppedAt })
  })
}

function decodeNativeStep(
  value: unknown,
  expectedAction: ComputerUseSemanticAction,
  matrix: ComputerUseCapabilityMatrix,
  offset: number
): ComputerUseBackendStepResult {
  if (!hasExactKeys(value, ["action", "evidence", "outcome"])) {
    throw new Error(`Computer-use native execution step ${offset} has an invalid shape.`)
  }
  const action = parseComputerUseSemanticAction(
    value.action,
    `native execution steps[${offset}].action`
  )
  if (!sameComputerUseSemanticAction(action, expectedAction)) {
    throw new Error("Computer-use native execution returned actions out of order.")
  }
  const capability = matrix.capabilities.find((candidate) => candidate.action === action.kind)
  if (!capability) {
    throw new Error(`Computer-use native execution returned an unknown ${action.kind} route.`)
  }
  if (!hasExactKeys(value.evidence, ["delivery", "noSideEffectProof", "route", "verification"])) {
    throw new Error(`Computer-use native execution step ${offset} has invalid evidence.`)
  }
  if (
    value.evidence.delivery !== "semantic" ||
    typeof value.evidence.noSideEffectProof !== "boolean" ||
    value.evidence.route !== capability.route ||
    !isVerification(value.evidence.verification)
  ) {
    throw new Error(`Computer-use native execution step ${offset} has untrusted evidence.`)
  }
  const outcome = readExecutionOutcome(value.outcome, `steps[${offset}].outcome`)
  assertNativeStepEvidenceConsistency(
    outcome,
    value.evidence.verification,
    value.evidence.noSideEffectProof,
    offset
  )
  return {
    action,
    evidence: {
      delivery: "semantic",
      noSideEffectProof: value.evidence.noSideEffectProof,
      route: readString(
        value.evidence.route,
        `steps[${offset}].evidence.route`,
        COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
      ),
      verification: value.evidence.verification
    },
    outcome
  }
}

function assertNativeStepEvidenceConsistency(
  outcome: ComputerUseBackendExecutionOutcome,
  verification: "verified" | "failed" | "unverifiable",
  noSideEffectProof: boolean,
  offset: number
): void {
  const consistent =
    (outcome === "worked" && verification === "verified" && !noSideEffectProof) ||
    (outcome === "unknown" && verification === "unverifiable" && !noSideEffectProof) ||
    ((outcome === "didnt" || outcome === "refused" || outcome === "unavailable") &&
      verification === "failed" &&
      noSideEffectProof)
  if (!consistent) {
    throw new Error(`Computer-use native execution step ${offset} has contradictory evidence.`)
  }
}

function assertNativeExecutionConsistency(
  outcome: ComputerUseBackendExecutionOutcome,
  steps: readonly ComputerUseBackendStepResult[],
  actionCount: number,
  stoppedAt: number | undefined
): void {
  if (outcome === "worked") {
    if (
      stoppedAt !== undefined ||
      steps.length !== actionCount ||
      steps.some((step) => step.outcome !== "worked")
    ) {
      throw new Error("Computer-use native execution returned an inconsistent worked result.")
    }
    return
  }
  if (outcome === "didnt") {
    if (steps.length !== actionCount || steps.some((step) => step.outcome !== "didnt")) {
      throw new Error("Computer-use native execution returned an inconsistent didnt result.")
    }
    return
  }
  if (outcome === "unknown") {
    if (steps.length === 0 || stoppedAt !== steps.length - 1) {
      throw new Error("Computer-use native execution returned unknown without step evidence.")
    }
    return
  }
  if (outcome === "refused" || outcome === "unavailable") {
    if (steps.length === 0) {
      if (stoppedAt !== undefined) {
        throw new Error("Computer-use native empty refusal contains a stoppedAt boundary.")
      }
      return
    }
    if (
      stoppedAt !== steps.length - 1 ||
      steps.at(-1)?.outcome !== outcome ||
      steps.slice(0, -1).some((step) => step.outcome === "worked" || step.outcome === "unknown")
    ) {
      throw new Error("Computer-use native refusal has an inconsistent stopped step prefix.")
    }
  }
}

function readExecutionOutcome(value: unknown, path: string): ComputerUseBackendExecutionOutcome {
  if (
    value !== "worked" &&
    value !== "didnt" &&
    value !== "unknown" &&
    value !== "refused" &&
    value !== "unavailable"
  ) {
    throw new Error(`Computer-use native execution ${path} is invalid.`)
  }
  return value
}

function isVerification(value: unknown): value is "verified" | "failed" | "unverifiable" {
  return value === "verified" || value === "failed" || value === "unverifiable"
}

function readOptionalTextFields(
  value: Record<string, unknown>,
  keys: readonly ("description" | "identifier" | "title" | "value")[],
  presentationState: { sourceTruncated: boolean }
): Partial<Pick<ComputerUseElement, "description" | "identifier" | "title" | "value">> {
  const result: Partial<
    Pick<ComputerUseElement, "description" | "identifier" | "title" | "value">
  > = {}
  for (const key of keys) {
    if (Object.hasOwn(value, key)) {
      result[key] = readPresentationText(value[key], `element.${key}`, presentationState)
    }
  }
  return result
}

function readNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Computer-use native ${path} must be a non-negative safe integer.`)
  }
  return value as number
}

function readFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Computer-use native ${path} must be finite.`)
  }
  return value
}

function readDelivery(value: unknown): "background" | "foreground" {
  if (value !== "background" && value !== "foreground") {
    throw new Error("Computer-use native delivery mode is invalid.")
  }
  return value
}

function readString(value: unknown, path: string, maximum: number): string {
  if (!isBoundedString(value, maximum)) {
    throw new Error(`Computer-use native ${path} must be a bounded non-empty string.`)
  }
  return value
}

function readPresentationString(
  value: unknown,
  path: string,
  state?: { sourceTruncated: boolean }
): string {
  if (typeof value !== "string" || value.length === 0 || value.trim().length === 0) {
    throw new Error(`Computer-use native ${path} must be a non-empty string.`)
  }
  return boundPresentationText(value, state)
}

function readPresentationText(
  value: unknown,
  path: string,
  state: { sourceTruncated: boolean }
): string {
  if (typeof value !== "string") {
    throw new Error(`Computer-use native ${path} must be a string.`)
  }
  return boundPresentationText(value, state)
}

function boundPresentationText(value: string, state?: { sourceTruncated: boolean }): string {
  if (value.length <= COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text) return value
  if (state) state.sourceTruncated = true
  let bounded = value.slice(0, COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text)
  const lastCodeUnit = bounded.charCodeAt(bounded.length - 1)
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) bounded = bounded.slice(0, -1)
  return bounded
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim().length > 0
  )
}

function isDenseArray(value: unknown, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false
  }
  return true
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.freeze(value)
}
