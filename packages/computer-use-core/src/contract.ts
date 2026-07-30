import { JINGLE_COMPUTER_USE_PROTOCOL_VERSION } from "../native-policy.mjs"

export { JINGLE_COMPUTER_USE_PROTOCOL_VERSION }

export const COMPUTER_USE_NATIVE_RESPONSE_LIMITS = Object.freeze({
  actions: 128,
  elements: 750,
  keys: 32,
  text: 16_384,
  token: 1_024
})

export type ComputerUsePlatform = "macos" | "windows" | "linux"
export type ComputerUseBackendEnvironment =
  | "macos-quartz"
  | "windows-win32"
  | "linux-x11"
  | "linux-wayland-gnome"
  | "linux-wayland-kde"
  | "linux-wayland-other"
export type ComputerUseActionKind =
  | "activate"
  | "press"
  | "set_value"
  | "type_text"
  | "keypress"
  | "scroll"
export type ComputerUseDeliveryMode = "background" | "foreground"
export type ComputerUseTraceOperation =
  | "scheduler"
  | "execute_background"
  | "execute_foreground"
  | "observe_successor"
  | "observe_recovery"
export type ComputerUseOutcome =
  | "worked"
  | "didnt"
  | "unknown"
  | "refused"
  | "unavailable"
  | "cancelled_before_dispatch"

export interface ComputerUseTraceEvent {
  dispatchOccurred: boolean
  environment: ComputerUseBackendEnvironment
  errorCode: string
  kind: "operation_failed"
  nativeCode?: string
  operation: ComputerUseTraceOperation
  platform: ComputerUsePlatform
  runId: string
  threadId: string
  transactionId: string
}

export interface ComputerUseTraceSink {
  record(event: ComputerUseTraceEvent): void
}

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
  sourceTruncated: boolean
  stateId: string
  window: ComputerUseWindowIdentity
}

export type ComputerUseForcedReanchorReason =
  | "context_compaction"
  | "external_mutation_uncertain"
  | "process_restart"
  | "requested"

export type ComputerUseFullViewReason =
  | ComputerUseForcedReanchorReason
  | "diff_over_budget"
  | "initial"
  | "low_identity_confidence"
  | "root_replacement"
  | "source_truncated"
  | "state_evicted"

export type ComputerUseIdentityReason =
  | "platform_fingerprint"
  | "semantic_match"
  | "stable_ref_overlap"

export interface ComputerUseProjectionTruncation {
  byteLimit: number
  omittedElements: number
  truncatedFields: number
}

export interface ComputerUseFoldedFullView {
  application: ComputerUseObservation["application"]
  capturedAt: number
  elements: readonly ComputerUseElement[]
  epoch: number
  hasMore: boolean
  kind: "full"
  reason: ComputerUseFullViewReason
  sourceTruncated: boolean
  stateId: string
  totalElements: number
  truncation: ComputerUseProjectionTruncation
}

export interface ComputerUseObservationDiff {
  added: readonly ComputerUseElement[]
  baseStateId: string
  capturedAt: number
  identityConfidence: number
  identityReason: ComputerUseIdentityReason
  kind: "diff"
  removed: readonly string[]
  successorEpoch: number
  successorStateId: string
  updated: readonly ComputerUseElement[]
}

export type ComputerUseModelObservation = ComputerUseFoldedFullView | ComputerUseObservationDiff

export interface ComputerUseObservationQueryResult {
  elements: readonly ComputerUseElement[]
  hasMore: boolean
  sourceTruncated: boolean
  stateId: string
  totalElements: number
  truncation: ComputerUseProjectionTruncation
}

export type ComputerUseBackendObservation = Omit<ComputerUseObservation, "epoch" | "stateId">

export type ComputerUseTargetIdentity = Pick<
  ComputerUseBackendObservation,
  "application" | "resourceKey" | "window"
>

interface ComputerUseSemanticActionBase {
  ref: string
}

export type ComputerUseSemanticAction =
  | (ComputerUseSemanticActionBase & {
      keys?: never
      kind: "activate"
      scrollAmount?: never
      value?: never
    })
  | (ComputerUseSemanticActionBase & {
      keys?: never
      kind: "press"
      scrollAmount?: never
      value?: never
    })
  | (ComputerUseSemanticActionBase & {
      keys?: never
      kind: "set_value" | "type_text"
      scrollAmount?: never
      value: string
    })
  | (ComputerUseSemanticActionBase & {
      keys: readonly string[]
      kind: "keypress"
      scrollAmount?: never
      value?: never
    })
  | (ComputerUseSemanticActionBase & {
      keys?: never
      kind: "scroll"
      scrollAmount: number
      value?: never
    })

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

export type ComputerUseRetryDisposition =
  | { allowed: true; reason: "proven_no_side_effect" }
  | {
      allowed: false
      reason: "cancelled" | "not_actionable" | "side_effect_possible"
    }

export type ComputerUseBackendExecutionOutcome = Exclude<
  ComputerUseOutcome,
  "cancelled_before_dispatch"
>

export interface ComputerUseBackendFailure {
  readonly successorObservationSafe: boolean
}

export function computerUseBackendFailurePrecludesSuccessorObservation(
  error: unknown
): error is ComputerUseBackendFailure & { readonly successorObservationSafe: false } {
  return (
    error instanceof Error &&
    "successorObservationSafe" in error &&
    error.successorObservationSafe === false
  )
}

export type ComputerUseBackendStepResult = Omit<ComputerUseStepResult, "outcome"> & {
  outcome: ComputerUseBackendExecutionOutcome
}

export type ComputerUseBackendExecutionResult = Omit<
  ComputerUseTransactionResult,
  "outcome" | "steps" | "successor"
> & {
  outcome: ComputerUseBackendExecutionOutcome
  steps: readonly ComputerUseBackendStepResult[]
}

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

export interface ComputerUseIdentifyRequest {
  applicationId: string
  applicationName?: string
  signal?: AbortSignal
  windowId?: string
}

export interface ComputerUseObserveRequest {
  signal?: AbortSignal
  target: ComputerUseTargetIdentity
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
  identify(request: ComputerUseIdentifyRequest): Promise<ComputerUseTargetIdentity>
  observe(request: ComputerUseObserveRequest): Promise<ComputerUseBackendObservation>
  execute(request: ComputerUseExecuteRequest): Promise<ComputerUseBackendExecutionResult>
  disposeSession(sessionId: string): Promise<void>
}
