export const ARTIFACT_KINDS = ["file", "patch", "link", "summary"] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export const DEFERRED_ARTIFACT_KINDS = ["image", "html", "decision", "table"] as const

export type DeferredArtifactKind = (typeof DEFERRED_ARTIFACT_KINDS)[number]

export const ARTIFACT_STATUSES = ["ready", "missing", "stale"] as const

export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number]

export const ARTIFACT_ACTION_IDS = [
  "open",
  "preview",
  "download",
  "reveal-source",
  "copy-link"
] as const

export type ArtifactActionId = (typeof ARTIFACT_ACTION_IDS)[number]

export interface ArtifactCapabilities {
  primaryAction: ArtifactActionId | null
  supportedActions: ArtifactActionId[]
}

export type ManagedFileArtifactSource = {
  type: "managed-file-path"
  uri: string
}

export type ExternalUrlArtifactSource = {
  type: "external-url"
  uri: string
}

export type InlineTextArtifactSource = {
  type: "inline-text"
  uri: null
}

export type ArtifactSource =
  | ManagedFileArtifactSource
  | ExternalUrlArtifactSource
  | InlineTextArtifactSource

export type ArtifactSourceType = ArtifactSource["type"]

export interface ArtifactPresentationRequestIdentity {
  idempotencyKey: string
  threadId: string
}

export interface ArtifactChangedEvent {
  artifacts: ArtifactRecord[]
  threadId: string
}

interface ArtifactRecordBase {
  id: string
  threadId: string
  runId: string | null
  messageId: string | null
  toolCallId: string | null
  title: string
  subtitle: string | null
  mimeType: string | null
  sizeBytes: number | null
  previewText: string | null
  status: ArtifactStatus
  createdAt: Date
  updatedAt: Date
}

export interface FileArtifactRecord extends ArtifactRecordBase {
  kind: "file"
  payload: null
  source: ManagedFileArtifactSource
}

export interface InlinePatchArtifactRecord extends ArtifactRecordBase {
  kind: "patch"
  payload: {
    format: "diff"
    text: string
  }
  source: InlineTextArtifactSource
}

export interface ManagedPatchArtifactRecord extends ArtifactRecordBase {
  kind: "patch"
  payload: null
  source: ManagedFileArtifactSource
}

export interface LinkArtifactRecord extends ArtifactRecordBase {
  kind: "link"
  payload: null
  source: ExternalUrlArtifactSource
}

export interface SummaryArtifactRecord extends ArtifactRecordBase {
  kind: "summary"
  payload: {
    format: "markdown" | "plain"
    text: string
  }
  source: InlineTextArtifactSource
}

export type ArtifactRecord =
  | FileArtifactRecord
  | InlinePatchArtifactRecord
  | ManagedPatchArtifactRecord
  | LinkArtifactRecord
  | SummaryArtifactRecord

export interface ArtifactPresentationContext {
  threadId: string
  runId?: string | null
  messageId?: string | null
  toolCallId?: string | null
}

interface BaseArtifactInput {
  artifactKey: string
  dedupeKey?: string
  subtitle?: string | null
  title?: string
}

export interface PresentFileArtifactInput extends BaseArtifactInput {
  kind: "file"
  mimeType?: string | null
  path: string
  previewText?: string | null
  sizeBytes?: number | null
  sourceType: "managed-file-path"
}

type PresentInlinePatchArtifactInput = BaseArtifactInput & {
  kind: "patch"
  mimeType?: string | null
  patchText: string
  previewText?: string | null
  sourceType: "inline-text"
}

type PresentManagedPatchArtifactInput = BaseArtifactInput & {
  kind: "patch"
  mimeType?: string | null
  path: string
  previewText?: string | null
  sizeBytes?: number | null
  sourceType: "managed-file-path"
}

export type PresentPatchArtifactInput =
  | PresentInlinePatchArtifactInput
  | PresentManagedPatchArtifactInput

export interface PresentLinkArtifactInput extends BaseArtifactInput {
  kind: "link"
  previewText?: string | null
  title: string
  url: string
}

export interface PresentSummaryArtifactInput extends BaseArtifactInput {
  format?: "markdown" | "plain"
  kind: "summary"
  text: string
  title: string
}

export type PresentArtifactInput =
  | PresentFileArtifactInput
  | PresentPatchArtifactInput
  | PresentLinkArtifactInput
  | PresentSummaryArtifactInput

export interface PresentArtifactsRequest extends ArtifactPresentationContext {
  artifacts: PresentArtifactInput[]
  idempotencyKey: string
}

export const ARTIFACT_WRITE_OUTCOMES = ["created", "updated", "reused"] as const

export type ArtifactWriteOutcome = (typeof ARTIFACT_WRITE_OUTCOMES)[number]

export interface ArtifactPresentationReceipt {
  artifactId: string
  artifactKey: string
  dedupeKey: string | null
  outcome: ArtifactWriteOutcome
}

export interface PresentArtifactsStoredResult {
  artifacts: ArtifactRecord[]
  receipts: ArtifactPresentationReceipt[]
  requestIdentity: ArtifactPresentationRequestIdentity
  type: "stored" | "replayed"
}

export interface PresentArtifactsConflictResult {
  reason: "request-content-mismatch"
  requestIdentity: ArtifactPresentationRequestIdentity
  type: "idempotency-conflict"
}

export type PresentArtifactsResult = PresentArtifactsStoredResult | PresentArtifactsConflictResult

export interface ArtifactActionRequest {
  action: ArtifactActionId
  artifactId: string
}

export type ArtifactActionResolution =
  | {
      type: "detail"
    }
  | {
      type: "external-browser"
      url: string
    }
  | {
      path: string
      type: "system-default"
    }
  | {
      type: "download"
      uri: string
    }
  | {
      path: string
      type: "reveal-source"
    }
  | {
      type: "copy-link"
      value: string
    }
