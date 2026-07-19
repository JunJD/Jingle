import {
  COMPUTER_USE_NATIVE_RESPONSE_LIMITS,
  JINGLE_COMPUTER_USE_PROTOCOL_VERSION
} from "./contract"
import type {
  ComputerUseActionKind,
  ComputerUseBackend,
  ComputerUseBackendEnvironment,
  ComputerUseBackendExecutionOutcome,
  ComputerUseBackendExecutionResult,
  ComputerUseBackendObservation,
  ComputerUseBackendStepResult,
  ComputerUseCapability,
  ComputerUseCapabilityMatrix,
  ComputerUseElement,
  ComputerUseExecuteRequest,
  ComputerUseObserveRequest,
  ComputerUsePlatform,
  ComputerUseSemanticAction,
  ComputerUseWindowIdentity
} from "./contract"

export type JingleComputerUseNativeRequest =
  | { environment: ComputerUseBackendEnvironment; method: "probe" }
  | { method: "observe"; request: Omit<ComputerUseObserveRequest, "signal"> }
  | { method: "execute"; request: Omit<ComputerUseExecuteRequest, "signal"> }
  | { method: "dispose_session"; sessionId: string }

export interface JingleComputerUseNativeBridge {
  invoke(request: JingleComputerUseNativeRequest, signal?: AbortSignal): Promise<unknown>
}

type ComputerUseCapabilityStatus = ComputerUseCapability["background"]

interface NativeCapabilityPolicy {
  background: readonly ComputerUseCapabilityStatus[]
  foreground: readonly ComputerUseCapabilityStatus[]
  route: string
}

interface NativeEnvironmentPolicy {
  capabilities: Readonly<Record<ComputerUseActionKind, NativeCapabilityPolicy>>
  platform: ComputerUsePlatform
}

const ACTIONS: readonly ComputerUseActionKind[] = [
  "press",
  "set_value",
  "type_text",
  "keypress",
  "scroll"
]
const AVAILABLE_SEMANTIC: readonly ComputerUseCapabilityStatus[] = ["verified", "unavailable"]
const REFUSED: readonly ComputerUseCapabilityStatus[] = ["refused"]
const UNAVAILABLE: readonly ComputerUseCapabilityStatus[] = ["unavailable"]

const linuxCapabilities: NativeEnvironmentPolicy["capabilities"] = {
  keypress: { background: REFUSED, foreground: UNAVAILABLE, route: "unavailable" },
  press: {
    background: AVAILABLE_SEMANTIC,
    foreground: UNAVAILABLE,
    route: "at_spi_action"
  },
  scroll: {
    background: AVAILABLE_SEMANTIC,
    foreground: UNAVAILABLE,
    route: "at_spi_action"
  },
  set_value: {
    background: AVAILABLE_SEMANTIC,
    foreground: UNAVAILABLE,
    route: "at_spi_editable_text"
  },
  type_text: {
    background: AVAILABLE_SEMANTIC,
    foreground: UNAVAILABLE,
    route: "at_spi_editable_text"
  }
}

const environmentPolicies: Readonly<
  Record<ComputerUseBackendEnvironment, NativeEnvironmentPolicy>
> = {
  "linux-wayland-gnome": { capabilities: linuxCapabilities, platform: "linux" },
  "linux-wayland-kde": { capabilities: linuxCapabilities, platform: "linux" },
  "linux-wayland-other": { capabilities: linuxCapabilities, platform: "linux" },
  "linux-x11": { capabilities: linuxCapabilities, platform: "linux" },
  "macos-quartz": {
    capabilities: {
      keypress: { background: REFUSED, foreground: UNAVAILABLE, route: "unavailable" },
      press: { background: AVAILABLE_SEMANTIC, foreground: UNAVAILABLE, route: "ax_action" },
      scroll: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "unavailable" },
      set_value: { background: AVAILABLE_SEMANTIC, foreground: UNAVAILABLE, route: "ax_value" },
      type_text: { background: AVAILABLE_SEMANTIC, foreground: UNAVAILABLE, route: "ax_value" }
    },
    platform: "macos"
  },
  "windows-win32": {
    capabilities: {
      keypress: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "uia_unavailable" },
      press: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "uia_action" },
      scroll: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "uia_unavailable" },
      set_value: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "uia_value" },
      type_text: { background: UNAVAILABLE, foreground: UNAVAILABLE, route: "uia_value" }
    },
    platform: "windows"
  }
}

export async function createJingleComputerUseNativeBackend(
  environment: ComputerUseBackendEnvironment,
  bridge: JingleComputerUseNativeBridge,
  signal?: AbortSignal
): Promise<ComputerUseBackend> {
  signal?.throwIfAborted()
  const rawMatrix = await bridge.invoke({ environment, method: "probe" }, signal)
  signal?.throwIfAborted()
  return new NativeComputerUseBackend(bridge, validateProbedMatrix(environment, rawMatrix))
}

class NativeComputerUseBackend implements ComputerUseBackend {
  constructor(
    private readonly bridge: JingleComputerUseNativeBridge,
    readonly matrix: ComputerUseCapabilityMatrix
  ) {}

  async observe(request: ComputerUseObserveRequest): Promise<ComputerUseBackendObservation> {
    request.signal?.throwIfAborted()
    const { signal, ...nativeRequest } = request
    const result = await this.bridge.invoke({ method: "observe", request: nativeRequest }, signal)
    signal?.throwIfAborted()
    return decodeNativeObservation(this.matrix.platform, result)
  }

  async execute(request: ComputerUseExecuteRequest): Promise<ComputerUseBackendExecutionResult> {
    request.signal?.throwIfAborted()
    if (
      request.actions.length === 0 ||
      request.actions.length > COMPUTER_USE_NATIVE_RESPONSE_LIMITS.actions
    ) {
      throw new Error("Computer-use native execution has an invalid action count.")
    }
    for (const action of request.actions) {
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
    const { signal, ...nativeRequest } = request
    const result = await this.bridge.invoke({ method: "execute", request: nativeRequest }, signal)
    signal?.throwIfAborted()
    return decodeNativeExecutionResult(result, request, this.matrix)
  }

  async disposeSession(sessionId: string): Promise<void> {
    await this.bridge.invoke({ method: "dispose_session", sessionId })
  }
}

function validateProbedMatrix(
  environment: ComputerUseBackendEnvironment,
  value: unknown
): ComputerUseCapabilityMatrix {
  const policy = environmentPolicies[environment]
  if (
    !hasExactKeys(value, ["capabilities", "environment", "platform", "protocolVersion"]) ||
    value.environment !== environment ||
    value.platform !== policy.platform ||
    value.protocolVersion !== JINGLE_COMPUTER_USE_PROTOCOL_VERSION
  ) {
    throw new Error(
      "Computer-use native capability probe returned another environment or protocol."
    )
  }
  if (
    !isDenseArray(value.capabilities, ACTIONS.length) ||
    value.capabilities.length !== ACTIONS.length
  ) {
    throw new Error("Computer-use native capability probe returned an invalid action set.")
  }

  const capabilities = new Map<ComputerUseActionKind, ComputerUseCapability>()
  for (const candidate of value.capabilities) {
    if (
      !hasExactKeys(candidate, ["action", "background", "foreground", "route"]) ||
      !isComputerUseActionKind(candidate.action)
    ) {
      throw new Error("Computer-use native capability probe returned an invalid action set.")
    }
    const action = candidate.action
    if (capabilities.has(action)) {
      throw new Error("Computer-use native capability probe returned a duplicate action.")
    }
    const expected = policy.capabilities[action]
    if (
      !isBoundedString(candidate.route, COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token) ||
      candidate.route !== expected.route
    ) {
      throw new Error(
        `Computer-use native capability probe returned an untrusted route for ${action}.`
      )
    }
    if (
      (candidate.background === "verified" || candidate.foreground === "verified") &&
      (candidate.route === "unavailable" || candidate.route === "global_input")
    ) {
      throw new Error(
        `Computer-use native capability probe verified an unavailable route for ${action}.`
      )
    }
    if (
      !isCapabilityStatus(candidate.background) ||
      !expected.background.includes(candidate.background) ||
      !isCapabilityStatus(candidate.foreground) ||
      !expected.foreground.includes(candidate.foreground)
    ) {
      throw new Error(
        `Computer-use native capability probe returned invalid support for ${action}.`
      )
    }
    capabilities.set(action, {
      action,
      background: candidate.background,
      foreground: candidate.foreground,
      route: candidate.route
    })
  }

  if (capabilities.size !== ACTIONS.length) {
    throw new Error("Computer-use native capability probe omitted a required action.")
  }
  return deepFreeze({
    capabilities: ACTIONS.map((action) => capabilities.get(action)!),
    environment,
    platform: policy.platform,
    protocolVersion: JINGLE_COMPUTER_USE_PROTOCOL_VERSION
  })
}

function isComputerUseActionKind(value: unknown): value is ComputerUseActionKind {
  return typeof value === "string" && ACTIONS.includes(value as ComputerUseActionKind)
}

function isCapabilityStatus(value: unknown): value is ComputerUseCapabilityStatus {
  return value === "verified" || value === "refused" || value === "unavailable"
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

function decodeNativeObservation(
  platform: ComputerUsePlatform,
  value: unknown
): ComputerUseBackendObservation {
  if (!hasExactKeys(value, ["application", "capturedAt", "elements", "resourceKey", "window"])) {
    throw new Error("Computer-use native observation has an invalid envelope.")
  }
  if (!hasExactKeys(value.application, ["id", "name"])) {
    throw new Error("Computer-use native observation has an invalid application identity.")
  }
  const application = {
    id: readString(
      value.application.id,
      "application.id",
      COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
    ),
    name: readString(
      value.application.name,
      "application.name",
      COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text
    )
  }
  const capturedAt = readNonNegativeInteger(value.capturedAt, "capturedAt")
  const resourceKey = readString(
    value.resourceKey,
    "resourceKey",
    COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
  )
  const window = decodeNativeWindowIdentity(value.window, platform)
  if (!isDenseArray(value.elements, COMPUTER_USE_NATIVE_RESPONSE_LIMITS.elements)) {
    throw new Error("Computer-use native observation has an invalid element count.")
  }
  const refs = new Set<string>()
  const elements = value.elements.map((candidate, index) => {
    const element = decodeNativeElement(candidate, index)
    if (element.index !== index) {
      throw new Error("Computer-use native observation element indexes are not canonical.")
    }
    if (refs.has(element.ref)) {
      throw new Error("Computer-use native observation contains duplicate semantic refs.")
    }
    refs.add(element.ref)
    return element
  })
  return deepFreeze({ application, capturedAt, elements, resourceKey, window })
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

function decodeNativeElement(value: unknown, offset: number): ComputerUseElement {
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
    ...readOptionalTextFields(value, ["description", "identifier", "title", "value"]),
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
  assertNativeExecutionConsistency(outcome, steps, request.actions.length)
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
  const action = decodeNativeAction(value.action, offset)
  if (!sameSemanticAction(action, expectedAction)) {
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
  if (outcome === "worked" && value.evidence.verification !== "verified") {
    throw new Error("Computer-use native execution reported worked without verified evidence.")
  }
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

function decodeNativeAction(value: unknown, offset: number): ComputerUseSemanticAction {
  if (!hasExactKeys(value, ["kind", "ref"], ["keys", "scrollAmount", "value"])) {
    throw new Error(`Computer-use native execution action ${offset} has an invalid shape.`)
  }
  if (!isComputerUseActionKind(value.kind)) {
    throw new Error(`Computer-use native execution action ${offset} has an invalid kind.`)
  }
  const ref = readString(
    value.ref,
    `steps[${offset}].action.ref`,
    COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
  )
  const action: ComputerUseSemanticAction = { kind: value.kind, ref }
  if (Object.hasOwn(value, "value")) {
    action.value = readText(value.value, `steps[${offset}].action.value`)
  }
  if (Object.hasOwn(value, "scrollAmount")) {
    if (typeof value.scrollAmount !== "number" || !Number.isFinite(value.scrollAmount)) {
      throw new Error(`Computer-use native execution action ${offset} has invalid scrollAmount.`)
    }
    action.scrollAmount = value.scrollAmount
  }
  if (Object.hasOwn(value, "keys")) {
    if (!isDenseArray(value.keys, COMPUTER_USE_NATIVE_RESPONSE_LIMITS.keys)) {
      throw new Error(`Computer-use native execution action ${offset} has invalid keys.`)
    }
    action.keys = value.keys.map((key, keyOffset) =>
      readString(
        key,
        `steps[${offset}].action.keys[${keyOffset}]`,
        COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
      )
    )
    if (new Set(action.keys).size !== action.keys.length) {
      throw new Error(`Computer-use native execution action ${offset} has duplicate keys.`)
    }
  }
  return action
}

function sameSemanticAction(
  left: ComputerUseSemanticAction,
  right: ComputerUseSemanticAction
): boolean {
  return (
    left.kind === right.kind &&
    left.ref === right.ref &&
    left.value === right.value &&
    left.scrollAmount === right.scrollAmount &&
    sameStrings(left.keys, right.keys)
  )
}

function sameStrings(left?: readonly string[], right?: readonly string[]): boolean {
  if (!left || !right) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function assertNativeExecutionConsistency(
  outcome: ComputerUseBackendExecutionOutcome,
  steps: readonly ComputerUseBackendStepResult[],
  actionCount: number
): void {
  if (outcome === "worked" || outcome === "didnt") {
    if (steps.length !== actionCount || steps.some((step) => step.outcome !== outcome)) {
      throw new Error(`Computer-use native execution returned an inconsistent ${outcome} result.`)
    }
    return
  }
  if (
    (outcome === "refused" || outcome === "unavailable") &&
    steps.some((step) => step.outcome === "worked" || step.outcome === "unknown")
  ) {
    throw new Error("Computer-use native execution refusal contradicts its step outcomes.")
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
  keys: readonly ("description" | "identifier" | "title" | "value")[]
): Partial<Pick<ComputerUseElement, "description" | "identifier" | "title" | "value">> {
  const result: Partial<
    Pick<ComputerUseElement, "description" | "identifier" | "title" | "value">
  > = {}
  for (const key of keys) {
    if (Object.hasOwn(value, key)) result[key] = readText(value[key], `element.${key}`)
  }
  return result
}

function readNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Computer-use native ${path} must be a non-negative safe integer.`)
  }
  return value as number
}

function readString(value: unknown, path: string, maximum: number): string {
  if (!isBoundedString(value, maximum)) {
    throw new Error(`Computer-use native ${path} must be a bounded non-empty string.`)
  }
  return value
}

function readText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length > COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text) {
    throw new Error(`Computer-use native ${path} must be a bounded string.`)
  }
  return value
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
