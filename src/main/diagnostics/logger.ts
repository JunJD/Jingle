import { readdirSync, renameSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { types } from "node:util"
import {
  assertPrivateRegularFileSync,
  ensurePrivateDescendantDirectorySync,
  ensurePrivateDirectorySync,
  openPrivateFileForAppend
} from "./private-files"
import {
  createDiagnosticTraversalBudget,
  sanitizeDiagnosticText,
  sanitizeDiagnosticValue,
  serializeDiagnosticEvidence
} from "./redaction"
import type { DiagnosticGraphEvent } from "./schema"

export type DiagnosticsLevel = "info" | "warn" | "error"

export interface DiagnosticsLoggerOptions {
  logDir: string
  maxBytes?: number
  maxFiles?: number
  maxPendingBytes?: number
  maxPendingRecords?: number
  maxRecordBytes?: number
  rootDir: string
}

export type DiagnosticsLogFields = object

export const APPEND_DIAGNOSTIC_GRAPH_EVENT = Symbol("jingle.diagnostics.append-graph-event")
export const DIAGNOSTIC_GRAPH_EVENT_BRAND = Symbol("jingle.diagnostics.graph-event")

const DEFAULT_MAX_BYTES = 1024 * 1024
const DEFAULT_MAX_FILES = 5
const DEFAULT_MAX_PENDING_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_PENDING_RECORDS = 256
const DEFAULT_MAX_RECORD_BYTES = 256 * 1024
const LOG_FILE_NAME = "jingle.log"
const MAX_DETAIL_MESSAGE_LENGTH = 4_000
const MAX_LOG_MESSAGE_LENGTH = 1024
const LEGACY_LOG_FIELD_KEYS = [
  "address",
  "code",
  "errno",
  "error",
  "errorCode",
  "errorDescription",
  "eventCode",
  "exitCode",
  "fingerprint",
  "kind",
  "line",
  "name",
  "origin",
  "payload",
  "port",
  "preloadPath",
  "reason",
  "recoverable",
  "serviceName",
  "source",
  "sourceId",
  "stack",
  "stateImpact",
  "syscall",
  "type",
  "url",
  "validatedURL",
  "webContentsId",
  "windowId",
  "windowKind"
] as const
const LEGACY_STRING_FIELD_SPECS = [
  ["appVersion", 128],
  ["commandId", 256],
  ["electronVersion", 128],
  ["platform", 128],
  ["requestId", 256],
  ["threadId", 256]
] as const
const ERROR_FIELD_KEYS = [
  "address",
  "code",
  "errno",
  "message",
  "name",
  "path",
  "port",
  "stack",
  "syscall"
] as const

interface PendingDiagnosticLine {
  readonly bytes: number
  readonly coalesceKey: string | null
  readonly fatal: boolean
  readonly level: DiagnosticsLevel
  readonly line: string
}

interface DiagnosticQueuePressure {
  coalescedRecords: number
  droppedBytes: number
  droppedErrorRecords: number
  droppedInfoRecords: number
  droppedRecords: number
  droppedWarnRecords: number
}

interface DiagnosticWriteBatch {
  completion: Promise<void>
  fatal: PendingDiagnosticLine[]
  fatalCompletion: Promise<void> | null
  fatalWriteError: unknown | null
  fingerprints: Map<string, PendingDiagnosticLine>
  leading: PendingDiagnosticLine | null
  normal: PendingDiagnosticLine[]
  pendingBytes: number
  pendingRecords: number
  pressure: DiagnosticQueuePressure
  rejectFatal: ((reason?: unknown) => void) | null
  resolveFatal: (() => void) | null
  sealed: boolean
  writeError: unknown | null
}

function addBoundedCount(current: number, increment: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, current + Math.max(0, increment))
}

function readOwnDataField(fields: object | undefined, key: PropertyKey): unknown {
  if (!fields) {
    return undefined
  }
  if (types.isProxy(fields)) {
    return undefined
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(fields, key)
    return descriptor && "value" in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function sanitizeKnownLogFields(
  fields: object | undefined,
  maxBytes: number
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  const budget = createDiagnosticTraversalBudget(maxBytes)
  for (const key of LEGACY_LOG_FIELD_KEYS) {
    const value = readOwnDataField(fields, key)
    if (value === undefined) {
      continue
    }
    if (key === "error" && value && typeof value === "object" && !types.isProxy(value)) {
      const error: Record<string, unknown> = {}
      for (const errorKey of ERROR_FIELD_KEYS) {
        const errorValue = readOwnDataField(value, errorKey)
        if (errorValue !== undefined) {
          error[errorKey] = sanitizeDiagnosticValue(errorValue, maxBytes, budget)
        }
      }
      sanitized[key] = error
    } else {
      sanitized[key] = sanitizeDiagnosticValue(value, maxBytes, budget)
    }
  }
  const detailMessage = sanitizeTypedStringField(
    readOwnDataField(fields, "message"),
    "detailMessage",
    MAX_DETAIL_MESSAGE_LENGTH,
    maxBytes,
    budget
  )
  if (detailMessage !== undefined) {
    sanitized["detailMessage"] = detailMessage
  }
  for (const [key, maxLength] of LEGACY_STRING_FIELD_SPECS) {
    const value = sanitizeTypedStringField(
      readOwnDataField(fields, key),
      key,
      maxLength,
      maxBytes,
      budget
    )
    if (value !== undefined) {
      sanitized[key] = value
    }
  }
  const presentationId = sanitizeDiagnosticValue(
    readOwnDataField(fields, "presentationId"),
    maxBytes,
    budget
  )
  if (
    typeof presentationId === "number" &&
    Number.isSafeInteger(presentationId) &&
    presentationId >= 0
  ) {
    sanitized["presentationId"] = presentationId
  }
  const isPackaged = sanitizeDiagnosticValue(
    readOwnDataField(fields, "isPackaged"),
    maxBytes,
    budget
  )
  if (typeof isPackaged === "boolean") {
    sanitized["isPackaged"] = isPackaged
  }
  return sanitized
}

function sanitizeTypedStringField(
  value: unknown,
  key: string,
  maxLength: number,
  maxBytes: number,
  budget: ReturnType<typeof createDiagnosticTraversalBudget>
): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const sanitized = sanitizeDiagnosticValue(value, maxBytes, budget)
  return typeof sanitized === "string"
    ? sanitizeDiagnosticText(sanitized, maxLength, key)
    : undefined
}

function preserveEnvelopeFields(fields: object | undefined): Record<string, unknown> {
  const preserved: Record<string, unknown> = {}
  for (const [key, maxLength] of [
    ["eventCode", 160],
    ["fingerprint", 160],
    ["recordType", 64],
    ["stateImpact", 96]
  ] as const) {
    const value = readOwnDataField(fields, key)
    if (typeof value === "string") {
      preserved[key] = sanitizeDiagnosticText(value, maxLength, key)
    }
  }
  const recoverable = readOwnDataField(fields, "recoverable")
  if (typeof recoverable === "boolean") {
    preserved["recoverable"] = recoverable
  }
  return preserved
}

export class DiagnosticsLogger {
  private readonly logFilePath: string
  private readonly maxBytes: number
  private readonly maxFiles: number
  private readonly maxPendingBytes: number
  private readonly maxPendingRecords: number
  private readonly maxRecordBytes: number
  private readonly rootDir: string
  private readonly logDir: string
  private activeBatch: DiagnosticWriteBatch | null = null
  private lastWriteError: unknown = null
  private openBatch: DiagnosticWriteBatch | null = null
  private readonly pendingBatches = new Set<DiagnosticWriteBatch>()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(options: DiagnosticsLoggerOptions) {
    this.rootDir = ensurePrivateDirectorySync(options.rootDir)
    this.logDir = ensurePrivateDescendantDirectorySync(options.rootDir, options.logDir)
    this.logFilePath = join(this.logDir, LOG_FILE_NAME)
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
    const requestedMaxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES
    this.maxRecordBytes = Number.isFinite(requestedMaxRecordBytes)
      ? Math.min(DEFAULT_MAX_RECORD_BYTES, Math.max(1024, Math.floor(requestedMaxRecordBytes)))
      : DEFAULT_MAX_RECORD_BYTES
    const requestedMaxPendingRecords = options.maxPendingRecords ?? DEFAULT_MAX_PENDING_RECORDS
    this.maxPendingRecords = Number.isFinite(requestedMaxPendingRecords)
      ? Math.min(DEFAULT_MAX_PENDING_RECORDS, Math.max(2, Math.floor(requestedMaxPendingRecords)))
      : DEFAULT_MAX_PENDING_RECORDS
    const requestedMaxPendingBytes = options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES
    this.maxPendingBytes = Number.isFinite(requestedMaxPendingBytes)
      ? Math.min(
          DEFAULT_MAX_PENDING_BYTES,
          Math.max(this.maxRecordBytes * 2, Math.floor(requestedMaxPendingBytes))
        )
      : DEFAULT_MAX_PENDING_BYTES
  }

  getLogFilePath(): string {
    return this.logFilePath
  }

  getLogDir(): string {
    return this.logDir
  }

  info(message: string, fields?: DiagnosticsLogFields): void {
    this.write("info", message, fields)
  }

  warn(message: string, fields?: DiagnosticsLogFields): void {
    this.write("warn", message, fields)
  }

  error(message: string, fields?: DiagnosticsLogFields): void {
    this.write("error", message, fields)
  }

  errorAndFlush(message: string, fields?: DiagnosticsLogFields): Promise<void> {
    return this.enqueueRecord(this.createRecord("error", message, fields), false, true)
  }

  [APPEND_DIAGNOSTIC_GRAPH_EVENT](record: DiagnosticGraphEvent): Promise<void> {
    if (
      types.isProxy(record) ||
      !Object.isFrozen(record) ||
      readOwnDataField(record, DIAGNOSTIC_GRAPH_EVENT_BRAND) !== true ||
      readOwnDataField(record, "recordType") !== "diagnostic.event" ||
      readOwnDataField(record, "schemaVersion") !== 1 ||
      readOwnDataField(record, "redactionVersion") !== 2
    ) {
      return Promise.reject(new Error("Diagnostics logger rejected an untrusted graph event."))
    }
    return this.enqueueRecord(record, true, false)
  }

  async flush(): Promise<void> {
    await this.writeQueue
    if (this.lastWriteError) {
      const error = this.lastWriteError
      this.lastWriteError = null
      throw error
    }
  }

  runWithWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    this.sealOpenBatch()
    const queued = this.writeQueue.then(operation)
    this.writeQueue = queued.then(
      () => undefined,
      () => undefined
    )
    return queued
  }

  private write(level: DiagnosticsLevel, message: string, fields?: DiagnosticsLogFields): void {
    const record = this.createRecord(level, message, fields)
    void this.enqueueRecord(record, false, false)
  }

  private enqueueRecord(record: object, rejectOversize: boolean, fatal: boolean): Promise<void> {
    let pending: PendingDiagnosticLine
    try {
      const line = this.serializeRecord(record, rejectOversize)
      pending = {
        bytes: Buffer.byteLength(line, "utf8"),
        coalesceKey: fatal ? null : this.readCoalesceKey(record),
        fatal,
        level: this.readRecordLevel(record),
        line
      }
    } catch (error) {
      this.recordWriteFailure(error)
      return Promise.reject(error)
    }

    let batch = fatal && this.activeBatch ? this.activeBatch : this.openBatch
    if (!batch && !fatal && !this.hasGlobalPendingCapacity(pending)) {
      const pressureOwner = this.findQueuePressureOwner()
      if (pressureOwner) {
        this.recordQueueDrop(pressureOwner, pending)
        return pressureOwner.completion
      }
    }
    batch ??= this.getOrCreateOpenBatch()
    if (fatal) {
      this.ensureFatalCompletion(batch)
    }
    this.addPendingLine(batch, pending)
    return fatal ? (batch.fatalCompletion as Promise<void>) : batch.completion
  }

  private getOrCreateOpenBatch(): DiagnosticWriteBatch {
    if (this.openBatch && !this.openBatch.sealed) {
      return this.openBatch
    }

    const batch: DiagnosticWriteBatch = {
      completion: Promise.resolve(),
      fatal: [],
      fatalCompletion: null,
      fatalWriteError: null,
      fingerprints: new Map(),
      leading: null,
      normal: [],
      pendingBytes: 0,
      pendingRecords: 0,
      pressure: this.createQueuePressure(),
      rejectFatal: null,
      resolveFatal: null,
      sealed: false,
      writeError: null
    }
    const write = this.writeQueue.then(() => this.drainBatch(batch))
    batch.completion = write
    this.writeQueue = write.catch((error) => {
      this.recordWriteFailure(error)
    })
    this.pendingBatches.add(batch)
    this.openBatch = batch
    return batch
  }

  private addPendingLine(batch: DiagnosticWriteBatch, pending: PendingDiagnosticLine): void {
    const duplicate = pending.coalesceKey ? batch.fingerprints.get(pending.coalesceKey) : undefined
    if (duplicate) {
      batch.pressure.coalescedRecords = addBoundedCount(batch.pressure.coalescedRecords, 1)
      return
    }

    if (pending.fatal) {
      while (!this.hasPendingCapacity(batch, pending)) {
        const evicted = this.evictPendingForFatal(batch)
        if (!evicted) {
          const error = new Error(
            "Diagnostics fatal record could not be admitted to the write queue."
          )
          this.recordQueueDrop(batch, pending)
          batch.fatalWriteError ??= error
          batch.writeError ??= error
          return
        }
        this.recordQueueDrop(batch, evicted)
      }
      this.trackPendingLine(batch, pending)
      if (batch !== this.activeBatch && !batch.leading) {
        batch.leading = pending
      } else {
        batch.fatal.push(pending)
      }
      return
    }

    if (!batch.leading) {
      if (!this.hasPendingCapacity(batch, pending)) {
        this.recordQueueDrop(batch, pending)
        return
      }
      this.trackPendingLine(batch, pending)
      batch.leading = pending
      return
    }

    if (!this.hasPendingCapacity(batch, pending)) {
      this.recordQueueDrop(batch, pending)
      return
    }
    this.trackPendingLine(batch, pending)
    batch.normal.push(pending)
  }

  private evictPendingForFatal(batch: DiagnosticWriteBatch): PendingDiagnosticLine | null {
    const current = batch.normal.pop() ?? batch.fatal.shift()
    if (current) {
      this.untrackPendingLine(batch, current)
      this.markEvictedFatalFailure(batch, current)
      return current
    }
    const queuedBatches = [...this.pendingBatches]
    for (let index = queuedBatches.length - 1; index >= 0; index -= 1) {
      const queued = queuedBatches[index]
      if (queued === batch) {
        continue
      }
      const pending = queued.normal.pop() ?? queued.leading
      if (!pending) {
        continue
      }
      if (pending === queued.leading) {
        queued.leading = null
      }
      this.untrackPendingLine(queued, pending)
      this.markEvictedFatalFailure(queued, pending)
      this.absorbEmptyPendingBatch(batch, queued)
      return pending
    }
    return null
  }

  private markEvictedFatalFailure(
    owner: DiagnosticWriteBatch,
    pending: PendingDiagnosticLine
  ): void {
    if (!pending.fatal) {
      return
    }
    const error = new Error("Diagnostics fatal record was evicted before persistence.")
    owner.fatalWriteError ??= error
    owner.writeError ??= error
  }

  private hasPendingCapacity(batch: DiagnosticWriteBatch, pending: PendingDiagnosticLine): boolean {
    let pendingBytes = batch.pendingBytes
    let pendingRecords = batch.pendingRecords
    for (const other of [this.activeBatch, ...this.pendingBatches]) {
      if (other && other !== batch) {
        pendingBytes += other.pendingBytes
        pendingRecords += other.pendingRecords
      }
    }
    return (
      pendingRecords < this.maxPendingRecords &&
      pendingBytes + pending.bytes <= this.maxPendingBytes
    )
  }

  private hasGlobalPendingCapacity(pending: PendingDiagnosticLine): boolean {
    let pendingBytes = 0
    let pendingRecords = 0
    for (const batch of [this.activeBatch, ...this.pendingBatches]) {
      if (batch) {
        pendingBytes += batch.pendingBytes
        pendingRecords += batch.pendingRecords
      }
    }
    return (
      pendingRecords < this.maxPendingRecords &&
      pendingBytes + pending.bytes <= this.maxPendingBytes
    )
  }

  private findQueuePressureOwner(): DiagnosticWriteBatch | null {
    if (this.activeBatch) {
      return this.activeBatch
    }
    return [...this.pendingBatches].at(-1) ?? null
  }

  private absorbEmptyPendingBatch(
    target: DiagnosticWriteBatch,
    emptied: DiagnosticWriteBatch
  ): void {
    if (emptied.pendingRecords > 0) {
      return
    }
    this.mergeQueuePressure(target.pressure, emptied.pressure)
    emptied.pressure = this.createQueuePressure()
    if (emptied !== this.openBatch) {
      this.pendingBatches.delete(emptied)
    }
  }

  private mergeQueuePressure(
    target: DiagnosticQueuePressure,
    source: DiagnosticQueuePressure
  ): void {
    target.coalescedRecords = addBoundedCount(target.coalescedRecords, source.coalescedRecords)
    target.droppedBytes = addBoundedCount(target.droppedBytes, source.droppedBytes)
    target.droppedErrorRecords = addBoundedCount(
      target.droppedErrorRecords,
      source.droppedErrorRecords
    )
    target.droppedInfoRecords = addBoundedCount(
      target.droppedInfoRecords,
      source.droppedInfoRecords
    )
    target.droppedRecords = addBoundedCount(target.droppedRecords, source.droppedRecords)
    target.droppedWarnRecords = addBoundedCount(
      target.droppedWarnRecords,
      source.droppedWarnRecords
    )
  }

  private trackPendingLine(batch: DiagnosticWriteBatch, pending: PendingDiagnosticLine): void {
    batch.pendingBytes += pending.bytes
    batch.pendingRecords += 1
    if (pending.coalesceKey) {
      batch.fingerprints.set(pending.coalesceKey, pending)
    }
  }

  private untrackPendingLine(batch: DiagnosticWriteBatch, pending: PendingDiagnosticLine): void {
    batch.pendingBytes -= pending.bytes
    batch.pendingRecords -= 1
    if (pending.coalesceKey && batch.fingerprints.get(pending.coalesceKey) === pending) {
      batch.fingerprints.delete(pending.coalesceKey)
    }
  }

  private recordQueueDrop(batch: DiagnosticWriteBatch, pending: PendingDiagnosticLine): void {
    batch.pressure.droppedBytes = addBoundedCount(batch.pressure.droppedBytes, pending.bytes)
    batch.pressure.droppedRecords = addBoundedCount(batch.pressure.droppedRecords, 1)
    if (pending.level === "error") {
      batch.pressure.droppedErrorRecords = addBoundedCount(batch.pressure.droppedErrorRecords, 1)
    } else if (pending.level === "warn") {
      batch.pressure.droppedWarnRecords = addBoundedCount(batch.pressure.droppedWarnRecords, 1)
    } else {
      batch.pressure.droppedInfoRecords = addBoundedCount(batch.pressure.droppedInfoRecords, 1)
    }
  }

  private async drainBatch(batch: DiagnosticWriteBatch): Promise<void> {
    batch.sealed = true
    if (this.openBatch === batch) {
      this.openBatch = null
    }
    this.pendingBatches.delete(batch)
    this.activeBatch = batch
    try {
      if (batch.leading) {
        await this.tryAppendPendingLine(batch, batch.leading)
        batch.leading = null
      }

      while (true) {
        if (batch.fatalCompletion) {
          await this.drainFatalWave(batch)
          continue
        }
        const pending = batch.normal.shift()
        if (pending) {
          await this.tryAppendPendingLine(batch, pending)
          continue
        }
        if (this.hasQueuePressure(batch.pressure)) {
          await this.tryAppendQueuePressure(batch, this.takeQueuePressure(batch))
          continue
        }
        break
      }
      if (batch.writeError) {
        throw batch.writeError
      }
    } catch (error) {
      this.rejectPendingFatal(batch, error)
      throw error
    } finally {
      if (this.activeBatch === batch) {
        this.activeBatch = null
      }
    }
  }

  private async drainFatalWave(batch: DiagnosticWriteBatch): Promise<void> {
    while (batch.fatalCompletion) {
      while (batch.fatal.length > 0) {
        const pending = batch.fatal.shift() as PendingDiagnosticLine
        await this.tryAppendPendingLine(batch, pending)
      }
      if (this.hasQueuePressure(batch.pressure)) {
        await this.tryAppendQueuePressure(batch, this.takeQueuePressure(batch))
      }
      if (batch.fatal.length > 0) {
        continue
      }
      const resolve = batch.resolveFatal
      const reject = batch.rejectFatal
      const fatalWriteError = batch.fatalWriteError
      batch.fatalCompletion = null
      batch.fatalWriteError = null
      batch.rejectFatal = null
      batch.resolveFatal = null
      if (fatalWriteError) {
        reject?.(fatalWriteError)
      } else {
        resolve?.()
      }
    }
  }

  private ensureFatalCompletion(batch: DiagnosticWriteBatch): void {
    if (batch.fatalCompletion) {
      return
    }
    batch.fatalWriteError = null
    batch.fatalCompletion = new Promise<void>((resolve, reject) => {
      batch.resolveFatal = resolve
      batch.rejectFatal = reject
    })
  }

  private createQueuePressure(): DiagnosticQueuePressure {
    return {
      coalescedRecords: 0,
      droppedBytes: 0,
      droppedErrorRecords: 0,
      droppedInfoRecords: 0,
      droppedRecords: 0,
      droppedWarnRecords: 0
    }
  }

  private hasQueuePressure(pressure: DiagnosticQueuePressure): boolean {
    return pressure.coalescedRecords > 0 || pressure.droppedRecords > 0
  }

  private takeQueuePressure(batch: DiagnosticWriteBatch): DiagnosticQueuePressure {
    const pressure = batch.pressure
    batch.pressure = this.createQueuePressure()
    return pressure
  }

  private async appendQueuePressure(pressure: DiagnosticQueuePressure): Promise<void> {
    const line = this.serializeQueuePressure(pressure)
    await this.appendSerializedLine(line, Buffer.byteLength(line, "utf8"))
  }

  private async tryAppendPendingLine(
    batch: DiagnosticWriteBatch,
    pending: PendingDiagnosticLine
  ): Promise<void> {
    try {
      await this.appendSerializedLine(pending.line, pending.bytes)
    } catch (error) {
      batch.writeError ??= error
      if (pending.fatal) {
        batch.fatalWriteError ??= error
      }
    } finally {
      this.untrackPendingLine(batch, pending)
    }
  }

  private async tryAppendQueuePressure(
    batch: DiagnosticWriteBatch,
    pressure: DiagnosticQueuePressure
  ): Promise<void> {
    try {
      await this.appendQueuePressure(pressure)
    } catch (error) {
      batch.writeError ??= error
    }
  }

  private rejectPendingFatal(batch: DiagnosticWriteBatch, error: unknown): void {
    const reject = batch.rejectFatal
    batch.fatalCompletion = null
    batch.fatalWriteError = null
    batch.rejectFatal = null
    batch.resolveFatal = null
    reject?.(error)
  }

  private async appendSerializedLine(line: string, bytes: number): Promise<void> {
    this.rotateIfNeeded(bytes)
    const handle = await openPrivateFileForAppend(this.logFilePath)
    try {
      await handle.appendFile(line, "utf8")
    } finally {
      await handle.close()
    }
  }

  private serializeQueuePressure(pressure: DiagnosticQueuePressure): string {
    return `${JSON.stringify({
      ...pressure,
      eventCode: "diagnostics.queue_pressure",
      level: pressure.droppedErrorRecords > 0 ? "error" : "warn",
      message: "Diagnostics records were coalesced or dropped to keep the write queue bounded",
      recordType: "diagnostic.queue-pressure",
      recoverable: true,
      stateImpact: "diagnostic_detail_omitted",
      timestamp: new Date().toISOString()
    })}\n`
  }

  private readCoalesceKey(record: object): string | null {
    const fingerprint = readOwnDataField(record, "fingerprint")
    if (typeof fingerprint !== "string" || fingerprint.length === 0) {
      return null
    }
    const eventCode = readOwnDataField(record, "eventCode")
    const recordType = readOwnDataField(record, "recordType")
    return [
      fingerprint,
      typeof eventCode === "string" ? eventCode : "",
      this.readRecordLevel(record),
      typeof recordType === "string" ? recordType : ""
    ].join("\u0000")
  }

  private readRecordLevel(record: object): DiagnosticsLevel {
    const level = readOwnDataField(record, "level")
    return level === "error" || level === "warn" ? level : "info"
  }

  private sealOpenBatch(): void {
    if (this.openBatch) {
      this.openBatch.sealed = true
      this.openBatch = null
    }
  }

  private recordWriteFailure(error: unknown): void {
    this.lastWriteError = error
    const detail = serializeDiagnosticEvidence(error, 4096).serialized
    console.error(`[Diagnostics] Failed to write log: ${detail}`)
  }

  private createRecord(
    level: DiagnosticsLevel,
    message: string,
    fields?: DiagnosticsLogFields
  ): Record<string, unknown> {
    const safeFields = sanitizeKnownLogFields(fields, this.maxRecordBytes * 2)
    return {
      ...safeFields,
      ...preserveEnvelopeFields(fields),
      level,
      message: sanitizeDiagnosticText(message, MAX_LOG_MESSAGE_LENGTH),
      timestamp: new Date().toISOString()
    }
  }

  private serializeRecord(record: object, rejectOversize: boolean): string {
    const line = `${JSON.stringify(record)}\n`
    const sizeBytes = Buffer.byteLength(line, "utf8")
    if (sizeBytes <= this.maxRecordBytes) {
      return line
    }
    if (rejectOversize) {
      throw new Error(`Diagnostic record exceeds ${this.maxRecordBytes} bytes.`)
    }
    const source = record as Record<string, unknown>
    const level: DiagnosticsLevel =
      source["level"] === "error" || source["level"] === "warn" ? source["level"] : "info"
    return `${JSON.stringify({
      eventCode:
        typeof source["eventCode"] === "string"
          ? sanitizeDiagnosticText(source["eventCode"], 160)
          : undefined,
      fingerprint:
        typeof source["fingerprint"] === "string"
          ? sanitizeDiagnosticText(source["fingerprint"], 160)
          : undefined,
      level,
      message: "Diagnostic record omitted because it exceeded the local size limit",
      originalSizeBytes: sizeBytes,
      recordType: "diagnostic.oversize",
      recoverable: typeof source["recoverable"] === "boolean" ? source["recoverable"] : undefined,
      sourceMessage:
        typeof source["message"] === "string"
          ? sanitizeDiagnosticText(source["message"], 240)
          : undefined,
      sourceRecordType:
        typeof source["recordType"] === "string"
          ? sanitizeDiagnosticText(source["recordType"], 64)
          : undefined,
      stateImpact:
        typeof source["stateImpact"] === "string"
          ? sanitizeDiagnosticText(source["stateImpact"], 96)
          : level === "error"
            ? "diagnostic_detail_omitted"
            : "none",
      timestamp: new Date().toISOString()
    })}\n`
  }

  private rotateIfNeeded(incomingBytes: number): void {
    ensurePrivateDescendantDirectorySync(this.rootDir, this.logDir)
    const current = assertPrivateRegularFileSync(this.logFilePath)
    if (!current) {
      return
    }

    const currentBytes = current.size
    if (currentBytes + incomingBytes <= this.maxBytes) {
      return
    }

    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const sourcePath = `${this.logFilePath}.${index}`
      const targetPath = `${this.logFilePath}.${index + 1}`
      this.replacePrivateLogFile(sourcePath, targetPath)
    }

    this.replacePrivateLogFile(this.logFilePath, `${this.logFilePath}.1`)
    this.pruneRotatedLogs()
  }

  private replacePrivateLogFile(sourcePath: string, targetPath: string): boolean {
    if (!assertPrivateRegularFileSync(sourcePath)) {
      return false
    }
    if (assertPrivateRegularFileSync(targetPath)) {
      // unlink removes the directory entry itself and never follows a replaced symlink target.
      unlinkSync(targetPath)
    }
    renameSync(sourcePath, targetPath)
    if (!assertPrivateRegularFileSync(targetPath)) {
      throw new Error("Rotated diagnostics file disappeared after replacement.")
    }
    return true
  }

  private pruneRotatedLogs(): void {
    const logDir = this.getLogDir()
    const rotatedFiles: Array<{ index: number; name: string }> = []
    for (const name of readdirSync(logDir)) {
      const match = /^jingle\.log\.(\d+)$/.exec(name)
      if (!match) {
        continue
      }

      const index = Number.parseInt(match[1], 10)
      if (Number.isInteger(index)) {
        rotatedFiles.push({ name, index })
      }
    }
    rotatedFiles.sort((a, b) => b.index - a.index)

    for (const file of rotatedFiles) {
      if (file.index <= this.maxFiles) {
        continue
      }
      const path = join(logDir, file.name)
      assertPrivateRegularFileSync(path)
      unlinkSync(path)
    }
  }
}
