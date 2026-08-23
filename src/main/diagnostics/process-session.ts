import { randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  type Stats,
  unlinkSync,
  writeFileSync
} from "node:fs"
import { basename, dirname, join } from "node:path"
import { types } from "node:util"
import {
  assertPrivateRegularFileSync,
  enforcePrivateFileModeSync,
  ensurePrivateDirectorySync
} from "./private-files"
import type { DiagnosticEventRef, DiagnosticGraphSink, DiagnosticResourceRef } from "./schema"

const PROCESS_SESSION_SCHEMA_VERSION = 1
const PROCESS_SESSION_FILE_NAME = "process-session.json"
const PROCESS_SESSION_MAX_BYTES = 2_048
const PRIVATE_FILE_MODE = 0o600
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export type ProcessSessionFatalOrigin = "uncaughtException" | "unhandledRejection" | "unknown"
export type PreviousProcessSessionOutcome =
  | "abrupt_exit_unclassified"
  | "clean_exit"
  | "js_fatal"
  | "none"
  | "shutdown_failed"
  | "state_unavailable"

interface ActiveProcessSessionMarker {
  schemaVersion: 1
  sessionId: string
  startedAt: string
  terminal: null
}

interface CleanProcessSessionMarker extends Omit<ActiveProcessSessionMarker, "terminal"> {
  terminal: {
    kind: "clean_exit"
    recordedAt: string
  }
}

interface FatalProcessSessionMarker extends Omit<ActiveProcessSessionMarker, "terminal"> {
  terminal: {
    kind: "js_fatal"
    origin: ProcessSessionFatalOrigin
    recordedAt: string
  }
}

interface ShutdownFailedProcessSessionMarker extends Omit<ActiveProcessSessionMarker, "terminal"> {
  terminal: {
    kind: "shutdown_failed"
    recordedAt: string
  }
}

type ProcessSessionMarker =
  | ActiveProcessSessionMarker
  | CleanProcessSessionMarker
  | FatalProcessSessionMarker
  | ShutdownFailedProcessSessionMarker

interface ProcessSessionRuntimeContext {
  appVersion: string
  electronVersion: string
  isPackaged: boolean
  platform: NodeJS.Platform
}

export interface ProcessSessionStartResult {
  currentSessionId: string | null
  eventRef: DiagnosticEventRef
  previousOutcome: PreviousProcessSessionOutcome
}

interface ProcessSessionOptions {
  idFactory?: () => string
  logDir: string
  now?: () => Date
  sink: DiagnosticGraphSink
}

interface MarkCleanExitOptions {
  captureEvent?: boolean
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) {
    return false
  }
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value)
}

function isFatalOrigin(value: unknown): value is ProcessSessionFatalOrigin {
  return value === "uncaughtException" || value === "unhandledRejection" || value === "unknown"
}

function parseProcessSessionMarker(value: unknown): ProcessSessionMarker {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "sessionId", "startedAt", "terminal"]) ||
    value["schemaVersion"] !== PROCESS_SESSION_SCHEMA_VERSION ||
    !isSessionId(value["sessionId"]) ||
    !isIsoTimestamp(value["startedAt"])
  ) {
    throw new Error("Process session marker is invalid.")
  }

  const base = {
    schemaVersion: PROCESS_SESSION_SCHEMA_VERSION,
    sessionId: value["sessionId"],
    startedAt: value["startedAt"]
  } as const
  const terminal = value["terminal"]
  if (terminal === null) {
    return { ...base, terminal: null }
  }
  if (!isPlainRecord(terminal)) {
    throw new Error("Process session terminal marker is invalid.")
  }
  if (
    hasExactKeys(terminal, ["kind", "recordedAt"]) &&
    terminal["kind"] === "clean_exit" &&
    isIsoTimestamp(terminal["recordedAt"])
  ) {
    return {
      ...base,
      terminal: { kind: "clean_exit", recordedAt: terminal["recordedAt"] }
    }
  }
  if (
    hasExactKeys(terminal, ["kind", "recordedAt"]) &&
    terminal["kind"] === "shutdown_failed" &&
    isIsoTimestamp(terminal["recordedAt"])
  ) {
    return {
      ...base,
      terminal: { kind: "shutdown_failed", recordedAt: terminal["recordedAt"] }
    }
  }
  if (
    hasExactKeys(terminal, ["kind", "origin", "recordedAt"]) &&
    terminal["kind"] === "js_fatal" &&
    isFatalOrigin(terminal["origin"]) &&
    isIsoTimestamp(terminal["recordedAt"])
  ) {
    return {
      ...base,
      terminal: {
        kind: "js_fatal",
        origin: terminal["origin"],
        recordedAt: terminal["recordedAt"]
      }
    }
  }
  throw new Error("Process session terminal marker is invalid.")
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function readMarker(path: string): ProcessSessionMarker | null {
  const expected = assertPrivateRegularFileSync(path)
  if (!expected) {
    return null
  }
  if (expected.size > PROCESS_SESSION_MAX_BYTES) {
    throw new Error("Process session marker exceeds its size limit.")
  }

  const descriptor = openSync(path, constants.O_RDONLY | NO_FOLLOW)
  try {
    const opened = fstatSync(descriptor)
    const after = lstatSync(path)
    if (!opened.isFile() || after.isSymbolicLink() || !after.isFile() || !sameFile(opened, after)) {
      throw new Error("Process session marker changed while it was being read.")
    }
    enforcePrivateFileModeSync(descriptor)
    const serialized = readFileSync(descriptor, "utf8")
    if (Buffer.byteLength(serialized, "utf8") > PROCESS_SESSION_MAX_BYTES) {
      throw new Error("Process session marker exceeds its size limit.")
    }
    return parseProcessSessionMarker(JSON.parse(serialized) as unknown)
  } finally {
    closeSync(descriptor)
  }
}

function syncDirectory(path: string): void {
  if (process.platform === "win32") {
    return
  }
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | NO_FOLLOW)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function writeMarkerAtomically(path: string, marker: ProcessSessionMarker): void {
  const directory = ensurePrivateDirectorySync(dirname(path))
  const destination = join(directory, basename(path))
  assertPrivateRegularFileSync(destination)
  const serialized = `${JSON.stringify(marker)}\n`
  if (Buffer.byteLength(serialized, "utf8") > PROCESS_SESSION_MAX_BYTES) {
    throw new Error("Process session marker exceeds its size limit.")
  }

  const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.tmp`
  let descriptor: number | null = null
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NO_FOLLOW,
      PRIVATE_FILE_MODE
    )
    writeFileSync(descriptor, serialized, "utf8")
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporaryPath, destination)
    syncDirectory(directory)
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor)
      } catch {
        // The persistence error remains authoritative.
      }
    }
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // Best-effort cleanup cannot replace the persistence result.
    }
  }
}

function previousOutcome(marker: ProcessSessionMarker | null): PreviousProcessSessionOutcome {
  if (!marker) {
    return "none"
  }
  return marker.terminal?.kind ?? "abrupt_exit_unclassified"
}

function normalizeFatalOrigin(origin: unknown): ProcessSessionFatalOrigin {
  return isFatalOrigin(origin) ? origin : "unknown"
}

export class DiagnosticsProcessSession {
  private currentSessionId: string | null = null
  private sessionEvent: DiagnosticEventRef | null = null
  private unavailableEvent: DiagnosticEventRef | null = null
  private readonly idFactory: () => string
  private readonly markerPath: string
  private readonly now: () => Date
  private readonly sink: DiagnosticGraphSink

  constructor(options: ProcessSessionOptions) {
    this.markerPath = join(ensurePrivateDirectorySync(options.logDir), PROCESS_SESSION_FILE_NAME)
    this.sink = options.sink
    this.idFactory = options.idFactory ?? randomUUID
    this.now = options.now ?? (() => new Date())
  }

  start(context: ProcessSessionRuntimeContext): ProcessSessionStartResult {
    if (this.sessionEvent) {
      throw new Error("Process session has already been started.")
    }

    let outcome: PreviousProcessSessionOutcome = "state_unavailable"
    let priorEvent: DiagnosticEventRef | null = null
    let previous: ProcessSessionMarker | null = null
    try {
      previous = readMarker(this.markerPath)
    } catch {
      outcome = "state_unavailable"
      priorEvent = this.captureUnavailable()
      this.replaceUnavailableStateWithActiveSession()
    }

    if (!this.currentSessionId) {
      try {
        outcome = previousOutcome(previous)
        this.writeActiveSession()
        priorEvent = this.capturePreviousOutcome(outcome, previous)
      } catch {
        outcome = "state_unavailable"
        priorEvent = this.captureUnavailable()
      }
    }

    this.sessionEvent = this.sink.capture({
      component: "diagnostics",
      dimensionEntries: [
        { key: "appVersion", value: context.appVersion },
        { key: "electronVersion", value: context.electronVersion },
        { key: "isPackaged", value: context.isPackaged },
        { key: "platform", value: context.platform }
      ],
      eventCode: "diagnostics.session_started",
      level: "info",
      operation: "start-session",
      parentEvents: priorEvent ? [priorEvent] : undefined,
      recoverable: true,
      stateImpact: "none",
      summary: "Jingle diagnostics session started"
    })
    return {
      currentSessionId: this.currentSessionId,
      eventRef: this.sessionEvent,
      previousOutcome: outcome
    }
  }

  markCleanExit(options: MarkCleanExitOptions = {}): boolean {
    return this.markTerminal("clean_exit", undefined, options.captureEvent ?? true)
  }

  markJsFatal(origin: unknown): boolean {
    return this.markTerminal("js_fatal", normalizeFatalOrigin(origin))
  }

  markShutdownFailed(): boolean {
    return this.markTerminal("shutdown_failed")
  }

  private capturePreviousOutcome(
    outcome: PreviousProcessSessionOutcome,
    previous: ProcessSessionMarker | null
  ): DiagnosticEventRef | null {
    if (!previous) {
      return null
    }
    const refs: readonly DiagnosticResourceRef[] = [
      { id: "main", kind: "process" },
      { id: previous.sessionId, kind: "process-session" }
    ]
    if (outcome === "abrupt_exit_unclassified") {
      return this.sink.capture({
        component: "electron",
        eventCode: "process.previous_session_abrupt_exit_unclassified",
        level: "warn",
        operation: "classify-previous-session",
        recoverable: true,
        refs,
        stateImpact: "previous_process_terminal_unclassified",
        summary: "Previous Jingle process session ended without a terminal marker"
      })
    }
    if (outcome === "js_fatal" && previous?.terminal?.kind === "js_fatal") {
      return this.sink.capture({
        component: "electron",
        dimensionEntries: [{ key: "origin", value: previous.terminal.origin }],
        eventCode: "process.previous_session_js_fatal",
        level: "warn",
        operation: "classify-previous-session",
        recoverable: true,
        refs,
        stateImpact: "previous_process_js_fatal",
        summary: "Previous Jingle process session recorded a JavaScript fatal error"
      })
    }
    if (outcome === "clean_exit") {
      return this.sink.capture({
        component: "electron",
        eventCode: "process.previous_session_clean_exit",
        level: "info",
        operation: "classify-previous-session",
        recoverable: true,
        refs,
        stateImpact: "none",
        summary: "Previous Jingle process session completed cleanly"
      })
    }
    if (outcome === "shutdown_failed") {
      return this.sink.capture({
        component: "electron",
        eventCode: "process.previous_session_shutdown_failed",
        level: "warn",
        operation: "classify-previous-session",
        recoverable: true,
        refs,
        stateImpact: "previous_process_shutdown_incomplete",
        summary: "Previous Jingle process session recorded an incomplete shutdown"
      })
    }
    return null
  }

  private captureUnavailable(): DiagnosticEventRef {
    this.currentSessionId = null
    this.unavailableEvent ??= this.sink.capture({
      component: "diagnostics",
      eventCode: "process.session_state_unavailable",
      level: "warn",
      operation: "persist-process-session",
      recoverable: true,
      stateImpact: "process_session_classification_unavailable",
      summary: "Process session classification could not be persisted"
    })
    return this.unavailableEvent
  }

  private replaceUnavailableStateWithActiveSession(): void {
    try {
      const state = lstatSync(this.markerPath, { throwIfNoEntry: false })
      if (state?.isSymbolicLink()) {
        unlinkSync(this.markerPath)
      } else if (state && !state.isFile()) {
        throw new Error("Process session marker address is not replaceable.")
      }
      this.writeActiveSession()
    } catch {
      this.currentSessionId = null
    }
  }

  private writeActiveSession(): void {
    const currentSessionId = this.idFactory().toLowerCase()
    if (!isSessionId(currentSessionId)) {
      throw new Error("Process session ID is invalid.")
    }
    writeMarkerAtomically(this.markerPath, {
      schemaVersion: PROCESS_SESSION_SCHEMA_VERSION,
      sessionId: currentSessionId,
      startedAt: this.readTimestamp(),
      terminal: null
    })
    this.currentSessionId = currentSessionId
  }

  private markTerminal(
    kind: "clean_exit" | "js_fatal" | "shutdown_failed",
    origin?: ProcessSessionFatalOrigin,
    captureEvent = true
  ): boolean {
    if (!this.currentSessionId || !this.sessionEvent) {
      return false
    }
    try {
      const current = readMarker(this.markerPath)
      if (!current || current.sessionId !== this.currentSessionId || current.terminal !== null) {
        return false
      }
      const recordedAt = this.readTimestamp()
      const terminal: Exclude<ProcessSessionMarker["terminal"], null> =
        kind === "js_fatal"
          ? { kind, origin: origin ?? "unknown", recordedAt }
          : kind === "shutdown_failed"
            ? { kind, recordedAt }
            : { kind: "clean_exit", recordedAt }
      const next: ProcessSessionMarker = { ...current, terminal }
      writeMarkerAtomically(this.markerPath, next)
      if (captureEvent) {
        this.sink.capture({
          component: "electron",
          dimensionEntries:
            terminal.kind === "js_fatal" ? [{ key: "origin", value: terminal.origin }] : undefined,
          eventCode:
            terminal.kind === "js_fatal"
              ? "process.session_js_fatal"
              : terminal.kind === "shutdown_failed"
                ? "process.session_shutdown_failed"
                : "process.session_clean_exit",
          level: terminal.kind === "clean_exit" ? "info" : "error",
          operation: "settle-process-session",
          parentEvents: [this.sessionEvent],
          recoverable: terminal.kind === "clean_exit",
          refs: [{ id: "main", kind: "process" }],
          stateImpact:
            terminal.kind === "js_fatal"
              ? "process_terminating"
              : terminal.kind === "shutdown_failed"
                ? "shutdown_incomplete"
                : "none",
          summary:
            terminal.kind === "js_fatal"
              ? "Jingle process session recorded a JavaScript fatal error"
              : terminal.kind === "shutdown_failed"
                ? "Jingle process session recorded an incomplete shutdown"
                : "Jingle process session completed cleanly"
        })
      }
      return true
    } catch {
      this.captureUnavailable()
      return false
    }
  }

  private readTimestamp(): string {
    const timestamp = this.now()
    if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
      throw new Error("Process session timestamp is invalid.")
    }
    return timestamp.toISOString()
  }
}
