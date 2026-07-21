import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open, readdir, realpath, type FileHandle } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type {
  DiagnosticSupportPacketCoverage,
  DiagnosticSupportPacketExportResult,
  DiagnosticSupportPacketFailureCode
} from "@shared/diagnostics"
import { sanitizeDiagnosticText, sanitizeDiagnosticValue } from "./redaction"
import {
  DIAGNOSTIC_GRAPH_SCHEMA_VERSION,
  DIAGNOSTIC_REDACTION_VERSION,
  type DiagnosticEvidenceRef,
  type DiagnosticGraphEvent,
  type DiagnosticResourceRef,
  type DiagnosticScalar
} from "./schema"

const JOURNAL_NAME_PATTERN = /^jingle\.log(?:\.(\d+))?$/
const EVENT_CODE_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/i
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SOURCE_REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const PACKET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0
const MAX_JOURNAL_FILES = 6
const MAX_JOURNAL_SCAN_BYTES = 8 * 1024 * 1024
const MAX_RECORD_BYTES = 256 * 1024
const MAX_EVIDENCE_BLOBS = 500
const MAX_EVIDENCE_BYTES = 64 * 1024
const MAX_EXPORTED_EVIDENCE_BYTES = 8 * 1024 * 1024
const MAX_PACKET_BYTES = 24 * 1024 * 1024

export type DiagnosticSupportPacketGapCode =
  | "corrupt-evidence"
  | "cross-session-parent-edge"
  | "duplicate-parent-edge"
  | "evidence-capture-failed"
  | "incompatible-graph-record"
  | "legacy-record"
  | "malformed-line"
  | "missing-evidence"
  | "missing-parent-edge"
  | "non-past-parent-edge"
  | "sequence-gap"

export interface DiagnosticSupportPacketRuntimeIdentity {
  appVersion: string
  electronVersion: string
  isPackaged: boolean
  platform: NodeJS.Platform
  sourceRevision:
    | { kind: "available"; value: string }
    | { kind: "unavailable"; reason: "not-embedded" }
}

export interface DiagnosticSupportPacketManifestV1 {
  appVersion: string
  coverage: DiagnosticSupportPacketCoverage
  createdAt: string
  electronVersion: string
  eventCount: number
  evidenceCount: number
  gaps: Array<{ code: DiagnosticSupportPacketGapCode; count: number }>
  isPackaged: boolean
  packetId: string
  platform: NodeJS.Platform
  sourceRevision: DiagnosticSupportPacketRuntimeIdentity["sourceRevision"]
  version: 1
}

export interface DiagnosticSupportPacketV1 {
  events: DiagnosticGraphEvent[]
  evidence: Array<{
    blobId: string
    content: unknown
    packetSha256: string
    sourceSha256: string
  }>
  kind: "jingle-diagnostic-support-packet"
  manifest: DiagnosticSupportPacketManifestV1
  version: 1
}

export interface CreateDiagnosticSupportPacketInput {
  destinationDirectory: string
  idFactory?: () => string
  now?: () => Date
  runtimeIdentity: DiagnosticSupportPacketRuntimeIdentity
  sourceLogDirectory: string
  sourceRootDirectory: string
}

interface DirectorySnapshot {
  dev: number
  handle: FileHandle
  ino: number
  path: string
}

interface ParsedJournal {
  events: DiagnosticGraphEvent[]
  gaps: Map<DiagnosticSupportPacketGapCode, number>
}

interface SafeFileRead {
  bytes: Buffer
  dev: number
  ino: number
}

export class DiagnosticSupportPacketError extends Error {
  constructor(readonly code: DiagnosticSupportPacketFailureCode) {
    super(`Diagnostic support packet failed: ${code}.`)
    this.name = "DiagnosticSupportPacketError"
  }
}

function fail(code: DiagnosticSupportPacketFailureCode): never {
  throw new DiagnosticSupportPacketError(code)
}

function isMissingError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  )
}

function isWithin(root: string, candidate: string): boolean {
  const descendant = relative(root, candidate)
  return (
    descendant === "" ||
    (!isAbsolute(descendant) && descendant !== ".." && !descendant.startsWith(`..${sep}`))
  )
}

function isPrivateMode(mode: number, expected: number): boolean {
  return (mode & 0o777) === expected
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isSafeToken(value: string, maxLength: number): boolean {
  return TOKEN_PATTERN.test(value) && sanitizeDiagnosticText(value, maxLength) === value
}

function readString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number
): string | null {
  const value = record[key]
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null
}

function readNonnegativeInteger(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function incrementGap(
  gaps: Map<DiagnosticSupportPacketGapCode, number>,
  code: DiagnosticSupportPacketGapCode,
  count = 1
): void {
  gaps.set(code, Math.min(Number.MAX_SAFE_INTEGER, (gaps.get(code) ?? 0) + count))
}

async function openDirectorySnapshot(
  path: string,
  options: {
    unavailableCode: DiagnosticSupportPacketFailureCode
    unsafeCode: DiagnosticSupportPacketFailureCode
    requirePrivate: boolean
  }
): Promise<DirectorySnapshot> {
  const absolutePath = resolve(path)
  let handle: FileHandle
  try {
    const before = await lstat(absolutePath)
    if (before.isSymbolicLink() || !before.isDirectory()) {
      fail(options.unsafeCode)
    }
    handle = await open(absolutePath, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | NO_FOLLOW)
  } catch (error) {
    if (error instanceof DiagnosticSupportPacketError) throw error
    fail(options.unavailableCode)
  }

  try {
    const opened = await handle.stat()
    const after = await lstat(absolutePath)
    const resolved = await realpath(absolutePath)
    if (
      !opened.isDirectory() ||
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      opened.dev !== after.dev ||
      opened.ino !== after.ino ||
      (options.requirePrivate && !isPrivateMode(opened.mode, PRIVATE_DIRECTORY_MODE))
    ) {
      fail(options.unsafeCode)
    }
    return { dev: opened.dev, handle, ino: opened.ino, path: resolved }
  } catch (error) {
    await handle.close()
    if (error instanceof DiagnosticSupportPacketError) throw error
    fail(options.unavailableCode)
  }
}

async function closeDirectorySnapshot(snapshot: DirectorySnapshot): Promise<void> {
  await snapshot.handle.close()
}

async function assertDirectoryUnchanged(
  snapshot: DirectorySnapshot,
  failureCode: DiagnosticSupportPacketFailureCode
): Promise<void> {
  try {
    const opened = await snapshot.handle.stat()
    const after = await lstat(snapshot.path)
    if (
      !opened.isDirectory() ||
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      opened.dev !== snapshot.dev ||
      opened.ino !== snapshot.ino ||
      after.dev !== snapshot.dev ||
      after.ino !== snapshot.ino
    ) {
      fail(failureCode)
    }
  } catch (error) {
    if (error instanceof DiagnosticSupportPacketError) throw error
    fail(failureCode)
  }
}

async function assertPrivateAncestorDirectories(
  root: string,
  filePath: string,
  allowMissing: boolean
): Promise<boolean> {
  const parent = dirname(resolve(filePath))
  if (!isWithin(root, parent)) {
    fail("source_unsafe")
  }
  const descendant = relative(root, parent)
  let current = root
  for (const segment of descendant ? descendant.split(sep) : []) {
    if (!segment || segment === "." || segment === "..") {
      fail("source_unsafe")
    }
    current = join(current, segment)
    if (allowMissing) {
      try {
        await lstat(current)
      } catch (error) {
        if (isMissingError(error)) return false
        throw error
      }
    }
    try {
      const snapshot = await openDirectorySnapshot(current, {
        unavailableCode: "source_unavailable",
        unsafeCode: "source_unsafe",
        requirePrivate: true
      })
      await closeDirectorySnapshot(snapshot)
    } catch (error) {
      if (allowMissing && isMissingError(error)) return false
      throw error
    }
  }
  return true
}

async function readSafePrivateFile(
  path: string,
  root: string,
  maxBytes: number,
  allowMissing = false
): Promise<SafeFileRead | null> {
  const absolutePath = resolve(path)
  if (!isWithin(root, absolutePath)) fail("source_unsafe")
  const ancestorsExist = await assertPrivateAncestorDirectories(root, absolutePath, allowMissing)
  if (!ancestorsExist) return null

  let handle: FileHandle
  try {
    handle = await open(absolutePath, constants.O_RDONLY | NO_FOLLOW)
  } catch (error) {
    if (allowMissing && isMissingError(error)) return null
    fail(isMissingError(error) ? "source_changed" : "source_unavailable")
  }
  try {
    const before = await handle.stat()
    const pathStat = await lstat(absolutePath)
    const resolved = await realpath(absolutePath)
    if (
      !before.isFile() ||
      pathStat.isSymbolicLink() ||
      !pathStat.isFile() ||
      before.dev !== pathStat.dev ||
      before.ino !== pathStat.ino ||
      !isWithin(root, resolved) ||
      !isPrivateMode(before.mode, PRIVATE_FILE_MODE)
    ) {
      fail("source_unsafe")
    }
    if (before.size > maxBytes) fail("bounds_exceeded")
    const readExact = async (): Promise<Buffer> => {
      const bytes = Buffer.alloc(before.size)
      let offset = 0
      while (offset < bytes.byteLength) {
        const read = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
        if (read.bytesRead <= 0) fail("source_changed")
        offset += read.bytesRead
      }
      return bytes
    }
    const bytes = await readExact()
    const verificationBytes = await readExact()
    const after = await handle.stat()
    const afterPath = await lstat(absolutePath)
    const resolvedAfter = await realpath(absolutePath)
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      afterPath.isSymbolicLink() ||
      !afterPath.isFile() ||
      afterPath.dev !== before.dev ||
      afterPath.ino !== before.ino ||
      resolvedAfter !== resolved ||
      bytes.byteLength !== before.size ||
      !bytes.equals(verificationBytes)
    ) {
      fail("source_changed")
    }
    return { bytes, dev: before.dev, ino: before.ino }
  } catch (error) {
    if (error instanceof DiagnosticSupportPacketError) throw error
    fail("source_unsafe")
  } finally {
    await handle.close()
  }
}

function normalizeDimensions(value: unknown): Record<string, DiagnosticScalar> | null {
  if (!isPlainRecord(value)) return null
  const entries = Object.entries(value)
  if (entries.length > 16) return null
  const dimensions: Record<string, DiagnosticScalar> = {}
  for (const [key, raw] of entries) {
    if (!isSafeToken(key, 64) || key.length > 64) return null
    if (raw === null || typeof raw === "boolean") {
      dimensions[key] = raw
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      dimensions[key] = raw
    } else if (typeof raw === "string" && raw.length <= 128) {
      dimensions[key] = sanitizeDiagnosticText(raw, 128, key)
    } else {
      return null
    }
  }
  return dimensions
}

function normalizeResourceRefs(value: unknown): DiagnosticResourceRef[] | null {
  if (!Array.isArray(value) || value.length > 16) return null
  const refs: DiagnosticResourceRef[] = []
  for (const raw of value) {
    if (!isPlainRecord(raw)) return null
    const kind = readString(raw, "kind", 64)
    const id = readString(raw, "id", 256)
    if (!kind || !id || !isSafeToken(kind, 64)) return null
    refs.push({ kind, id: sanitizeDiagnosticText(id, 256) })
  }
  return refs
}

function normalizeEvidenceRefs(value: unknown): DiagnosticEvidenceRef[] | null {
  if (!Array.isArray(value) || value.length > 8) return null
  const refs: DiagnosticEvidenceRef[] = []
  for (const raw of value) {
    if (!isPlainRecord(raw)) return null
    const blobId = readString(raw, "blobId", 80)
    const capture = raw["capture"]
    const contentType = readString(raw, "contentType", 128)
    const kind = readString(raw, "kind", 64)
    const originalSizeBytes = readNonnegativeInteger(raw, "originalSizeBytes")
    const redactionVersion = readNonnegativeInteger(raw, "redactionVersion")
    const sha256 = readString(raw, "sha256", 64)
    const sizeBytes = readNonnegativeInteger(raw, "sizeBytes")
    const truncated = raw["truncated"]
    if (
      !blobId ||
      (capture !== "failed" && capture !== "stored") ||
      !contentType ||
      !kind ||
      !isSafeToken(kind, 64) ||
      originalSizeBytes === null ||
      redactionVersion !== DIAGNOSTIC_REDACTION_VERSION ||
      !sha256 ||
      !SHA256_PATTERN.test(sha256) ||
      blobId !== `sha256:${sha256}` ||
      sizeBytes === null ||
      sizeBytes > MAX_EVIDENCE_BYTES ||
      typeof truncated !== "boolean"
    ) {
      return null
    }
    refs.push({
      blobId,
      capture,
      contentType: sanitizeDiagnosticText(contentType, 128),
      kind: sanitizeDiagnosticText(kind, 64),
      originalSizeBytes,
      redactionVersion,
      sha256,
      sizeBytes,
      truncated
    })
  }
  return refs
}

function normalizeGraphEvent(value: unknown): DiagnosticGraphEvent | null {
  if (!isPlainRecord(value)) return null
  if (
    value["recordType"] !== "diagnostic.event" ||
    value["schemaVersion"] !== DIAGNOSTIC_GRAPH_SCHEMA_VERSION ||
    value["redactionVersion"] !== DIAGNOSTIC_REDACTION_VERSION
  ) {
    return null
  }
  const component = readString(value, "component", 64)
  const dimensions = normalizeDimensions(value["dimensions"])
  const eventCode = readString(value, "eventCode", 160)
  const eventId = readString(value, "eventId", 160)
  const evidenceRefs = normalizeEvidenceRefs(value["evidenceRefs"])
  const fingerprint = readString(value, "fingerprint", 160)
  const level = value["level"]
  const message = readString(value, "message", 240)
  const operation = readString(value, "operation", 64)
  const parentEventIds = value["parentEventIds"]
  const processKind = readString(value, "processKind", 32)
  const recoverable = value["recoverable"]
  const refs = normalizeResourceRefs(value["refs"])
  const sequence = readNonnegativeInteger(value, "sequence")
  const sessionId = readString(value, "sessionId", 64)
  const stateImpact = readString(value, "stateImpact", 96)
  const timestamp = readString(value, "timestamp", 64)
  if (
    !component ||
    !isSafeToken(component, 64) ||
    !dimensions ||
    !eventCode ||
    !EVENT_CODE_PATTERN.test(eventCode) ||
    sanitizeDiagnosticText(eventCode, 160) !== eventCode ||
    !eventId ||
    !evidenceRefs ||
    !fingerprint ||
    (level !== "info" && level !== "warn" && level !== "error") ||
    !message ||
    !operation ||
    !isSafeToken(operation, 64) ||
    !Array.isArray(parentEventIds) ||
    parentEventIds.length > 4 ||
    parentEventIds.some((entry) => typeof entry !== "string" || entry.length > 160) ||
    !processKind ||
    !isSafeToken(processKind, 32) ||
    typeof recoverable !== "boolean" ||
    !refs ||
    sequence === null ||
    sequence < 1 ||
    !sessionId ||
    !isSafeToken(sessionId, 64) ||
    eventId !== `diag:${sessionId}:${sequence}` ||
    !stateImpact ||
    !isSafeToken(stateImpact, 96) ||
    !timestamp ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    return null
  }
  return {
    component,
    dimensions,
    eventCode,
    eventId,
    evidenceRefs,
    fingerprint: sanitizeDiagnosticText(fingerprint, 160),
    level,
    message: sanitizeDiagnosticText(message, 240),
    operation,
    parentEventIds: parentEventIds as string[],
    processKind,
    recordType: "diagnostic.event",
    recoverable,
    redactionVersion: DIAGNOSTIC_REDACTION_VERSION,
    refs,
    schemaVersion: DIAGNOSTIC_GRAPH_SCHEMA_VERSION,
    sequence,
    sessionId,
    stateImpact,
    timestamp: new Date(timestamp).toISOString()
  }
}

function parseJournal(buffers: Buffer[]): ParsedJournal {
  const events: DiagnosticGraphEvent[] = []
  const gaps = new Map<DiagnosticSupportPacketGapCode, number>()
  const seenEventIds = new Set<string>()
  for (const buffer of buffers) {
    for (const line of buffer.toString("utf8").split("\n")) {
      if (!line) continue
      if (Buffer.byteLength(line, "utf8") > MAX_RECORD_BYTES) fail("bounds_exceeded")
      let parsed: unknown
      try {
        parsed = JSON.parse(line) as unknown
      } catch {
        incrementGap(gaps, "malformed-line")
        continue
      }
      if (!isPlainRecord(parsed) || parsed["recordType"] !== "diagnostic.event") {
        incrementGap(gaps, "legacy-record")
        continue
      }
      const event = normalizeGraphEvent(parsed)
      if (!event) {
        incrementGap(gaps, "incompatible-graph-record")
        continue
      }
      if (seenEventIds.has(event.eventId)) fail("integrity_failed")
      seenEventIds.add(event.eventId)
      events.push(event)
    }
  }

  const eventsById = new Map(events.map((event) => [event.eventId, event]))
  const sequencesBySession = new Map<string, number[]>()
  for (const event of events) {
    const sequences = sequencesBySession.get(event.sessionId) ?? []
    sequences.push(event.sequence)
    sequencesBySession.set(event.sessionId, sequences)
    const seenParentIds = new Set<string>()
    const validParents = event.parentEventIds.filter((parentId) => {
      if (seenParentIds.has(parentId)) {
        incrementGap(gaps, "duplicate-parent-edge")
        return false
      }
      seenParentIds.add(parentId)
      const parent = eventsById.get(parentId)
      if (!parent) {
        incrementGap(gaps, "missing-parent-edge")
        return false
      }
      if (parent.sessionId !== event.sessionId) {
        incrementGap(gaps, "cross-session-parent-edge")
        return false
      }
      if (parent.sequence >= event.sequence) {
        incrementGap(gaps, "non-past-parent-edge")
        return false
      }
      return true
    })
    event.parentEventIds = validParents
  }
  for (const sequences of sequencesBySession.values()) {
    sequences.sort((left, right) => left - right)
    for (let index = 1; index < sequences.length; index += 1) {
      const missing = sequences[index] - sequences[index - 1] - 1
      if (missing > 0) incrementGap(gaps, "sequence-gap", missing)
    }
  }
  return { events, gaps }
}

async function readJournal(logDirectory: string): Promise<ParsedJournal> {
  const readCandidateNames = async (): Promise<Array<{ index: number; name: string }>> => {
    try {
      return (await readdir(logDirectory, { withFileTypes: true }))
        .flatMap((entry) => {
          const match = JOURNAL_NAME_PATTERN.exec(entry.name)
          return match
            ? [{ index: match[1] ? Number.parseInt(match[1], 10) : 0, name: entry.name }]
            : []
        })
        .sort((left, right) => right.index - left.index)
    } catch (error) {
      fail(isMissingError(error) ? "source_changed" : "source_unavailable")
    }
  }
  const candidates = await readCandidateNames()
  if (candidates.length > MAX_JOURNAL_FILES) fail("bounds_exceeded")
  const buffers: Buffer[] = []
  let totalBytes = 0
  for (const candidate of candidates) {
    const remaining = MAX_JOURNAL_SCAN_BYTES - totalBytes
    if (remaining < 0) fail("bounds_exceeded")
    const file = await readSafePrivateFile(
      join(logDirectory, candidate.name),
      logDirectory,
      remaining
    )
    if (!file) fail("source_changed")
    totalBytes += file.bytes.byteLength
    if (totalBytes > MAX_JOURNAL_SCAN_BYTES) fail("bounds_exceeded")
    buffers.push(file.bytes)
  }
  const afterCandidates = await readCandidateNames()
  if (
    candidates.length !== afterCandidates.length ||
    candidates.some((candidate, index) => candidate.name !== afterCandidates[index]?.name)
  ) {
    fail("source_changed")
  }
  return parseJournal(buffers)
}

async function readEvidence(
  events: DiagnosticGraphEvent[],
  logDirectory: string,
  gaps: Map<DiagnosticSupportPacketGapCode, number>
): Promise<DiagnosticSupportPacketV1["evidence"]> {
  const refs = new Map<string, DiagnosticEvidenceRef>()
  for (const event of events) {
    for (const ref of event.evidenceRefs) {
      if (ref.capture === "stored") {
        refs.set(ref.blobId, ref)
      } else {
        incrementGap(gaps, "evidence-capture-failed")
      }
    }
  }
  if (refs.size > MAX_EVIDENCE_BLOBS) fail("bounds_exceeded")
  const evidence: DiagnosticSupportPacketV1["evidence"] = []
  let totalBytes = 0
  for (const ref of refs.values()) {
    const source = await readSafePrivateFile(
      join(logDirectory, "blobs", "sha256", ref.sha256.slice(0, 2), `${ref.sha256}.json`),
      logDirectory,
      MAX_EVIDENCE_BYTES,
      true
    )
    if (!source) {
      incrementGap(gaps, "missing-evidence")
      continue
    }
    totalBytes += source.bytes.byteLength
    if (totalBytes > MAX_EXPORTED_EVIDENCE_BYTES) fail("bounds_exceeded")
    const sourceSha256 = createHash("sha256").update(source.bytes).digest("hex")
    if (source.bytes.byteLength !== ref.sizeBytes || sourceSha256 !== ref.sha256) {
      incrementGap(gaps, "corrupt-evidence")
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(source.bytes.toString("utf8")) as unknown
    } catch {
      incrementGap(gaps, "corrupt-evidence")
      continue
    }
    const content = sanitizeDiagnosticValue(parsed, MAX_EVIDENCE_BYTES)
    const serialized = JSON.stringify(content)
    evidence.push({
      blobId: ref.blobId,
      content,
      packetSha256: createHash("sha256").update(serialized).digest("hex"),
      sourceSha256
    })
  }
  return evidence
}

function resolveCoverage(
  events: DiagnosticGraphEvent[],
  legacyCount: number
): DiagnosticSupportPacketCoverage {
  if (events.some((event) => event.level === "warn" || event.level === "error")) {
    return "causal-events-observed"
  }
  if (events.length > 0) return "no-failure-events-observed"
  return legacyCount > 0 ? "legacy-only" : "empty"
}

function normalizeRuntimeIdentity(
  runtimeIdentity: DiagnosticSupportPacketRuntimeIdentity
): DiagnosticSupportPacketRuntimeIdentity {
  const appVersion = sanitizeDiagnosticText(runtimeIdentity.appVersion, 128)
  const electronVersion = sanitizeDiagnosticText(runtimeIdentity.electronVersion, 128)
  const platform = sanitizeDiagnosticText(runtimeIdentity.platform, 32) as NodeJS.Platform
  if (
    runtimeIdentity.sourceRevision.kind === "available" &&
    !SOURCE_REVISION_PATTERN.test(runtimeIdentity.sourceRevision.value)
  ) {
    fail("integrity_failed")
  }
  return {
    appVersion,
    electronVersion,
    isPackaged: runtimeIdentity.isPackaged,
    platform,
    sourceRevision: runtimeIdentity.sourceRevision
  }
}

async function writePacketExclusively(
  destination: DirectorySnapshot,
  packet: DiagnosticSupportPacketV1
): Promise<void> {
  const filename = `jingle-support-${packet.manifest.createdAt.replace(/[:.]/g, "-")}-${packet.manifest.packetId}.json`
  const finalPath = join(destination.path, filename)
  const serialized = `${JSON.stringify(packet)}\n`
  const expectedBytes = Buffer.from(serialized, "utf8")
  if (expectedBytes.byteLength > MAX_PACKET_BYTES) fail("bounds_exceeded")
  let fileCreated = false
  try {
    const handle = await open(
      finalPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | NO_FOLLOW,
      PRIVATE_FILE_MODE
    )
    fileCreated = true
    let committed = false
    try {
      await handle.chmod(PRIVATE_FILE_MODE)
      await handle.writeFile(serialized, "utf8")
      await handle.sync()
      const openedStat = await handle.stat()
      const pathStat = await lstat(finalPath)
      const resolvedFinal = await realpath(finalPath)
      if (
        !openedStat.isFile() ||
        pathStat.isSymbolicLink() ||
        !pathStat.isFile() ||
        openedStat.dev !== pathStat.dev ||
        openedStat.ino !== pathStat.ino ||
        !isWithin(destination.path, resolvedFinal) ||
        !isPrivateMode(openedStat.mode, PRIVATE_FILE_MODE)
      ) {
        fail("destination_incomplete")
      }
      await assertDirectoryUnchanged(destination, "destination_incomplete")
      await destination.handle.sync()
      const verificationBytes = Buffer.alloc(expectedBytes.byteLength)
      let offset = 0
      while (offset < verificationBytes.byteLength) {
        const read = await handle.read(
          verificationBytes,
          offset,
          verificationBytes.byteLength - offset,
          offset
        )
        if (read.bytesRead <= 0) fail("destination_incomplete")
        offset += read.bytesRead
      }
      const verifiedHandle = await handle.stat()
      await assertDirectoryUnchanged(destination, "destination_incomplete")
      const verifiedRealPath = await realpath(finalPath)
      const verifiedPath = await lstat(finalPath)
      if (
        verifiedHandle.dev !== openedStat.dev ||
        verifiedHandle.ino !== openedStat.ino ||
        verifiedHandle.size !== expectedBytes.byteLength ||
        verifiedPath.isSymbolicLink() ||
        !verifiedPath.isFile() ||
        verifiedPath.dev !== openedStat.dev ||
        verifiedPath.ino !== openedStat.ino ||
        !isWithin(destination.path, verifiedRealPath) ||
        !verificationBytes.equals(expectedBytes)
      ) {
        fail("destination_incomplete")
      }
      committed = true
    } finally {
      await handle.close().catch((error) => {
        if (!committed) throw error
      })
    }
  } catch (error) {
    // Never delete by pathname: another process could replace the entry after identity checks.
    if (fileCreated) fail("destination_incomplete")
    if (error instanceof DiagnosticSupportPacketError) throw error
    fail("destination_unavailable")
  }
}

export async function createDiagnosticSupportPacket(
  input: CreateDiagnosticSupportPacketInput
): Promise<DiagnosticSupportPacketExportResult> {
  if (process.platform === "win32") fail("platform_unavailable")
  const packetId = (input.idFactory ?? randomUUID)().toLowerCase()
  if (!PACKET_ID_PATTERN.test(packetId)) fail("integrity_failed")
  const createdAt = (input.now ?? (() => new Date()))().toISOString()
  const sourceRoot = await openDirectorySnapshot(input.sourceRootDirectory, {
    unavailableCode: "source_unavailable",
    unsafeCode: "source_unsafe",
    requirePrivate: true
  })
  let sourceLogs: DirectorySnapshot | null = null
  let destination: DirectorySnapshot | null = null
  try {
    sourceLogs = await openDirectorySnapshot(input.sourceLogDirectory, {
      unavailableCode: "source_unavailable",
      unsafeCode: "source_unsafe",
      requirePrivate: true
    })
    if (!isWithin(sourceRoot.path, sourceLogs.path) || sourceRoot.path === sourceLogs.path) {
      fail("source_unsafe")
    }
    destination = await openDirectorySnapshot(input.destinationDirectory, {
      unavailableCode: "destination_unavailable",
      unsafeCode: "destination_unsafe",
      requirePrivate: true
    })
    if (isWithin(sourceRoot.path, destination.path)) fail("destination_unsafe")

    const parsed = await readJournal(sourceLogs.path)
    const evidence = await readEvidence(parsed.events, sourceLogs.path, parsed.gaps)
    await assertDirectoryUnchanged(sourceRoot, "source_changed")
    await assertDirectoryUnchanged(sourceLogs, "source_changed")
    const identity = normalizeRuntimeIdentity(input.runtimeIdentity)
    const gaps = [...parsed.gaps.entries()]
      .filter(([, count]) => count > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, count]) => ({ code, count }))
    const coverage = resolveCoverage(parsed.events, parsed.gaps.get("legacy-record") ?? 0)
    const packet: DiagnosticSupportPacketV1 = {
      events: parsed.events,
      evidence,
      kind: "jingle-diagnostic-support-packet",
      manifest: {
        ...identity,
        coverage,
        createdAt,
        eventCount: parsed.events.length,
        evidenceCount: evidence.length,
        gaps,
        packetId,
        version: 1
      },
      version: 1
    }
    await writePacketExclusively(destination, packet)
    return {
      coverage,
      eventCount: parsed.events.length,
      evidenceCount: evidence.length,
      gapCount: gaps.reduce((total, gap) => total + gap.count, 0),
      kind: "exported",
      packetId
    }
  } finally {
    if (destination) await closeDirectorySnapshot(destination)
    if (sourceLogs) await closeDirectorySnapshot(sourceLogs)
    await closeDirectorySnapshot(sourceRoot)
  }
}

export async function exportDiagnosticSupportPacket(
  destinationDirectory: string
): Promise<DiagnosticSupportPacketExportResult> {
  const { diagnosticsGraph, diagnosticsLogger, getDiagnosticsSupportPacketRuntimeIdentity } =
    await import("./instance")
  await diagnosticsGraph.flush()
  return diagnosticsLogger.runWithWriteLock(() =>
    createDiagnosticSupportPacket({
      destinationDirectory,
      runtimeIdentity: getDiagnosticsSupportPacketRuntimeIdentity(),
      sourceLogDirectory: diagnosticsLogger.getLogDir(),
      sourceRootDirectory: dirname(diagnosticsLogger.getLogDir())
    })
  )
}

export function readDiagnosticSupportPacketErrorCode(
  error: unknown
): DiagnosticSupportPacketFailureCode {
  return error instanceof DiagnosticSupportPacketError ? error.code : "unexpected"
}
