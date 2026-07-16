#!/usr/bin/env node

import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open, readdir, realpath } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, sep } from "node:path"

const MAX_BLOB_BYTES = 16 * 1024
const MAX_GRAPH_DEPTH = 4
const MAX_GRAPH_NODES = 100
const MAX_HEALTH_BLOBS = 500
const MAX_OUTPUT_BYTES = 24 * 1024
const MAX_SCAN_BYTES = 8 * 1024 * 1024
const MAX_SEARCH_LIMIT = 100
const MAX_STORED_BLOB_BYTES = 64 * 1024
const LEVEL_ORDER = { info: 0, warn: 1, error: 2 }
const SUPPORTED_REDACTION_VERSIONS = new Set([1, 2])
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const REDACTED = "[REDACTED]"
const REDACTED_PATH = "[REDACTED_PATH]"
const USAGE = `Usage: inspect-diagnostics.mjs --home <JINGLE_HOME> <command>

Commands:
  health
  search [--since 24h] [--level warn] [--code CODE] [--ref kind:id] [--limit 20]
  show EVENT_ID
  graph EVENT_ID [--direction ancestors|descendants|both] [--depth 1]
  blob SHA256_ID [--offset 0] [--max-bytes 4096]`

const AUTH_SCHEME_PATTERN = /\b(Basic|Bearer)\s+[^\s,;]+/gi
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*(?![A-Za-z0-9_-])/g
const PEM_PATTERN = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/gi
const PREFIXED_SECRET_PATTERN = /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,})\b/gi
const SECRET_ASSIGNMENT_PATTERN =
  /\b(access[_-]?tokens?|api[_-]?key|auth|authorization|client[_-]?secrets?|cookies?|credentials?|headers?|id[_-]?tokens?|passwords?|private[_-]?key|refresh[_-]?tokens?|secrets?|tokens?)\s*[:=]\s*(?:\\"(?:\\.|[^"\\])*\\"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi
const QUOTED_SECRET_PROPERTY_PATTERN =
  /("(?:access[_-]?tokens?|api[_-]?key|authorization|client[_-]?secrets?|cookies?|credentials?|headers?|id[_-]?tokens?|messages|passwords?|prompts?|refresh[_-]?tokens?|secrets?|tokens?)"\s*:\s*)"(?:\\.|[^"\\])*"/gi
const ESCAPED_SECRET_PROPERTY_PATTERN =
  /(\\"(?:access[_-]?tokens?|api[_-]?key|authorization|client[_-]?secrets?|cookies?|credentials?|headers?|id[_-]?tokens?|messages|passwords?|prompts?|refresh[_-]?tokens?|secrets?|tokens?)\\"\s*:\s*)\\"(?:\\.|[^"\\])*\\"/gi
const POSIX_ABSOLUTE_PATH_PATTERN =
  /(^|[\s("'`=:[{,])\/(?!\/)(?:[^/\r\n"'`<>|,;:)\]}]+\/)*[^/\r\n"'`<>|,;:)\]}]+/gm
const MULTI_SLASH_ABSOLUTE_PATH_PATTERN =
  /(^|[\s("'`=[{,])\/{2,}(?:[^/\r\n"'`<>|,;:)\]}]+\/)*[^/\r\n"'`<>|,;:)\]}]+/gm
const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /(^|[\s("'`=:[{,])[A-Za-z]:[\\/](?:[^\\/\r\n"'`<>|,;:)\]}]+[\\/])*[^\\/\r\n"'`<>|,;:)\]}]+/gm
const WINDOWS_DEVICE_PATH_PATTERN = /(^|[\s("'`=:[{,])\\\\[?.]\\[^\r\n"'`<>|,;)\]}]+/gm
const WINDOWS_UNC_PATH_PATTERN =
  /(^|[\s("'`=:[{,])\\\\(?![?.]\\)[^\\/\r\n"'`<>|,;:)\]}]+[\\/][^\\/\r\n"'`<>|,;:)\]}]+(?:[\\/][^\\/\r\n"'`<>|,;:)\]}]+)*/gm
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi

class UnsafeDiagnosticPathError extends Error {}
class InspectorCliError extends Error {}

function isSensitiveKey(key) {
  const canonical = String(key)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
  return (
    /(?:authorization|cookies?|credentials?|env|environment|headers?|messagecontent|messages|passwords?|prompts?|secrets?|tokens?|apikey|privatekey)$/.test(
      canonical
    ) ||
    /^(?:auth|env|environment|headers?|messages|prompts?|stderr|stdout|tokens)$/.test(canonical)
  )
}

function sanitizeText(value) {
  let sanitized = String(value)
    .replace(PEM_PATTERN, REDACTED)
    .replace(AUTH_SCHEME_PATTERN, (_match, scheme) => `${scheme} ${REDACTED}`)
    .replace(PREFIXED_SECRET_PATTERN, REDACTED)
    .replace(JWT_PATTERN, REDACTED)
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, key) => `${key}=${REDACTED}`)
    .replace(QUOTED_SECRET_PROPERTY_PATTERN, (_match, prefix) => `${prefix}"${REDACTED}"`)
    .replace(ESCAPED_SECRET_PROPERTY_PATTERN, (_match, prefix) => {
      return `${prefix}\\"${REDACTED}\\"`
    })
    .replace(URL_PATTERN, (candidate) => {
      try {
        const url = new URL(candidate)
        if (url.protocol === "file:") return REDACTED_PATH
        url.username = ""
        url.password = ""
        url.pathname = "/"
        url.search = ""
        url.hash = ""
        return url.toString()
      } catch {
        return REDACTED
      }
    })
  sanitized = sanitized
    .replace(MULTI_SLASH_ABSOLUTE_PATH_PATTERN, (_match, prefix) => `${prefix}${REDACTED_PATH}`)
    .replace(POSIX_ABSOLUTE_PATH_PATTERN, (_match, prefix) => `${prefix}${REDACTED_PATH}`)
    .replace(WINDOWS_DEVICE_PATH_PATTERN, (_match, prefix) => `${prefix}${REDACTED_PATH}`)
    .replace(WINDOWS_UNC_PATH_PATTERN, (_match, prefix) => `${prefix}${REDACTED_PATH}`)
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, (_match, prefix) => `${prefix}${REDACTED_PATH}`)
  return sanitized
}

function sanitizeOutputValue(value, key = "", budget = { nodes: 2048 }) {
  if (isSensitiveKey(key)) return REDACTED
  if (budget.nodes <= 0) return "[node-budget-exhausted]"
  budget.nodes -= 1
  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") return sanitizeText(value)
  if (Array.isArray(value)) {
    return value.slice(0, 512).map((entry) => sanitizeOutputValue(entry, "", budget))
  }
  if (!value || typeof value !== "object") return sanitizeText(String(value))
  const sanitized = {}
  for (const [field, fieldValue] of Object.entries(value).slice(0, 512)) {
    const safeField = sanitizeText(field).slice(0, 128)
    sanitized[safeField] = sanitizeOutputValue(fieldValue, field, budget)
  }
  return sanitized
}

function hasPrivateMode(stat, mode) {
  return process.platform === "win32" || (stat.mode & 0o777) === mode
}

async function resolveExplicitHome(path) {
  try {
    const initial = await lstat(path)
    if (initial.isSymbolicLink() || !initial.isDirectory()) {
      throw new UnsafeDiagnosticPathError("Diagnostic home is unsafe.")
    }
    const resolved = await realpath(path)
    const after = await lstat(path)
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      initial.dev !== after.dev ||
      initial.ino !== after.ino
    ) {
      throw new UnsafeDiagnosticPathError("Diagnostic home changed during validation.")
    }
    return { path: resolved, privateMode: hasPrivateMode(after, PRIVATE_DIRECTORY_MODE) }
  } catch (error) {
    if (error instanceof UnsafeDiagnosticPathError) throw error
    throw new UnsafeDiagnosticPathError("Diagnostic home is not accessible.")
  }
}

async function resolveSafeDirectory(homeRoot, path, allowMissing = false) {
  try {
    const before = await lstat(path)
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new UnsafeDiagnosticPathError("Diagnostic directory is unsafe.")
    }
    const resolved = await realpath(path)
    const after = await lstat(path)
    if (!isWithin(homeRoot, resolved)) {
      throw new UnsafeDiagnosticPathError("Diagnostic directory is unsafe.")
    }
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      before.dev !== after.dev ||
      before.ino !== after.ino
    ) {
      throw new UnsafeDiagnosticPathError("Diagnostic directory changed during validation.")
    }
    return {
      dev: after.dev,
      ino: after.ino,
      path: resolved,
      privateMode: hasPrivateMode(after, PRIVATE_DIRECTORY_MODE)
    }
  } catch (error) {
    if (allowMissing && error && error.code === "ENOENT") return null
    if (error instanceof UnsafeDiagnosticPathError) throw error
    throw new UnsafeDiagnosticPathError("Diagnostic directory is not accessible.")
  }
}

async function resolveSafeChildDirectory(homeRoot, root, segments, allowMissing = false) {
  let current = root
  let privateMode = true
  for (const segment of segments) {
    const resolved = await resolveSafeDirectory(homeRoot, join(current, segment), allowMissing)
    if (!resolved) return null
    current = resolved.path
    privateMode &&= resolved.privateMode
  }
  return { path: current, privateMode }
}

async function snapshotAncestorDirectories(homeRoot, path) {
  const parent = dirname(path)
  if (!isWithin(homeRoot, parent)) {
    throw new UnsafeDiagnosticPathError("Diagnostic file parent escaped its home.")
  }
  const descendant = relative(homeRoot, parent)
  const segments = descendant ? descendant.split(sep) : []
  const snapshots = []
  let current = homeRoot
  for (const segment of [null, ...segments]) {
    if (segment !== null) {
      if (!segment || segment === "." || segment === "..") {
        throw new UnsafeDiagnosticPathError("Diagnostic file parent is unsafe.")
      }
      current = join(current, segment)
    }
    const resolved = await resolveSafeDirectory(homeRoot, current)
    if (!resolved || resolved.path !== current) {
      throw new UnsafeDiagnosticPathError("Diagnostic file parent is unsafe.")
    }
    snapshots.push(resolved)
  }
  return snapshots
}

function sameDirectorySnapshots(before, after) {
  return (
    before.length === after.length &&
    before.every(
      (entry, index) =>
        entry.path === after[index].path &&
        entry.dev === after[index].dev &&
        entry.ino === after[index].ino &&
        entry.privateMode === after[index].privateMode
    )
  )
}

async function openSafeDiagnosticFile(homeRoot, path, maxBytes, requirePrivateMode = false) {
  const ancestorsBefore = await snapshotAncestorDirectories(homeRoot, path)
  let before
  try {
    before = await lstat(path)
  } catch (error) {
    if (error && error.code === "ENOENT") return null
    throw new UnsafeDiagnosticPathError("Diagnostic file is not accessible.")
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new UnsafeDiagnosticPathError("Diagnostic file is unsafe.")
  }
  const resolved = await realpath(path)
  if (!isWithin(homeRoot, resolved)) {
    throw new UnsafeDiagnosticPathError("Diagnostic file is unsafe.")
  }
  const privateMode =
    hasPrivateMode(before, PRIVATE_FILE_MODE) &&
    ancestorsBefore.every((ancestor) => ancestor.privateMode)
  if (requirePrivateMode && !privateMode) {
    throw new UnsafeDiagnosticPathError("Diagnostic file permissions are unsafe.")
  }
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    const after = await lstat(path)
    const resolvedAfterOpen = await realpath(path)
    const ancestorsAfter = await snapshotAncestorDirectories(homeRoot, path)
    const privateModeAfter =
      hasPrivateMode(opened, PRIVATE_FILE_MODE) &&
      hasPrivateMode(after, PRIVATE_FILE_MODE) &&
      ancestorsAfter.every((ancestor) => ancestor.privateMode)
    if (
      !opened.isFile() ||
      after.isSymbolicLink() ||
      !after.isFile() ||
      opened.dev !== after.dev ||
      opened.ino !== after.ino ||
      resolvedAfterOpen !== resolved ||
      !sameDirectorySnapshots(ancestorsBefore, ancestorsAfter) ||
      opened.size > maxBytes
    ) {
      throw new UnsafeDiagnosticPathError("Diagnostic file changed or exceeded its size limit.")
    }
    if (requirePrivateMode && !privateModeAfter) {
      throw new UnsafeDiagnosticPathError("Diagnostic file permissions are unsafe.")
    }
    return { handle, privateMode: privateMode && privateModeAfter, size: opened.size }
  } catch (error) {
    await handle.close()
    throw error
  }
}

function fail(message) {
  throw new InspectorCliError(sanitizeText(message))
}

function takeOption(args, name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  const value = args[index + 1]
  if (value === undefined) fail(`Missing value for ${name}.`)
  args.splice(index, 2)
  return value
}

function boundedInteger(value, fallback, max, name) {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0) fail(`Invalid ${name}: ${value}`)
  return Math.min(parsed, max)
}

function isUtf8Boundary(buffer, offset) {
  return offset === 0 || offset === buffer.length || (buffer[offset] & 0xc0) !== 0x80
}

function alignUtf8End(buffer, offset) {
  let aligned = Math.min(Math.max(offset, 0), buffer.length)
  while (aligned > 0 && aligned < buffer.length && !isUtf8Boundary(buffer, aligned)) {
    aligned -= 1
  }
  return aligned
}

function firstUtf8CodePointBytes(buffer) {
  let end = Math.min(1, buffer.length)
  while (end < buffer.length && !isUtf8Boundary(buffer, end)) {
    end += 1
  }
  return end
}

function parseSince(value) {
  if (!value) return null
  const duration = /^(\d+)(m|h|d)$/.exec(value)
  if (duration) {
    const unitMs = duration[2] === "m" ? 60_000 : duration[2] === "h" ? 3_600_000 : 86_400_000
    return Date.now() - Number(duration[1]) * unitMs
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) fail(`Invalid --since value: ${value}`)
  return parsed
}

function encodePayload(payload) {
  const safePayload = sanitizeOutputValue(payload)
  let returnedBytes = 0
  let body = ""
  for (let attempt = 0; attempt < 3; attempt += 1) {
    body = JSON.stringify({ returnedBytes, ...safePayload })
    const nextReturnedBytes = Buffer.byteLength(body)
    if (nextReturnedBytes === returnedBytes) break
    returnedBytes = nextReturnedBytes
  }
  return body
}

function encodedBytes(payload) {
  return Buffer.byteLength(encodePayload(payload))
}

function emit(payload) {
  const body = encodePayload(payload)
  if (Buffer.byteLength(body) > MAX_OUTPUT_BYTES) {
    fail("Inspector output exceeded 24 KiB; narrow the query before expanding evidence.")
  }
  process.stdout.write(`${body}\n`)
}

function boundedString(value, maxLength, fallback = "") {
  if (typeof value !== "string") return fallback
  const sanitized = sanitizeText(value)
  return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength)}[truncated]` : sanitized
}

function compactEvidenceRef(ref) {
  return {
    blobId: boundedString(ref.blobId, 80),
    capture: ref.capture === "stored" ? "stored" : "failed",
    kind: boundedString(ref.kind, 64, "unknown"),
    sizeBytes: Number.isFinite(ref.sizeBytes) ? ref.sizeBytes : null,
    truncated: ref.truncated === true
  }
}

function isCompatibleScalar(value) {
  return (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "string"
  )
}

function isCompatibleEvidenceRef(ref, eventRedactionVersion) {
  return Boolean(
    ref &&
    typeof ref === "object" &&
    !Array.isArray(ref) &&
    typeof ref.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(ref.sha256) &&
    ref.blobId === `sha256:${ref.sha256}` &&
    (ref.capture === "stored" || ref.capture === "failed") &&
    typeof ref.contentType === "string" &&
    ref.contentType.length > 0 &&
    ref.contentType.length <= 128 &&
    typeof ref.kind === "string" &&
    ref.kind.length > 0 &&
    ref.kind.length <= 64 &&
    Number.isSafeInteger(ref.originalSizeBytes) &&
    ref.originalSizeBytes >= 0 &&
    ref.originalSizeBytes >= ref.sizeBytes &&
    ref.redactionVersion === eventRedactionVersion &&
    SUPPORTED_REDACTION_VERSIONS.has(ref.redactionVersion) &&
    Number.isSafeInteger(ref.sizeBytes) &&
    ref.sizeBytes >= 0 &&
    ref.sizeBytes <= MAX_STORED_BLOB_BYTES &&
    typeof ref.truncated === "boolean" &&
    (ref.truncated || ref.originalSizeBytes === ref.sizeBytes)
  )
}

function isCompatibleDiagnosticEvent(event) {
  if (
    !event ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    event.recordType !== "diagnostic.event" ||
    event.schemaVersion !== 1 ||
    !SUPPORTED_REDACTION_VERSIONS.has(event.redactionVersion)
  ) {
    return false
  }

  const dimensionEntries =
    event.dimensions && typeof event.dimensions === "object" && !Array.isArray(event.dimensions)
      ? Object.entries(event.dimensions)
      : null
  return Boolean(
    typeof event.component === "string" &&
    event.component.length > 0 &&
    event.component.length <= 64 &&
    typeof event.eventCode === "string" &&
    event.eventCode.length > 0 &&
    event.eventCode.length <= 160 &&
    typeof event.eventId === "string" &&
    typeof event.fingerprint === "string" &&
    event.fingerprint.length <= 160 &&
    Object.hasOwn(LEVEL_ORDER, event.level) &&
    typeof event.message === "string" &&
    event.message.length <= 240 &&
    typeof event.operation === "string" &&
    event.operation.length > 0 &&
    event.operation.length <= 64 &&
    typeof event.processKind === "string" &&
    event.processKind.length > 0 &&
    event.processKind.length <= 32 &&
    typeof event.recoverable === "boolean" &&
    typeof event.sessionId === "string" &&
    event.sessionId.length > 0 &&
    event.sessionId.length <= 64 &&
    typeof event.stateImpact === "string" &&
    event.stateImpact.length > 0 &&
    event.stateImpact.length <= 96 &&
    typeof event.timestamp === "string" &&
    Number.isFinite(Date.parse(event.timestamp)) &&
    Number.isSafeInteger(event.sequence) &&
    event.sequence > 0 &&
    event.eventId === `diag:${event.sessionId}:${event.sequence}` &&
    Array.isArray(event.parentEventIds) &&
    event.parentEventIds.length <= 4 &&
    event.parentEventIds.every((value) => typeof value === "string" && value.length <= 160) &&
    Array.isArray(event.refs) &&
    event.refs.length <= 16 &&
    event.refs.every(
      (ref) =>
        ref &&
        typeof ref === "object" &&
        !Array.isArray(ref) &&
        typeof ref.kind === "string" &&
        ref.kind.length > 0 &&
        ref.kind.length <= 64 &&
        typeof ref.id === "string" &&
        ref.id.length > 0 &&
        ref.id.length <= 256
    ) &&
    Array.isArray(event.evidenceRefs) &&
    event.evidenceRefs.length <= 8 &&
    event.evidenceRefs.every((ref) => isCompatibleEvidenceRef(ref, event.redactionVersion)) &&
    dimensionEntries &&
    dimensionEntries.length <= 16 &&
    dimensionEntries.every(
      ([key, value]) => key.length > 0 && key.length <= 64 && isCompatibleScalar(value)
    )
  )
}

function compactEvent(event, includeDimensions = false, acceptedParentIds = eventParents(event)) {
  const parentEventIds = Array.isArray(acceptedParentIds)
    ? acceptedParentIds
        .filter((value) => typeof value === "string")
        .slice(0, 4)
        .map((value) => boundedString(value, 160))
    : []
  const refs = Array.isArray(event.refs)
    ? event.refs
        .filter((ref) => ref && typeof ref.id === "string" && typeof ref.kind === "string")
        .slice(0, 16)
        .map((ref) => ({
          id: boundedString(ref.id, 256),
          kind: boundedString(ref.kind, 64, "unknown")
        }))
    : []
  const evidenceRefs = Array.isArray(event.evidenceRefs)
    ? event.evidenceRefs.filter((ref) => ref && typeof ref.blobId === "string").slice(0, 8)
    : []
  const dimensions = {}
  if (
    event.dimensions &&
    typeof event.dimensions === "object" &&
    !Array.isArray(event.dimensions)
  ) {
    for (const [key, value] of Object.entries(event.dimensions).slice(0, 16)) {
      if (value === null || typeof value === "boolean" || typeof value === "number") {
        dimensions[boundedString(key, 64)] = value
      } else if (typeof value === "string") {
        dimensions[boundedString(key, 64)] = boundedString(value, 160)
      }
    }
  }
  return {
    component: boundedString(event.component, 64, "unknown"),
    eventId: boundedString(event.eventId, 160),
    eventCode: boundedString(event.eventCode, 160, "unknown"),
    fingerprint: boundedString(event.fingerprint, 160, "unknown"),
    level: Object.hasOwn(LEVEL_ORDER, event.level) ? event.level : "info",
    message: boundedString(event.message, 256),
    operation: boundedString(event.operation, 64, "unknown"),
    parentEventIds,
    refs,
    evidenceRefs: evidenceRefs.map(compactEvidenceRef),
    sequence: Number.isInteger(event.sequence) ? event.sequence : null,
    sessionId: boundedString(event.sessionId, 128, "unknown"),
    timestamp: boundedString(event.timestamp, 64),
    ...(includeDimensions
      ? { dimensions, stateImpact: boundedString(event.stateImpact, 96, "unknown") }
      : {})
  }
}

function isWithin(root, candidate) {
  const path = relative(root, candidate)
  return (
    path === "" ||
    (!isAbsolute(path) &&
      path !== ".." &&
      !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
  )
}

function eventParents(event) {
  return Array.isArray(event.parentEventIds)
    ? event.parentEventIds.filter((value) => typeof value === "string")
    : []
}

function analyzeGraph(events) {
  const byId = new Map()
  const duplicateIds = new Set()
  let duplicateEventIds = 0
  let invalidEventShapes = 0
  let invalidEventIds = 0
  const sequencesBySession = new Map()
  for (const event of events) {
    if (byId.has(event.eventId)) {
      duplicateEventIds += 1
      duplicateIds.add(event.eventId)
    } else {
      byId.set(event.eventId, event)
    }
    if (
      !Array.isArray(event.parentEventIds) ||
      !event.parentEventIds.every((value) => typeof value === "string") ||
      !Array.isArray(event.refs) ||
      !Array.isArray(event.evidenceRefs)
    ) {
      invalidEventShapes += 1
    }
    if (
      typeof event.sessionId !== "string" ||
      !Number.isInteger(event.sequence) ||
      event.sequence <= 0 ||
      event.eventId !== `diag:${event.sessionId}:${event.sequence}`
    ) {
      invalidEventIds += 1
    } else {
      const sequences = sequencesBySession.get(event.sessionId) ?? new Set()
      sequences.add(event.sequence)
      sequencesBySession.set(event.sessionId, sequences)
    }
  }

  let sequenceGaps = 0
  for (const sequences of sequencesBySession.values()) {
    const ordered = [...sequences].sort((left, right) => left - right)
    for (let index = 1; index < ordered.length; index += 1) {
      sequenceGaps += Math.max(0, ordered[index] - ordered[index - 1] - 1)
    }
  }

  let crossSessionParents = 0
  let duplicateParentEdges = 0
  let missingParents = 0
  let nonPastParents = 0
  const acceptedParentsByEventId = new Map()
  for (const event of byId.values()) {
    acceptedParentsByEventId.set(event.eventId, [])
  }
  for (const event of events) {
    const acceptedParents =
      byId.get(event.eventId) === event && !duplicateIds.has(event.eventId)
        ? acceptedParentsByEventId.get(event.eventId)
        : null
    const seen = new Set()
    for (const parentId of eventParents(event)) {
      if (seen.has(parentId)) {
        duplicateParentEdges += 1
        continue
      }
      seen.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) {
        missingParents += 1
        continue
      }
      if (duplicateIds.has(parentId)) {
        continue
      }
      if (parent.sessionId !== event.sessionId) {
        crossSessionParents += 1
      } else if (
        !Number.isInteger(parent.sequence) ||
        !Number.isInteger(event.sequence) ||
        parent.sequence >= event.sequence
      ) {
        nonPastParents += 1
      } else if (acceptedParents) {
        acceptedParents.push(parentId)
      }
    }
  }

  let cycleEdges = 0
  const state = new Map()
  for (const startEventId of byId.keys()) {
    if (state.has(startEventId)) continue
    state.set(startEventId, 1)
    const stack = [{ eventId: startEventId, parentIndex: 0 }]
    while (stack.length > 0) {
      const current = stack.at(-1)
      const parents = eventParents(byId.get(current.eventId))
      if (current.parentIndex >= parents.length) {
        state.set(current.eventId, 2)
        stack.pop()
        continue
      }
      const parentId = parents[current.parentIndex]
      current.parentIndex += 1
      if (!byId.has(parentId)) continue
      const parentState = state.get(parentId) ?? 0
      if (parentState === 1) {
        cycleEdges += 1
      } else if (parentState === 0) {
        state.set(parentId, 1)
        stack.push({ eventId: parentId, parentIndex: 0 })
      }
    }
  }

  return {
    acceptedParentsByEventId,
    byId,
    crossSessionParents,
    cycleEdges,
    duplicateEventIds,
    duplicateParentEdges,
    invalidEventIds,
    invalidEventShapes,
    missingParents,
    nonPastParents,
    sequenceGaps
  }
}

async function auditEvidence(events, logDir, homeRoot) {
  const stored = new Map()
  let failedEvidenceCaptures = 0
  let invalidEvidenceBlobIds = 0
  for (const event of events) {
    for (const ref of Array.isArray(event.evidenceRefs) ? event.evidenceRefs : []) {
      if (ref?.capture === "failed") failedEvidenceCaptures += 1
      const match = /^sha256:([a-f0-9]{64})$/.exec(ref?.blobId ?? "")
      if (!match) {
        invalidEvidenceBlobIds += 1
      } else if (ref.capture === "stored" && !stored.has(ref.blobId)) {
        stored.set(ref.blobId, { ref, sha256: match[1] })
      }
    }
  }

  let evidenceSizeMismatches = 0
  let corruptEvidenceBlobs = 0
  let missingEvidenceBlobs = 0
  let unsafeEvidencePermissions = 0
  let unsafeEvidencePaths = 0
  const candidates = [...stored.values()].slice(0, MAX_HEALTH_BLOBS)
  for (const { ref, sha256 } of candidates) {
    try {
      const directory = await resolveSafeChildDirectory(
        homeRoot,
        logDir,
        ["blobs", "sha256", sha256.slice(0, 2)],
        true
      )
      if (!directory) {
        missingEvidenceBlobs += 1
        continue
      }
      if (!directory.privateMode) unsafeEvidencePermissions += 1
      const opened = await openSafeDiagnosticFile(
        homeRoot,
        join(directory.path, `${sha256}.json`),
        MAX_STORED_BLOB_BYTES
      )
      if (!opened) {
        missingEvidenceBlobs += 1
        continue
      }
      if (!opened.privateMode) unsafeEvidencePermissions += 1
      try {
        if (Number.isFinite(ref.sizeBytes) && opened.size !== ref.sizeBytes) {
          evidenceSizeMismatches += 1
        } else {
          const content = await opened.handle.readFile()
          if (createHash("sha256").update(content).digest("hex") !== sha256) {
            corruptEvidenceBlobs += 1
          }
        }
      } finally {
        await opened.handle.close()
      }
    } catch (error) {
      if (error instanceof UnsafeDiagnosticPathError) unsafeEvidencePaths += 1
      else throw error
    }
  }
  return {
    blobCheckTruncated: stored.size > candidates.length,
    checkedEvidenceBlobs: candidates.length,
    corruptEvidenceBlobs,
    evidenceSizeMismatches,
    failedEvidenceCaptures,
    invalidEvidenceBlobIds,
    missingEvidenceBlobs,
    unsafeEvidencePermissions,
    unsafeEvidencePaths
  }
}

async function listJournalFiles(logDir) {
  let entries
  try {
    entries = await readdir(logDir, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === "ENOENT") return { files: [], unsafeJournalPaths: 0 }
    throw error
  }
  const files = []
  let unsafeJournalPaths = 0
  for (const entry of entries) {
    const match = /^jingle\.log(?:\.(\d+))?$/.exec(entry.name)
    if (!match) continue
    if (entry.isSymbolicLink() || !entry.isFile()) {
      unsafeJournalPaths += 1
      continue
    }
    files.push({
      index: match[1] ? Number(match[1]) : 0,
      path: join(logDir, entry.name)
    })
  }
  files.sort((left, right) => left.index - right.index)
  return { files, unsafeJournalPaths }
}

async function loadJournal(logDir, homeRoot) {
  if (!logDir) {
    return {
      events: [],
      files: [],
      incompatibleGraphLines: 0,
      insecureJournalPermissions: 0,
      legacyLines: 0,
      malformedLines: 0,
      scannedBytes: 0,
      scanTruncated: false,
      skippedSegments: 0,
      unsafeJournalPaths: 0
    }
  }
  const listed = await listJournalFiles(logDir)
  const { files } = listed
  const events = []
  let incompatibleGraphLines = 0
  let insecureJournalPermissions = 0
  let legacyLines = 0
  let malformedLines = 0
  let scannedBytes = 0
  let scanTruncated = false
  let skippedSegments = 0
  for (const file of files) {
    let opened
    try {
      opened = await openSafeDiagnosticFile(homeRoot, file.path, MAX_SCAN_BYTES)
    } catch (error) {
      if (error instanceof UnsafeDiagnosticPathError) {
        skippedSegments += 1
        continue
      }
      throw error
    }
    if (!opened) {
      skippedSegments += 1
      continue
    }
    if (!opened.privateMode) {
      insecureJournalPermissions += 1
      skippedSegments += 1
      await opened.handle.close()
      continue
    }
    if (scannedBytes + opened.size > MAX_SCAN_BYTES) {
      scanTruncated = true
      await opened.handle.close()
      break
    }
    let text
    try {
      text = await opened.handle.readFile("utf8")
    } catch (error) {
      if (error && error.code === "ENOENT") {
        skippedSegments += 1
        continue
      }
      throw error
    } finally {
      await opened.handle.close()
    }
    const textBytes = Buffer.byteLength(text)
    if (scannedBytes + textBytes > MAX_SCAN_BYTES) {
      scanTruncated = true
      break
    }
    scannedBytes += textBytes
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line)
        if (record?.recordType === "diagnostic.event") {
          if (isCompatibleDiagnosticEvent(record)) {
            events.push(record)
          } else {
            incompatibleGraphLines += 1
          }
        } else {
          legacyLines += 1
        }
      } catch {
        malformedLines += 1
      }
    }
  }
  return {
    events,
    files: files.map((file) => file.path),
    incompatibleGraphLines,
    insecureJournalPermissions,
    legacyLines,
    malformedLines,
    scannedBytes,
    scanTruncated,
    skippedSegments,
    unsafeJournalPaths: listed.unsafeJournalPaths
  }
}

function hasRef(event, selector) {
  if (!selector) return true
  const separator = selector.indexOf(":")
  if (separator <= 0) fail("--ref must use kind:id.")
  const kind = selector.slice(0, separator)
  const id = selector.slice(separator + 1)
  return Array.isArray(event.refs)
    ? event.refs.some((ref) => ref?.kind === kind && ref?.id === id)
    : false
}

function summarizeCoverage(events, legacyLines) {
  const failureEventCount = events.filter(
    (event) => event.level === "error" || event.level === "warn"
  ).length
  const informationalEventCount = events.length - failureEventCount
  return {
    coverage:
      failureEventCount > 0
        ? "causal-events-observed"
        : events.length > 0
          ? "no-failure-events-observed"
          : legacyLines > 0
            ? "legacy-only"
            : "empty",
    eventCount: events.length,
    failureEventCount,
    informationalEventCount
  }
}

function sanitizeBlobView(blob) {
  const text = blob.toString("utf8")
  try {
    return Buffer.from(JSON.stringify(sanitizeOutputValue(JSON.parse(text))), "utf8")
  } catch {
    return Buffer.from(sanitizeText(text), "utf8")
  }
}

async function run() {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg === "--help" || arg === "-h" || arg === "--help=0")) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  const explicitHome = takeOption(args, "--home", process.env.JINGLE_HOME?.trim())
  if (!explicitHome) {
    fail("Pass --home or set JINGLE_HOME explicitly; the inspector will not assume ~/.jingle.")
  }
  const resolvedHome = await resolveExplicitHome(explicitHome)
  const homeRoot = resolvedHome.path
  const command = args.shift() ?? "health"
  const resolvedLogDir = await resolveSafeChildDirectory(homeRoot, homeRoot, ["logs"], true)
  const logTreePrivate = resolvedHome.privateMode && (!resolvedLogDir || resolvedLogDir.privateMode)
  const logDir = logTreePrivate ? (resolvedLogDir?.path ?? null) : null
  const journal = await loadJournal(logDir, homeRoot)
  if (!logTreePrivate) {
    journal.insecureJournalPermissions += 1
  }
  const coverage = summarizeCoverage(journal.events, journal.legacyLines)
  if (command !== "health" && coverage.coverage !== "causal-events-observed") {
    fail(`No causal failure events were observed (${coverage.coverage}); run health first.`)
  }
  const graphHealth = analyzeGraph(journal.events)
  const { acceptedParentsByEventId, byId, ...graphHealthCounts } = graphHealth
  if (command !== "health" && graphHealthCounts.duplicateEventIds > 0) {
    fail("Duplicate diagnostic event IDs make graph lookup ambiguous; inspect health first.")
  }

  if (command === "blob") {
    const blobId = args.shift()
    const match = /^sha256:([a-f0-9]{64})$/.exec(blobId ?? "")
    if (!match) fail("blob requires a sha256:<64-hex> ID.")
    const offset = boundedInteger(
      takeOption(args, "--offset", undefined),
      0,
      Number.MAX_SAFE_INTEGER,
      "offset"
    )
    const maxBytes = boundedInteger(
      takeOption(args, "--max-bytes", undefined),
      4096,
      MAX_BLOB_BYTES,
      "max-bytes"
    )
    if (maxBytes === 0) fail("--max-bytes must be at least 1.")
    if (args.length > 0) fail(`Unexpected arguments: ${args.join(" ")}`)
    const referenced = journal.events.some((event) =>
      Array.isArray(event.evidenceRefs)
        ? event.evidenceRefs.some((ref) => ref?.capture === "stored" && ref?.blobId === blobId)
        : false
    )
    if (!referenced) {
      fail(`Blob is not referenced by a scanned causal event: ${blobId}`)
    }
    const directory = await resolveSafeChildDirectory(
      homeRoot,
      logDir,
      ["blobs", "sha256", match[1].slice(0, 2)],
      true
    )
    if (!directory || !directory.privateMode) {
      fail(`Blob storage is missing or unsafe: ${blobId}`)
    }
    const opened = await openSafeDiagnosticFile(
      homeRoot,
      join(directory.path, `${match[1]}.json`),
      MAX_STORED_BLOB_BYTES,
      true
    )
    if (!opened) fail(`Blob not found: ${blobId}`)
    const { handle } = opened
    try {
      const fileStat = await handle.stat()
      const blob = await handle.readFile()
      const actualSha256 = createHash("sha256").update(blob).digest("hex")
      if (actualSha256 !== match[1]) {
        fail(`Blob hash mismatch: ${blobId}`)
      }
      const redactedBlob = sanitizeBlobView(blob)
      if (offset > redactedBlob.length) {
        fail(`Blob offset exceeds ${redactedBlob.length} redacted bytes.`)
      }
      if (!isUtf8Boundary(redactedBlob, offset)) {
        fail("Blob offset is not on a UTF-8 boundary.")
      }
      const availableBytes = redactedBlob.length - offset
      const requestedEnd = alignUtf8End(redactedBlob, offset + Math.min(maxBytes, availableBytes))
      if (requestedEnd === offset && availableBytes > 0) {
        fail("--max-bytes is too small for the next UTF-8 code point.")
      }
      const requested = redactedBlob.subarray(offset, requestedEnd)
      let returnedBlobBytes = requested.length
      let payload
      let outputFits = false
      while (!outputFits && returnedBlobBytes >= 0) {
        const nextOffset = offset + returnedBlobBytes
        payload = {
          blobId,
          content: requested.subarray(0, returnedBlobBytes).toString("utf8"),
          nextOffset: nextOffset < redactedBlob.length ? nextOffset : null,
          offset,
          sourceBytes: fileStat.size,
          totalBytes: redactedBlob.length,
          truncated: nextOffset < redactedBlob.length,
          verifiedSha256: true
        }
        outputFits = encodedBytes(payload) <= MAX_OUTPUT_BYTES || returnedBlobBytes === 0
        if (outputFits) break
        const alignedBytes = alignUtf8End(requested, Math.floor(returnedBlobBytes * 0.75))
        returnedBlobBytes = alignedBytes > 0 ? alignedBytes : firstUtf8CodePointBytes(requested)
      }
      emit(payload)
    } finally {
      await handle.close()
    }
    return
  }

  if (command === "health") {
    const evidenceHealth = await auditEvidence(journal.events, logDir, homeRoot)
    const timestamps = journal.events
      .map((event) => Date.parse(event.timestamp))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)
    emit({
      ...coverage,
      evidenceRefCount: journal.events.reduce(
        (count, event) =>
          count + (Array.isArray(event.evidenceRefs) ? event.evidenceRefs.length : 0),
        0
      ),
      firstEventAt: timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : null,
      incompatibleGraphLines: journal.incompatibleGraphLines,
      insecureJournalPermissions: journal.insecureJournalPermissions,
      lastEventAt: timestamps.length > 0 ? new Date(timestamps.at(-1)).toISOString() : null,
      legacyLines: journal.legacyLines,
      malformedLines: journal.malformedLines,
      ...graphHealthCounts,
      ...evidenceHealth,
      scannedBytes: journal.scannedBytes,
      scanTruncated: journal.scanTruncated,
      segmentCount: journal.files.length,
      sessionCount: new Set(journal.events.map((event) => event.sessionId)).size,
      skippedSegments: journal.skippedSegments,
      unsafeJournalPaths: journal.unsafeJournalPaths
    })
    return
  }

  if (command === "search") {
    const since = parseSince(takeOption(args, "--since", undefined))
    const code = takeOption(args, "--code", undefined)
    const fingerprint = takeOption(args, "--fingerprint", undefined)
    const minimumLevel = takeOption(args, "--level", undefined)
    const ref = takeOption(args, "--ref", undefined)
    const limit = boundedInteger(
      takeOption(args, "--limit", undefined),
      20,
      MAX_SEARCH_LIMIT,
      "limit"
    )
    if (minimumLevel && !Object.hasOwn(LEVEL_ORDER, minimumLevel)) {
      fail(`Invalid level: ${minimumLevel}`)
    }
    if (args.length > 0) fail(`Unexpected arguments: ${args.join(" ")}`)
    const matchingEvents = journal.events
      .filter((event) => !code || event.eventCode === code)
      .filter((event) => !fingerprint || event.fingerprint === fingerprint)
      .filter((event) => !minimumLevel || LEVEL_ORDER[event.level] >= LEVEL_ORDER[minimumLevel])
      .filter((event) => since === null || Date.parse(event.timestamp) >= since)
      .filter((event) => hasRef(event, ref))
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    const events = []
    for (const event of matchingEvents.slice(0, limit)) {
      const candidate = [
        ...events,
        compactEvent(event, false, acceptedParentsByEventId.get(event.eventId) ?? [])
      ]
      const payload = {
        events: candidate,
        malformedLines: journal.malformedLines,
        scanTruncated: journal.scanTruncated,
        skippedSegments: journal.skippedSegments,
        truncated: matchingEvents.length > candidate.length
      }
      if (encodedBytes(payload) > MAX_OUTPUT_BYTES) break
      events.push(candidate.at(-1))
    }
    emit({
      events,
      malformedLines: journal.malformedLines,
      scanTruncated: journal.scanTruncated,
      skippedSegments: journal.skippedSegments,
      truncated: matchingEvents.length > events.length
    })
    return
  }

  if (command === "show") {
    const eventId = args.shift()
    if (!eventId || args.length > 0) fail("show requires exactly one event ID.")
    const event = byId.get(eventId)
    if (!event) fail(`Event not found: ${eventId}`)
    emit({
      event: compactEvent(event, true, acceptedParentsByEventId.get(event.eventId) ?? [])
    })
    return
  }

  if (command === "graph") {
    const eventId = args.shift()
    if (!eventId) fail("graph requires an event ID.")
    const direction = takeOption(args, "--direction", "ancestors")
    const depth = boundedInteger(
      takeOption(args, "--depth", undefined),
      1,
      MAX_GRAPH_DEPTH,
      "depth"
    )
    const maxNodes = boundedInteger(
      takeOption(args, "--max-nodes", undefined),
      30,
      MAX_GRAPH_NODES,
      "max-nodes"
    )
    if (!["ancestors", "descendants", "both"].includes(direction))
      fail(`Invalid direction: ${direction}`)
    if (args.length > 0) fail(`Unexpected arguments: ${args.join(" ")}`)
    if (!byId.has(eventId)) fail(`Event not found: ${eventId}`)
    const children = new Map()
    for (const [childId, parentIds] of acceptedParentsByEventId) {
      for (const parentId of parentIds) {
        const list = children.get(parentId) ?? []
        list.push(childId)
        children.set(parentId, list)
      }
    }
    const selected = new Set([eventId])
    const queue = [{ eventId, depth: 0 }]
    while (queue.length > 0 && selected.size < maxNodes) {
      const current = queue.shift()
      if (current.depth >= depth) continue
      const event = byId.get(current.eventId)
      const related = [
        ...(direction !== "descendants" ? (acceptedParentsByEventId.get(event.eventId) ?? []) : []),
        ...(direction !== "ancestors" ? (children.get(current.eventId) ?? []) : [])
      ]
      for (const relatedId of related) {
        if (selected.has(relatedId) || !byId.has(relatedId)) continue
        selected.add(relatedId)
        queue.push({ eventId: relatedId, depth: current.depth + 1 })
        if (selected.size >= maxNodes) break
      }
    }
    const nodes = []
    for (const id of selected) {
      const event = byId.get(id)
      const candidateNodes = [
        ...nodes,
        compactEvent(event, false, acceptedParentsByEventId.get(event.eventId) ?? [])
      ]
      const candidateIds = new Set(candidateNodes.map((node) => node.eventId))
      const candidateEdges = candidateNodes.flatMap((node) =>
        node.parentEventIds
          .filter((parentId) => candidateIds.has(parentId))
          .map((parentId) => ({ from: parentId, to: node.eventId }))
      )
      const payload = {
        depth,
        direction,
        edges: candidateEdges,
        nodes: candidateNodes,
        rootEventId: eventId,
        scanTruncated: journal.scanTruncated,
        truncated: selected.size > candidateNodes.length
      }
      if (encodedBytes(payload) > MAX_OUTPUT_BYTES) break
      nodes.push(candidateNodes.at(-1))
    }
    const nodeIds = new Set(nodes.map((node) => node.eventId))
    const edges = nodes.flatMap((node) =>
      node.parentEventIds
        .filter((parentId) => nodeIds.has(parentId))
        .map((parentId) => ({ from: parentId, to: node.eventId }))
    )
    emit({
      depth,
      direction,
      edges,
      nodes,
      rootEventId: eventId,
      scanTruncated: journal.scanTruncated,
      truncated: selected.size >= maxNodes || nodes.length < selected.size
    })
    return
  }

  fail(USAGE)
}

run().catch((error) => {
  process.stderr.write(
    `${sanitizeText(error instanceof Error ? error.message : "Inspector failed.")}\n`
  )
  process.exitCode = error instanceof InspectorCliError ? 2 : 1
})
