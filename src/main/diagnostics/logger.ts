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
  maxRecordBytes?: number
  rootDir: string
}

export type DiagnosticsLogFields = object

export const APPEND_DIAGNOSTIC_GRAPH_EVENT = Symbol("jingle.diagnostics.append-graph-event")
export const DIAGNOSTIC_GRAPH_EVENT_BRAND = Symbol("jingle.diagnostics.graph-event")

const DEFAULT_MAX_BYTES = 1024 * 1024
const DEFAULT_MAX_FILES = 5
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
  private readonly maxRecordBytes: number
  private readonly rootDir: string
  private readonly logDir: string
  private lastWriteError: unknown = null
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
    return this.enqueueRecord(this.createRecord("error", message, fields), false)
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
    return this.enqueueRecord(record, true)
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
    const queued = this.writeQueue.then(operation)
    this.writeQueue = queued.then(
      () => undefined,
      () => undefined
    )
    return queued
  }

  private write(level: DiagnosticsLevel, message: string, fields?: DiagnosticsLogFields): void {
    const record = this.createRecord(level, message, fields)
    void this.enqueueRecord(record, false)
  }

  private enqueueRecord(record: object, rejectOversize: boolean): Promise<void> {
    const write = this.writeQueue.then(async () => {
      const line = this.serializeRecord(record, rejectOversize)
      this.rotateIfNeeded(Buffer.byteLength(line, "utf8"))
      const handle = await openPrivateFileForAppend(this.logFilePath)
      try {
        await handle.appendFile(line, "utf8")
      } finally {
        await handle.close()
      }
    })
    this.writeQueue = write.catch((error) => {
      this.lastWriteError = error
      const detail = serializeDiagnosticEvidence(error, 4096).serialized
      console.error(`[Diagnostics] Failed to write log: ${detail}`)
    })
    return write
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
