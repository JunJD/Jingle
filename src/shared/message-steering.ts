export const JINGLE_STEERING_STATUS_METADATA_KEY = "jingleSteeringStatus" as const
export const JINGLE_STEERING_APPLIED_MARKER_METADATA_KEY =
  "jingleSteeringAppliedMarker" as const

export type JingleSteeringStatus = "pending" | "applied"

export interface JingleSteeringAppliedMarkerMetadata {
  kind: "applied"
  messageId: string
  runId: string | null
}

export function readJingleSteeringStatus(
  metadata: Record<string, unknown> | null | undefined
): JingleSteeringStatus | null {
  const value = metadata?.[JINGLE_STEERING_STATUS_METADATA_KEY]
  return value === "pending" || value === "applied" ? value : null
}

export function hasJingleSteeringStatus(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  return readJingleSteeringStatus(metadata) !== null
}

export function mergeJingleSteeringStatusMetadata(
  metadata: Record<string, unknown> | undefined,
  status: JingleSteeringStatus
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    [JINGLE_STEERING_STATUS_METADATA_KEY]: status
  }
}

export function readJingleSteeringAppliedMarker(
  metadata: Record<string, unknown> | null | undefined
): JingleSteeringAppliedMarkerMetadata | null {
  const value = metadata?.[JINGLE_STEERING_APPLIED_MARKER_METADATA_KEY]
  if (!value || typeof value !== "object") {
    return null
  }

  const marker = value as Record<string, unknown>
  if (marker.kind !== "applied" || typeof marker.messageId !== "string") {
    return null
  }

  if (marker.runId !== null && typeof marker.runId !== "string") {
    return null
  }

  return {
    kind: "applied",
    messageId: marker.messageId,
    runId: marker.runId
  }
}

export function mergeJingleSteeringAppliedMarkerMetadata(
  metadata: Record<string, unknown> | undefined,
  marker: JingleSteeringAppliedMarkerMetadata
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    [JINGLE_STEERING_APPLIED_MARKER_METADATA_KEY]: marker
  }
}
