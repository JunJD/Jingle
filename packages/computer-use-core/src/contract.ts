export const JINGLE_COMPUTER_USE_PROTOCOL_VERSION = 1 as const

export type ComputerUsePlatform = "macos" | "windows" | "linux"
export type ComputerUseBackendEnvironment =
  | "macos-quartz"
  | "windows-win32"
  | "linux-x11"
  | "linux-wayland-gnome"
  | "linux-wayland-kde"
  | "linux-wayland-other"
export type ComputerUseActionKind = "press" | "set_value" | "type_text" | "keypress" | "scroll"
export type ComputerUseDeliveryMode = "background" | "foreground"
export type ComputerUseOutcome =
  | "worked"
  | "didnt"
  | "unknown"
  | "refused"
  | "unavailable"
  | "cancelled_before_dispatch"

export interface ComputerUseWindowIdentity {
  generation: string
  nativeId: string
  pid: number
  platform: ComputerUsePlatform
}

export interface ComputerUseElement {
  actions: readonly ComputerUseActionKind[]
  description?: string
  identifier?: string
  index: number
  ref: string
  role: string
  title?: string
  value?: string
}

export interface ComputerUseObservation {
  application: {
    id: string
    name: string
  }
  capturedAt: number
  elements: readonly ComputerUseElement[]
  epoch: number
  resourceKey: string
  stateId: string
  window: ComputerUseWindowIdentity
}

export type ComputerUseBackendObservation = Omit<
  ComputerUseObservation,
  "epoch" | "stateId"
>

export interface ComputerUseSemanticAction {
  kind: ComputerUseActionKind
  ref: string
  value?: string
  keys?: readonly string[]
  scrollAmount?: number
}

export interface ComputerUseActionEvidence {
  delivery: "semantic" | "targeted_input" | "global_input"
  noSideEffectProof: boolean
  route: string
  verification: "verified" | "failed" | "unverifiable"
}

export interface ComputerUseStepResult {
  action: ComputerUseSemanticAction
  evidence: ComputerUseActionEvidence
  outcome: ComputerUseOutcome
}

export interface ComputerUseTransactionResult {
  baseStateId: string
  outcome: ComputerUseOutcome
  steps: readonly ComputerUseStepResult[]
  stoppedAt?: number
  successor?: ComputerUseObservation
}

export type ComputerUseBackendExecutionResult = Omit<ComputerUseTransactionResult, "successor">

export interface ComputerUseCapability {
  action: ComputerUseActionKind
  background: "verified" | "refused" | "unavailable"
  foreground: "verified" | "refused" | "unavailable"
  route: string
}

export interface ComputerUseCapabilityMatrix {
  capabilities: readonly ComputerUseCapability[]
  environment: ComputerUseBackendEnvironment
  platform: ComputerUsePlatform
  protocolVersion: typeof JINGLE_COMPUTER_USE_PROTOCOL_VERSION
}

export interface ComputerUseObserveRequest {
  applicationId?: string
  applicationName?: string
  signal?: AbortSignal
  windowId?: string
}

export interface ComputerUseExecuteRequest {
  actions: readonly ComputerUseSemanticAction[]
  authorization: ComputerUseAuthorizationGrant
  base: ComputerUseObservation
  delivery: ComputerUseDeliveryMode
  signal?: AbortSignal
}

export interface ComputerUseAuthorizationGrant {
  expiresAt: number
  runId: string
  sessionId: string
  threadId: string
  window: ComputerUseWindowIdentity
}

export interface ComputerUseBackend {
  readonly matrix: ComputerUseCapabilityMatrix
  observe(request: ComputerUseObserveRequest): Promise<ComputerUseBackendObservation>
  execute(request: ComputerUseExecuteRequest): Promise<ComputerUseBackendExecutionResult>
  disposeSession(sessionId: string): Promise<void>
}
