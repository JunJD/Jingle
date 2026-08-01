import type { DiagnosticResourceRef, DiagnosticScalar } from "./schema"

/**
 * Electron's child-process-gone event is main-process owned, but its service
 * labels are still external strings. Keep only the labels we deliberately
 * understand and use one canonical token for durable refs and fingerprints.
 */
export type ElectronUtilityServiceIdentity =
  | "audio-service"
  | "extension-runtime"
  | "node-utility-process"
  | "network-service"
  | "video-capture-service"
  | "unknown"

export interface NormalizedElectronChildProcessDetails {
  exitCode?: number
  name?: string
  processType: string
  reason: string
  serviceIdentity: ElectronUtilityServiceIdentity
  serviceName?: string
}

const SERVICE_NAME_IDENTITIES = new Map<string, ElectronUtilityServiceIdentity>([
  ["audio.mojom.AudioService", "audio-service"],
  ["Audio Service", "audio-service"],
  ["Jingle Extension Runtime", "extension-runtime"],
  ["Node Utility Process", "node-utility-process"],
  ["network.mojom.NetworkService", "network-service"],
  ["Network Service", "network-service"],
  ["video_capture.mojom.VideoCaptureService", "video-capture-service"],
  ["Video Capture", "video-capture-service"]
])

const SERVICE_LABEL_IDENTITIES = new Map<string, ElectronUtilityServiceIdentity>([
  ["Audio Service", "audio-service"],
  ["Jingle Extension Runtime", "extension-runtime"],
  ["Node Utility Process", "node-utility-process"],
  ["Network Service", "network-service"],
  ["Video Capture", "video-capture-service"]
])

const PROCESS_TYPES = new Map([
  ["GPU", "gpu"],
  ["Pepper Plugin", "pepper-plugin"],
  ["Pepper Plugin Broker", "pepper-plugin-broker"],
  ["Sandbox helper", "sandbox-helper"],
  ["Unknown", "unknown"],
  ["Utility", "utility"],
  ["Zygote", "zygote"],
  ["gpu", "gpu"],
  ["pepper-plugin", "pepper-plugin"],
  ["pepper-plugin-broker", "pepper-plugin-broker"],
  ["sandbox-helper", "sandbox-helper"],
  ["unknown", "unknown"],
  ["utility", "utility"],
  ["zygote", "zygote"]
])

const PROCESS_GONE_REASONS = new Set([
  "abnormal-exit",
  "clean-exit",
  "crashed",
  "integrity-failure",
  "killed",
  "launch-failed",
  "memory-eviction",
  "oom"
])

function readBoundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
    ? value
    : undefined
}

function readIdentity(
  value: unknown,
  identities: Map<string, ElectronUtilityServiceIdentity>
): ElectronUtilityServiceIdentity | undefined {
  const stringValue = readBoundedString(value, 96)
  return stringValue ? identities.get(stringValue) : undefined
}

function normalizeServiceIdentity(
  serviceName: unknown,
  name: unknown
): Pick<NormalizedElectronChildProcessDetails, "name" | "serviceIdentity" | "serviceName"> {
  const normalizedServiceName = readBoundedString(serviceName, 96)
  const normalizedName = readBoundedString(name, 96)
  const serviceNameIdentity = readIdentity(serviceName, SERVICE_NAME_IDENTITIES)
  const nameIdentity = readIdentity(name, SERVICE_LABEL_IDENTITIES)
  const hasServiceName = serviceName !== undefined
  const hasName = name !== undefined
  if ((hasServiceName && !serviceNameIdentity) || (hasName && !nameIdentity)) {
    return { serviceIdentity: "unknown" }
  }
  const serviceIdentity =
    serviceNameIdentity && nameIdentity
      ? serviceNameIdentity === nameIdentity
        ? serviceNameIdentity
        : "unknown"
      : (serviceNameIdentity ?? nameIdentity ?? "unknown")

  // Never carry a source value that did not participate in a recognized,
  // coherent identity. This keeps hostile and oversize labels out of both
  // the graph journal and the legacy diagnostic line.
  if (serviceIdentity === "unknown") {
    return { serviceIdentity }
  }
  return {
    ...(normalizedName ? { name: normalizedName } : {}),
    serviceIdentity,
    ...(normalizedServiceName ? { serviceName: normalizedServiceName } : {})
  }
}

export function normalizeElectronChildProcessDetails(input: {
  exitCode: unknown
  name?: unknown
  processType: unknown
  reason: unknown
  serviceName?: unknown
}): NormalizedElectronChildProcessDetails {
  const processType =
    typeof input.processType === "string"
      ? (PROCESS_TYPES.get(input.processType) ?? "unknown")
      : "unknown"
  const reason =
    typeof input.reason === "string" && PROCESS_GONE_REASONS.has(input.reason)
      ? input.reason
      : "unknown"
  const exitCode =
    typeof input.exitCode === "number" && Number.isSafeInteger(input.exitCode)
      ? input.exitCode
      : undefined
  const service =
    processType === "utility"
      ? normalizeServiceIdentity(input.serviceName, input.name)
      : { serviceIdentity: "unknown" as const }
  return { exitCode, processType, reason, ...service }
}

export function electronChildProcessResourceRef(
  details: Pick<NormalizedElectronChildProcessDetails, "processType" | "serviceIdentity">
): DiagnosticResourceRef {
  const suffix =
    details.processType === "utility" && details.serviceIdentity !== "unknown"
      ? `:${details.serviceIdentity}`
      : ""
  return { id: `child:${details.processType}${suffix}`, kind: "process" }
}

export function electronChildProcessFingerprint(
  details: Pick<NormalizedElectronChildProcessDetails, "processType" | "reason" | "serviceIdentity">
): string {
  const suffix =
    details.processType === "utility" && details.serviceIdentity !== "unknown"
      ? `:${details.serviceIdentity}`
      : ""
  return `electron.child_process_gone:${details.processType}:${details.reason}${suffix}`
}

function readDimension(
  dimensions: Readonly<Record<string, DiagnosticScalar>>,
  key: string
): DiagnosticScalar | undefined {
  return Object.prototype.hasOwnProperty.call(dimensions, key) ? dimensions[key] : undefined
}

/**
 * Re-check the main-owned utility identity when importing a support packet.
 * The journal is untrusted at this boundary, so ref/fingerprint consistency
 * must be proven again instead of trusting the producer's serialized shape.
 */
export function isElectronChildProcessEventConsistent(event: {
  component: string
  dimensions: Readonly<Record<string, DiagnosticScalar>>
  eventCode: string
  fingerprint: string
  refs: readonly DiagnosticResourceRef[]
}): boolean {
  if (event.eventCode !== "electron.child_process_gone") return true
  if (event.component !== "electron") return false
  const processType = readDimension(event.dimensions, "processType")
  const reason = readDimension(event.dimensions, "reason")
  if (typeof processType !== "string" || typeof reason !== "string") return false
  const exitCode = readDimension(event.dimensions, "exitCode")
  const normalized = normalizeElectronChildProcessDetails({
    exitCode,
    name: readDimension(event.dimensions, "name"),
    processType,
    reason,
    serviceName: readDimension(event.dimensions, "serviceName")
  })
  if (
    processType !== normalized.processType ||
    reason !== normalized.reason ||
    (exitCode !== undefined && exitCode !== normalized.exitCode)
  ) {
    return false
  }
  const serviceIdentity = readDimension(event.dimensions, "serviceIdentity")
  if (normalized.processType === "utility") {
    if (serviceIdentity !== normalized.serviceIdentity) return false
    if (
      normalized.serviceIdentity === "unknown" &&
      (readDimension(event.dimensions, "name") !== undefined ||
        readDimension(event.dimensions, "serviceName") !== undefined)
    ) {
      return false
    }
  } else if (
    serviceIdentity !== undefined ||
    readDimension(event.dimensions, "name") !== undefined ||
    readDimension(event.dimensions, "serviceName") !== undefined
  ) {
    return false
  }
  const expectedRef = electronChildProcessResourceRef(normalized)
  return (
    event.refs.length === 1 &&
    event.refs[0]?.kind === expectedRef.kind &&
    event.refs[0]?.id === expectedRef.id &&
    event.fingerprint === electronChildProcessFingerprint(normalized)
  )
}
