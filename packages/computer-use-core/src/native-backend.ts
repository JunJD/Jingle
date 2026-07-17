import { JINGLE_COMPUTER_USE_PROTOCOL_VERSION } from "./contract"
import type {
  ComputerUseActionKind,
  ComputerUseBackend,
  ComputerUseBackendEnvironment,
  ComputerUseBackendExecutionResult,
  ComputerUseBackendObservation,
  ComputerUseCapability,
  ComputerUseCapabilityMatrix,
  ComputerUseExecuteRequest,
  ComputerUseObserveRequest,
  ComputerUsePlatform
} from "./contract"

export type JingleComputerUseNativeRequest =
  | { environment: ComputerUseBackendEnvironment; method: "probe" }
  | { method: "observe"; request: Omit<ComputerUseObserveRequest, "signal"> }
  | { method: "execute"; request: Omit<ComputerUseExecuteRequest, "signal"> }
  | { method: "dispose_session"; sessionId: string }

export interface JingleComputerUseNativeBridge {
  invoke<T>(request: JingleComputerUseNativeRequest, signal?: AbortSignal): Promise<T>
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
  const rawMatrix = await bridge.invoke<unknown>({ environment, method: "probe" }, signal)
  signal?.throwIfAborted()
  return new NativeComputerUseBackend(
    environment,
    bridge,
    validateProbedMatrix(environment, rawMatrix)
  )
}

class NativeComputerUseBackend implements ComputerUseBackend {
  constructor(
    private readonly environment: ComputerUseBackendEnvironment,
    private readonly bridge: JingleComputerUseNativeBridge,
    readonly matrix: ComputerUseCapabilityMatrix
  ) {}

  async observe(request: ComputerUseObserveRequest): Promise<ComputerUseBackendObservation> {
    request.signal?.throwIfAborted()
    const { signal, ...nativeRequest } = request
    const result = await this.bridge.invoke<ComputerUseBackendObservation>(
      { method: "observe", request: nativeRequest },
      signal
    )
    signal?.throwIfAborted()
    this.assertObservation(result)
    return result
  }

  async execute(request: ComputerUseExecuteRequest): Promise<ComputerUseBackendExecutionResult> {
    request.signal?.throwIfAborted()
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
    const result = await this.bridge.invoke<ComputerUseBackendExecutionResult>(
      { method: "execute", request: nativeRequest },
      signal
    )
    signal?.throwIfAborted()
    return result
  }

  async disposeSession(sessionId: string): Promise<void> {
    await this.bridge.invoke<void>({ method: "dispose_session", sessionId })
  }

  private assertObservation(observation: ComputerUseBackendObservation): void {
    if (observation.window.platform !== this.matrix.platform) {
      throw new Error(
        `Computer-use backend ${this.environment} returned ${observation.window.platform} observation.`
      )
    }
    if (!observation.resourceKey || !observation.window.generation) {
      throw new Error("Computer-use backend returned an incomplete immutable observation.")
    }
  }
}

function validateProbedMatrix(
  environment: ComputerUseBackendEnvironment,
  value: unknown
): ComputerUseCapabilityMatrix {
  const policy = environmentPolicies[environment]
  if (
    !isRecord(value) ||
    value.environment !== environment ||
    value.platform !== policy.platform ||
    value.protocolVersion !== JINGLE_COMPUTER_USE_PROTOCOL_VERSION
  ) {
    throw new Error(
      "Computer-use native capability probe returned another environment or protocol."
    )
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length !== ACTIONS.length) {
    throw new Error("Computer-use native capability probe returned an invalid action set.")
  }

  const capabilities = new Map<ComputerUseActionKind, ComputerUseCapability>()
  for (const candidate of value.capabilities) {
    if (!isRecord(candidate) || !isComputerUseActionKind(candidate.action)) {
      throw new Error("Computer-use native capability probe returned an invalid action set.")
    }
    const action = candidate.action
    if (capabilities.has(action)) {
      throw new Error("Computer-use native capability probe returned a duplicate action.")
    }
    const expected = policy.capabilities[action]
    if (candidate.route !== expected.route) {
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

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.freeze(value)
}
