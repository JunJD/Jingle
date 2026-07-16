import type { DiagnosticsLevel } from "./logger"

export const DIAGNOSTIC_GRAPH_SCHEMA_VERSION = 1
export const DIAGNOSTIC_REDACTION_VERSION = 2

export type DiagnosticScalar = boolean | null | number | string

export interface DiagnosticDimensionInput {
  key: string
  value: DiagnosticScalar
}

export interface DiagnosticEventRef {
  eventId: string
  sequence: number
  sessionId: string
}

export interface DiagnosticResourceRef {
  id: string
  kind: string
}

export interface DiagnosticEvidenceInput {
  contentType?: string
  kind: string
  value: unknown
}

export interface DiagnosticEvidenceRef {
  blobId: string
  capture: "failed" | "stored"
  contentType: string
  kind: string
  originalSizeBytes: number
  redactionVersion: number
  sha256: string
  sizeBytes: number
  truncated: boolean
}

export interface DiagnosticGraphEventInput {
  component: string
  dimensionEntries?: readonly DiagnosticDimensionInput[]
  /** @deprecated Object-shaped dimensions are ignored and recorded as unsafe input. */
  dimensions?: Readonly<Record<string, DiagnosticScalar>>
  eventCode: string
  evidence?: readonly DiagnosticEvidenceInput[]
  fingerprint?: string
  level: DiagnosticsLevel
  operation: string
  parentEvents?: readonly DiagnosticEventRef[]
  recoverable: boolean
  refs?: readonly DiagnosticResourceRef[]
  stateImpact: string
  summary: string
}

export interface DiagnosticGraphEvent {
  component: string
  dimensions: Readonly<Record<string, DiagnosticScalar>>
  eventCode: string
  eventId: string
  evidenceRefs: readonly DiagnosticEvidenceRef[]
  fingerprint: string
  level: DiagnosticsLevel
  message: string
  operation: string
  parentEventIds: readonly string[]
  processKind: string
  recordType: "diagnostic.event"
  recoverable: boolean
  redactionVersion: number
  refs: readonly DiagnosticResourceRef[]
  schemaVersion: number
  sequence: number
  sessionId: string
  stateImpact: string
  timestamp: string
}

export interface DiagnosticGraphSink {
  capture(input: DiagnosticGraphEventInput): DiagnosticEventRef
}
