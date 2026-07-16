import { createHash, randomUUID } from "node:crypto"
import { lstat, readdir, unlink } from "node:fs/promises"
import { join } from "node:path"
import { types } from "node:util"
import {
  APPEND_DIAGNOSTIC_GRAPH_EVENT,
  DIAGNOSTIC_GRAPH_EVENT_BRAND,
  DiagnosticsLogger
} from "./logger"
import {
  createDiagnosticTraversalBudget,
  sanitizeDiagnosticText,
  serializeDiagnosticEvidence,
  type DiagnosticTraversalBudget
} from "./redaction"
import {
  assertPrivateDirectory,
  ensurePrivateChildDirectory,
  openPrivateFileForExclusiveWrite,
  openPrivateFileForRead
} from "./private-files"
import {
  DIAGNOSTIC_GRAPH_SCHEMA_VERSION,
  DIAGNOSTIC_REDACTION_VERSION,
  type DiagnosticEventRef,
  type DiagnosticEvidenceRef,
  type DiagnosticGraphEvent,
  type DiagnosticGraphEventInput,
  type DiagnosticGraphSink,
  type DiagnosticResourceRef,
  type DiagnosticScalar
} from "./schema"

const DEFAULT_MAX_EVIDENCE_BYTES = 64 * 1024
const DEFAULT_MAX_EVIDENCE_STORE_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_PENDING_EVENTS = 256
const DEFAULT_MAX_PENDING_EVIDENCE_BYTES = 4 * 1024 * 1024
const MAX_DIMENSIONS = 16
const MAX_COMPONENT_LENGTH = 64
const MAX_CONTENT_TYPE_LENGTH = 128
const MAX_DIMENSION_KEY_LENGTH = 64
const MAX_DIMENSION_STRING_LENGTH = 128
const MAX_EVENT_CODE_LENGTH = 160
const MAX_EVIDENCE_REFS = 8
const MAX_EVIDENCE_KIND_LENGTH = 64
const MAX_OPERATION_LENGTH = 64
const MAX_PARENT_EVENTS = 4
const MAX_PROCESS_KIND_LENGTH = 32
const MAX_RESOURCE_REFS = 16
const MAX_RESOURCE_KIND_LENGTH = 64
const MAX_SESSION_ID_LENGTH = 64
const MAX_STATE_IMPACT_LENGTH = 96
const MAX_SUMMARY_LENGTH = 240
const MAX_RETAINED_JOURNAL_SCAN_BYTES = 8 * 1024 * 1024
const EVENT_CODE_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/i

interface PreparedEvidence {
  ref: Omit<DiagnosticEvidenceRef, "capture">
  serialized: string
}

interface StoredEvidenceFile {
  blobId: string
  mtimeMs: number
  path: string
  sizeBytes: number
}

export interface DiagnosticsGraphRecorderOptions {
  logger: DiagnosticsLogger
  maxEvidenceBytes?: number
  maxEvidenceStoreBytes?: number
  maxPendingEvents?: number
  maxPendingEvidenceBytes?: number
  onWriteError?: (error: unknown, context: { eventCode: string; eventId: string }) => void
  processKind?: string
  sessionId?: string
}

function normalizeToken(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength + 2) {
    return fallback
  }
  const normalized = value.trim()
  return normalized &&
    normalized.length <= maxLength &&
    TOKEN_PATTERN.test(normalized) &&
    sanitizeDiagnosticText(normalized, maxLength) === normalized
    ? normalized
    : fallback
}

function readOwnDataField(value: object, key: string): unknown {
  if (types.isProxy(value)) {
    return undefined
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && "value" in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function readBoundedArrayItems(value: unknown, maxItems: number): unknown[] {
  if (!value || typeof value !== "object" || types.isProxy(value)) {
    return []
  }
  try {
    if (!Array.isArray(value)) {
      return []
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length")
    const length =
      lengthDescriptor &&
      "value" in lengthDescriptor &&
      Number.isSafeInteger(lengthDescriptor.value)
        ? Math.min(Math.max(0, lengthDescriptor.value as number), maxItems)
        : 0
    const items: unknown[] = []
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (descriptor && "value" in descriptor) {
        items.push(descriptor.value)
      }
    }
    return items
  } catch {
    return []
  }
}

function normalizeDimensions(
  entries: unknown,
  legacyInput: unknown
): Record<string, DiagnosticScalar> {
  const dimensions: Record<string, DiagnosticScalar> = {}
  for (const candidate of readBoundedArrayItems(entries, MAX_DIMENSIONS)) {
    if (!candidate || typeof candidate !== "object" || types.isProxy(candidate)) {
      continue
    }
    const key = readOwnDataField(candidate, "key")
    const value = readOwnDataField(candidate, "value")
    if (
      typeof key !== "string" ||
      !(
        value === null ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)) ||
        typeof value === "string"
      )
    ) {
      continue
    }
    const normalizedKey = normalizeToken(key, "invalid-dimension", MAX_DIMENSION_KEY_LENGTH)
    dimensions[normalizedKey] =
      typeof value === "string"
        ? sanitizeDiagnosticText(value, MAX_DIMENSION_STRING_LENGTH, key)
        : value
  }
  if (legacyInput !== undefined) {
    dimensions["unsafeDimensionObjectCount"] = 1
  }
  return dimensions
}

function normalizeResourceRefs(refs: unknown): DiagnosticResourceRef[] {
  const seen = new Set<string>()
  const normalized: DiagnosticResourceRef[] = []
  for (const candidate of readBoundedArrayItems(refs, MAX_RESOURCE_REFS)) {
    if (!candidate || typeof candidate !== "object" || types.isProxy(candidate)) {
      continue
    }
    const kindValue = readOwnDataField(candidate, "kind")
    const idValue = readOwnDataField(candidate, "id")
    if (typeof kindValue !== "string" || typeof idValue !== "string") {
      continue
    }
    const kind = normalizeToken(kindValue, "unknown", MAX_RESOURCE_KIND_LENGTH)
    const id = sanitizeDiagnosticText(idValue, 256).trim()
    const key = `${kind}:${id}`
    if (!id || seen.has(key)) {
      continue
    }
    seen.add(key)
    normalized.push({ id, kind })
    if (normalized.length >= MAX_RESOURCE_REFS) {
      break
    }
  }
  return normalized
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  )
}

export class DiagnosticsGraphRecorder implements DiagnosticGraphSink {
  private readonly durableEvents = new WeakSet<object>()
  private readonly issuedEvents = new WeakSet<object>()
  private readonly logger: DiagnosticsLogger
  private readonly maxEvidenceBytes: number
  private readonly maxEvidenceStoreBytes: number
  private readonly maxPendingEvents: number
  private readonly maxPendingEvidenceBytes: number
  private readonly onWriteError: NonNullable<DiagnosticsGraphRecorderOptions["onWriteError"]>
  private readonly processKind: string
  private readonly sessionId: string
  private evidenceStoreBytes: number | null = null
  private droppedEventCount = 0
  private pendingEvents = 0
  private pendingEvidenceBytes = 0
  private reportingDroppedEventCount = 0
  private sequence = 0
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(options: DiagnosticsGraphRecorderOptions) {
    this.logger = options.logger
    const requestedMaxEvidenceBytes = options.maxEvidenceBytes ?? DEFAULT_MAX_EVIDENCE_BYTES
    this.maxEvidenceBytes = Number.isFinite(requestedMaxEvidenceBytes)
      ? Math.min(DEFAULT_MAX_EVIDENCE_BYTES, Math.max(128, Math.floor(requestedMaxEvidenceBytes)))
      : DEFAULT_MAX_EVIDENCE_BYTES
    const requestedMaxEvidenceStoreBytes =
      options.maxEvidenceStoreBytes ?? DEFAULT_MAX_EVIDENCE_STORE_BYTES
    this.maxEvidenceStoreBytes = Number.isFinite(requestedMaxEvidenceStoreBytes)
      ? Math.max(this.maxEvidenceBytes * 2, Math.floor(requestedMaxEvidenceStoreBytes))
      : DEFAULT_MAX_EVIDENCE_STORE_BYTES
    const requestedMaxPendingEvents = options.maxPendingEvents ?? DEFAULT_MAX_PENDING_EVENTS
    this.maxPendingEvents = Number.isFinite(requestedMaxPendingEvents)
      ? Math.max(1, Math.floor(requestedMaxPendingEvents))
      : DEFAULT_MAX_PENDING_EVENTS
    const requestedMaxPendingEvidenceBytes =
      options.maxPendingEvidenceBytes ?? DEFAULT_MAX_PENDING_EVIDENCE_BYTES
    this.maxPendingEvidenceBytes = Number.isFinite(requestedMaxPendingEvidenceBytes)
      ? Math.max(this.maxEvidenceBytes, Math.floor(requestedMaxPendingEvidenceBytes))
      : DEFAULT_MAX_PENDING_EVIDENCE_BYTES
    this.processKind = normalizeToken(
      options.processKind ?? "main",
      "main",
      MAX_PROCESS_KIND_LENGTH
    )
    this.sessionId = normalizeToken(options.sessionId, "", MAX_SESSION_ID_LENGTH) || randomUUID()
    this.onWriteError =
      options.onWriteError ??
      ((error, context) => {
        const detail = serializeDiagnosticEvidence(error, 4096).serialized
        console.error(
          `[DiagnosticsGraph] Failed to persist ${context.eventCode} (${context.eventId}): ${detail}`
        )
      })
  }

  capture(input: DiagnosticGraphEventInput): DiagnosticEventRef {
    const sequence = ++this.sequence
    const eventRef: DiagnosticEventRef = Object.freeze({
      eventId: `diag:${this.sessionId}:${sequence}`,
      sequence,
      sessionId: this.sessionId
    })
    if (this.pendingEvents >= this.maxPendingEvents) {
      this.droppedEventCount += 1
      if (this.droppedEventCount === 1) {
        this.reportWriteError(new Error("Diagnostic event queue is full."), {
          eventCode: "diagnostics.events_dropped",
          eventId: eventRef.eventId
        })
      }
      return eventRef
    }

    this.issuedEvents.add(eventRef)
    this.pendingEvents += 1
    const recoveredDroppedEventCount =
      this.reportingDroppedEventCount === 0 ? this.droppedEventCount : 0
    if (recoveredDroppedEventCount > 0) {
      this.reportingDroppedEventCount = recoveredDroppedEventCount
    }
    let queuedEvidenceBytes = 0

    try {
      if (!input || typeof input !== "object" || types.isProxy(input)) {
        throw new Error("Diagnostic graph input cannot be a proxy.")
      }
      const componentInput = readOwnDataField(input, "component")
      const dimensionEntriesInput = readOwnDataField(input, "dimensionEntries")
      const legacyDimensionsInput = readOwnDataField(input, "dimensions")
      const eventCodeInput = readOwnDataField(input, "eventCode")
      const evidenceInput = readOwnDataField(input, "evidence")
      const fingerprintInput = readOwnDataField(input, "fingerprint")
      const levelInput = readOwnDataField(input, "level")
      const operationInput = readOwnDataField(input, "operation")
      const parentEventsInput = readOwnDataField(input, "parentEvents")
      const recoverableInput = readOwnDataField(input, "recoverable")
      const refsInput = readOwnDataField(input, "refs")
      const stateImpactInput = readOwnDataField(input, "stateImpact")
      const summaryInput = readOwnDataField(input, "summary")
      if (
        typeof componentInput !== "string" ||
        typeof eventCodeInput !== "string" ||
        (levelInput !== "error" && levelInput !== "info" && levelInput !== "warn") ||
        typeof operationInput !== "string" ||
        typeof recoverableInput !== "boolean" ||
        typeof stateImpactInput !== "string" ||
        typeof summaryInput !== "string" ||
        (fingerprintInput !== undefined && typeof fingerprintInput !== "string")
      ) {
        throw new Error("Diagnostic graph input has an invalid typed envelope.")
      }
      const eventCodeCandidate =
        eventCodeInput.length <= MAX_EVENT_CODE_LENGTH + 2 ? eventCodeInput.trim() : ""
      const eventCode =
        EVENT_CODE_PATTERN.test(eventCodeCandidate) &&
        sanitizeDiagnosticText(eventCodeCandidate, MAX_EVENT_CODE_LENGTH) === eventCodeCandidate
          ? eventCodeCandidate
          : "diagnostics.invalid_event_code"
      const { invalidParentCount, parentEvents } = this.normalizeParentEvents(
        parentEventsInput,
        eventRef
      )
      const dimensions = normalizeDimensions(dimensionEntriesInput, legacyDimensionsInput)
      if (invalidParentCount > 0) {
        if (Object.keys(dimensions).length >= MAX_DIMENSIONS) {
          delete dimensions[Object.keys(dimensions).at(-1) ?? ""]
        }
        dimensions["invalidParentCount"] = invalidParentCount
      }
      if (recoveredDroppedEventCount > 0) {
        this.setInternalDimension(
          dimensions,
          "droppedDiagnosticEventCount",
          recoveredDroppedEventCount
        )
      }
      const traversalBudget = createDiagnosticTraversalBudget(
        Math.min(DEFAULT_MAX_PENDING_EVIDENCE_BYTES, this.maxPendingEvidenceBytes)
      )
      let preparedEvidence = readBoundedArrayItems(evidenceInput, MAX_EVIDENCE_REFS).flatMap(
        (evidence) => {
          const prepared = this.prepareEvidence(evidence, traversalBudget)
          return prepared ? [prepared] : []
        }
      )
      const preparedEvidenceBytes = preparedEvidence.reduce(
        (total, evidence) => total + Buffer.byteLength(evidence.serialized, "utf8"),
        0
      )
      let droppedEvidenceRefs: Array<Omit<DiagnosticEvidenceRef, "capture">> = []
      if (this.pendingEvidenceBytes + preparedEvidenceBytes > this.maxPendingEvidenceBytes) {
        droppedEvidenceRefs = preparedEvidence.map((evidence) => evidence.ref)
        preparedEvidence = []
        this.setInternalDimension(dimensions, "droppedEvidenceCount", droppedEvidenceRefs.length)
      } else {
        queuedEvidenceBytes = preparedEvidenceBytes
        this.pendingEvidenceBytes += queuedEvidenceBytes
      }
      const baseEvent: Omit<DiagnosticGraphEvent, "evidenceRefs" | "parentEventIds"> = {
        component: normalizeToken(componentInput, "unknown", MAX_COMPONENT_LENGTH),
        dimensions,
        eventCode,
        eventId: eventRef.eventId,
        fingerprint: sanitizeDiagnosticText(fingerprintInput || eventCode, 160),
        level: levelInput,
        message: sanitizeDiagnosticText(summaryInput, MAX_SUMMARY_LENGTH),
        operation: normalizeToken(operationInput, "unknown", MAX_OPERATION_LENGTH),
        processKind: this.processKind,
        recordType: "diagnostic.event",
        recoverable: recoverableInput,
        redactionVersion: DIAGNOSTIC_REDACTION_VERSION,
        refs: normalizeResourceRefs(refsInput),
        schemaVersion: DIAGNOSTIC_GRAPH_SCHEMA_VERSION,
        sequence,
        sessionId: this.sessionId,
        stateImpact: normalizeToken(stateImpactInput, "unknown", MAX_STATE_IMPACT_LENGTH),
        timestamp: new Date().toISOString()
      }

      this.writeQueue = this.writeQueue
        .then(async () => {
          const evidenceRefs: DiagnosticEvidenceRef[] = droppedEvidenceRefs.map((ref) => ({
            ...ref,
            capture: "failed"
          }))
          const evidencePaths = new Set<string>()
          for (const evidence of preparedEvidence) {
            let capture: DiagnosticEvidenceRef["capture"] = "stored"
            try {
              const persisted = await this.persistEvidence(evidence, evidencePaths)
              evidencePaths.add(persisted.path)
            } catch (error) {
              capture = "failed"
              this.reportWriteError(error, { eventCode, eventId: eventRef.eventId })
            }
            evidenceRefs.push({ ...evidence.ref, capture })
          }
          const parentEventIds = parentEvents.flatMap((parent) =>
            this.durableEvents.has(parent) ? [parent.eventId] : []
          )
          const missingDurableParentCount = parentEvents.length - parentEventIds.length
          if (missingDurableParentCount > 0) {
            this.setInternalDimension(
              dimensions,
              "missingDurableParentCount",
              missingDurableParentCount
            )
          }
          const event = this.sealEvent({ ...baseEvent, evidenceRefs, parentEventIds })
          await this.logger[APPEND_DIAGNOSTIC_GRAPH_EVENT](event)
          this.durableEvents.add(eventRef)
          this.acknowledgeDroppedEvents(recoveredDroppedEventCount)
        })
        .catch((error) => {
          this.releaseDroppedEventReport(recoveredDroppedEventCount)
          this.reportWriteError(error, { eventCode, eventId: eventRef.eventId })
        })
        .finally(() => {
          this.releasePendingEvent(queuedEvidenceBytes)
        })
    } catch (error) {
      const eventCode = "diagnostics.capture_failed"
      this.reportWriteError(error, { eventCode, eventId: eventRef.eventId })
      const event = this.sealEvent({
        component: "diagnostics",
        dimensions:
          recoveredDroppedEventCount > 0
            ? { droppedDiagnosticEventCount: recoveredDroppedEventCount }
            : {},
        eventCode,
        eventId: eventRef.eventId,
        evidenceRefs: [],
        fingerprint: eventCode,
        level: "error",
        message: "Diagnostic event capture failed",
        operation: "capture",
        parentEventIds: [],
        processKind: this.processKind,
        recordType: "diagnostic.event",
        recoverable: true,
        redactionVersion: DIAGNOSTIC_REDACTION_VERSION,
        refs: [],
        schemaVersion: DIAGNOSTIC_GRAPH_SCHEMA_VERSION,
        sequence,
        sessionId: this.sessionId,
        stateImpact: "diagnostic_evidence_missing",
        timestamp: new Date().toISOString()
      })
      this.writeQueue = this.writeQueue
        .then(async () => {
          await this.logger[APPEND_DIAGNOSTIC_GRAPH_EVENT](event)
          this.durableEvents.add(eventRef)
          this.acknowledgeDroppedEvents(recoveredDroppedEventCount)
        })
        .catch((writeError) => {
          this.releaseDroppedEventReport(recoveredDroppedEventCount)
          this.reportWriteError(writeError, { eventCode, eventId: eventRef.eventId })
        })
        .finally(() => {
          this.releasePendingEvent(queuedEvidenceBytes)
        })
    }

    return eventRef
  }

  async flush(): Promise<void> {
    await this.writeQueue
    if (this.droppedEventCount > 0) {
      this.capture({
        component: "diagnostics",
        dimensionEntries: [{ key: "droppedDiagnosticEventCount", value: this.droppedEventCount }],
        eventCode: "diagnostics.events_dropped",
        level: "warn",
        operation: "flush",
        recoverable: true,
        stateImpact: "diagnostic_events_missing",
        summary: "Diagnostic events were dropped because the writer queue was full"
      })
      await this.writeQueue
    }
    await this.logger.flush()
  }

  private normalizeParentEvents(
    parents: unknown,
    current: DiagnosticEventRef
  ): { invalidParentCount: number; parentEvents: DiagnosticEventRef[] } {
    let invalidParentCount = 0
    const parentEvents: DiagnosticEventRef[] = []
    const seen = new Set<string>()
    for (const parent of readBoundedArrayItems(parents, MAX_PARENT_EVENTS * 2)) {
      const parentObject = typeof parent === "object" && parent !== null ? parent : null
      const parentEventId = parentObject ? readOwnDataField(parentObject, "eventId") : undefined
      const parentSequence = parentObject ? readOwnDataField(parentObject, "sequence") : undefined
      const parentSessionId = parentObject ? readOwnDataField(parentObject, "sessionId") : undefined
      const valid =
        parentObject !== null &&
        this.issuedEvents.has(parentObject) &&
        parentSessionId === this.sessionId &&
        typeof parentSequence === "number" &&
        parentSequence > 0 &&
        parentSequence < current.sequence &&
        parentEventId === `diag:${this.sessionId}:${parentSequence}` &&
        !seen.has(parentEventId)
      if (!valid || parentEvents.length >= MAX_PARENT_EVENTS) {
        invalidParentCount += 1
        continue
      }
      seen.add(parentEventId)
      parentEvents.push(parentObject as DiagnosticEventRef)
    }
    return { invalidParentCount, parentEvents }
  }

  private setInternalDimension(
    dimensions: Record<string, DiagnosticScalar>,
    key: string,
    value: DiagnosticScalar
  ): void {
    if (!(key in dimensions) && Object.keys(dimensions).length >= MAX_DIMENSIONS) {
      delete dimensions[Object.keys(dimensions).at(-1) ?? ""]
    }
    dimensions[key] = value
  }

  private acknowledgeDroppedEvents(count: number): void {
    if (count > 0) {
      this.droppedEventCount = Math.max(0, this.droppedEventCount - count)
      this.reportingDroppedEventCount = 0
    }
  }

  private releaseDroppedEventReport(count: number): void {
    if (count > 0 && this.reportingDroppedEventCount === count) {
      this.reportingDroppedEventCount = 0
    }
  }

  private releasePendingEvent(evidenceBytes: number): void {
    this.pendingEvents = Math.max(0, this.pendingEvents - 1)
    this.pendingEvidenceBytes = Math.max(0, this.pendingEvidenceBytes - evidenceBytes)
  }

  private sealEvent(event: DiagnosticGraphEvent): DiagnosticGraphEvent {
    Object.defineProperty(event, DIAGNOSTIC_GRAPH_EVENT_BRAND, {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false
    })
    return Object.freeze(event)
  }

  private prepareEvidence(
    input: unknown,
    traversalBudget: DiagnosticTraversalBudget
  ): PreparedEvidence | null {
    if (!input || typeof input !== "object" || types.isProxy(input)) {
      return null
    }
    const value = readOwnDataField(input, "value")
    const kindValue = readOwnDataField(input, "kind")
    const contentTypeValue = readOwnDataField(input, "contentType")
    if (typeof kindValue !== "string") {
      return null
    }
    const evidence = serializeDiagnosticEvidence(value, this.maxEvidenceBytes, traversalBudget)
    const sha256 = createHash("sha256").update(evidence.serialized).digest("hex")
    return {
      ref: {
        blobId: `sha256:${sha256}`,
        contentType:
          typeof contentTypeValue === "string"
            ? sanitizeDiagnosticText(contentTypeValue, MAX_CONTENT_TYPE_LENGTH).trim() ||
              "application/json"
            : "application/json",
        kind: normalizeToken(kindValue, "detail", MAX_EVIDENCE_KIND_LENGTH),
        originalSizeBytes: evidence.originalSizeBytes,
        redactionVersion: DIAGNOSTIC_REDACTION_VERSION,
        sha256,
        sizeBytes: evidence.sizeBytes,
        truncated: evidence.truncated
      },
      serialized: evidence.serialized
    }
  }

  private async persistEvidence(
    evidence: PreparedEvidence,
    protectedPaths: ReadonlySet<string>
  ): Promise<{ created: boolean; path: string }> {
    const logDir = this.logger.getLogDir()
    const directory = await ensurePrivateChildDirectory(
      logDir,
      "blobs",
      "sha256",
      evidence.ref.sha256.slice(0, 2)
    )
    const path = join(directory, `${evidence.ref.sha256}.json`)
    try {
      await this.validateStoredEvidence(path, evidence)
      return { created: false, path }
    } catch (error) {
      if (!isAlreadyMissingError(error)) {
        throw error
      }
    }

    await this.ensureEvidenceCapacity(evidence.ref.sizeBytes, protectedPaths)
    let handle
    try {
      handle = await openPrivateFileForExclusiveWrite(path)
      await handle.writeFile(evidence.serialized, "utf8")
      this.evidenceStoreBytes = (this.evidenceStoreBytes ?? 0) + evidence.ref.sizeBytes
      return { created: true, path }
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error
      }
      await this.validateStoredEvidence(path, evidence)
      return { created: false, path }
    } finally {
      await handle?.close()
    }
  }

  private async ensureEvidenceCapacity(
    requiredBytes: number,
    protectedPaths: ReadonlySet<string>
  ): Promise<void> {
    if (
      this.evidenceStoreBytes !== null &&
      this.evidenceStoreBytes + requiredBytes <= this.maxEvidenceStoreBytes
    ) {
      return
    }

    await this.logger.runWithWriteLock(async () => {
      const files = await this.listStoredEvidenceFiles()
      let totalBytes = files.reduce((total, file) => total + file.sizeBytes, 0)
      if (totalBytes + requiredBytes > this.maxEvidenceStoreBytes) {
        const liveBlobIds = await this.listRetainedEvidenceBlobIds()
        files.sort(
          (left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path)
        )
        for (const file of files) {
          if (totalBytes + requiredBytes <= this.maxEvidenceStoreBytes) {
            break
          }
          if (liveBlobIds.has(file.blobId) || protectedPaths.has(file.path)) {
            continue
          }
          try {
            const fileStat = await lstat(file.path)
            if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
              throw new Error("Diagnostic evidence path is unsafe.")
            }
            await unlink(file.path)
          } catch (error) {
            if (!isAlreadyMissingError(error)) {
              throw error
            }
          }
          totalBytes -= file.sizeBytes
        }
      }
      this.evidenceStoreBytes = totalBytes
      if (totalBytes + requiredBytes > this.maxEvidenceStoreBytes) {
        throw new Error(
          `Diagnostic evidence store is full (${this.maxEvidenceStoreBytes} byte limit).`
        )
      }
    })
  }

  private async listRetainedEvidenceBlobIds(): Promise<Set<string>> {
    const logDir = this.logger.getLogDir()
    await assertPrivateDirectory(logDir)
    let entries
    try {
      entries = await readdir(logDir, { withFileTypes: true })
    } catch (error) {
      if (isAlreadyMissingError(error)) {
        return new Set()
      }
      throw error
    }

    const liveBlobIds = new Set<string>()
    let scannedBytes = 0
    for (const entry of entries) {
      if (!entry.isFile() || !/^jingle\.log(?:\.\d+)?$/.test(entry.name)) {
        continue
      }
      let text
      let handle
      try {
        handle = await openPrivateFileForRead(join(logDir, entry.name))
        const stat = await handle.stat()
        if (scannedBytes + stat.size > MAX_RETAINED_JOURNAL_SCAN_BYTES) {
          throw new Error("Retained diagnostics journal scan exceeded its byte limit.")
        }
        text = await handle.readFile("utf8")
        scannedBytes += Buffer.byteLength(text, "utf8")
      } catch (error) {
        if (isAlreadyMissingError(error)) {
          continue
        }
        throw error
      } finally {
        await handle?.close()
      }
      for (const line of text.split("\n")) {
        if (!line.trim()) {
          continue
        }
        try {
          const record = JSON.parse(line) as {
            evidenceRefs?: Array<{ blobId?: unknown; capture?: unknown }>
            recordType?: unknown
          }
          if (record.recordType !== "diagnostic.event" || !Array.isArray(record.evidenceRefs)) {
            continue
          }
          for (const ref of record.evidenceRefs) {
            if (ref.capture === "stored" && typeof ref.blobId === "string") {
              liveBlobIds.add(ref.blobId)
            }
          }
        } catch {
          continue
        }
      }
    }
    return liveBlobIds
  }

  private async validateStoredEvidence(path: string, evidence: PreparedEvidence): Promise<void> {
    const handle = await openPrivateFileForRead(path)
    try {
      const fileStat = await handle.stat()
      if (!fileStat.isFile() || fileStat.size !== evidence.ref.sizeBytes) {
        throw new Error(`Diagnostic evidence CAS collision for ${evidence.ref.blobId}.`)
      }
      const stored = await handle.readFile()
      const storedSha256 = createHash("sha256").update(stored).digest("hex")
      if (storedSha256 !== evidence.ref.sha256) {
        throw new Error(`Diagnostic evidence hash mismatch for ${evidence.ref.blobId}.`)
      }
    } finally {
      await handle.close()
    }
  }

  private async listStoredEvidenceFiles(): Promise<StoredEvidenceFile[]> {
    const root = await ensurePrivateChildDirectory(this.logger.getLogDir(), "blobs", "sha256")
    let prefixes
    try {
      prefixes = await readdir(root, { withFileTypes: true })
    } catch (error) {
      if (isAlreadyMissingError(error)) {
        return []
      }
      throw error
    }

    const files: StoredEvidenceFile[] = []
    for (const prefix of prefixes) {
      if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/.test(prefix.name)) {
        continue
      }
      const directory = join(root, prefix.name)
      await assertPrivateDirectory(directory)
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) {
          continue
        }
        const path = join(directory, entry.name)
        try {
          const fileStat = await lstat(path)
          if (fileStat.isFile() && !fileStat.isSymbolicLink()) {
            files.push({
              blobId: `sha256:${entry.name.slice(0, -5)}`,
              mtimeMs: fileStat.mtimeMs,
              path,
              sizeBytes: fileStat.size
            })
          }
        } catch (error) {
          if (!isAlreadyMissingError(error)) {
            throw error
          }
        }
      }
    }
    return files
  }

  private reportWriteError(error: unknown, context: { eventCode: string; eventId: string }): void {
    try {
      this.onWriteError(error, context)
    } catch (reportError) {
      const detail = serializeDiagnosticEvidence(reportError, 4096).serialized
      console.error(`[DiagnosticsGraph] Failed to report a diagnostics write error: ${detail}`)
    }
  }
}

function isAlreadyMissingError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  )
}
