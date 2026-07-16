import { types } from "node:util"

const DEFAULT_MAX_EVIDENCE_BYTES = 64 * 1024
const MAX_ARRAY_ITEMS = 64
const MAX_DEPTH = 8
const MAX_SANITIZED_BYTES = 512 * 1024
const MAX_STRING_LENGTH = 16_000
const MAX_VISITED_NODES = 512
const REDACTED = "[REDACTED]"
const REDACTED_PATH = "[REDACTED_PATH]"
const TRUNCATED = "[truncated]"
const AUTH_SCHEME_PATTERN = /\b(Basic|Bearer)\s+[^\s,;]+/gi
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*(?![A-Za-z0-9_-])/g
const PEM_PATTERN = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/gi
const PREFIXED_SECRET_PATTERN = /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,})\b/gi
const SECRET_ASSIGNMENT_PATTERN =
  /\b(access[_-]?tokens?|api[_-]?key|auth|authorization|client[_-]?secrets?|cookies?|credentials?|headers?|id[_-]?tokens?|passwords?|private[_-]?key|refresh[_-]?tokens?|secrets?|tokens?)\s*[:=]\s*(?:\\"(?:\\.|[^"\\])*\\"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi
const QUOTED_SECRET_PROPERTY_PATTERN =
  /("(?:access[_-]?tokens?|api[_-]?key|authorization|client[_-]?secrets?|cookies?|credentials?|headers?|id[_-]?tokens?|messages|passwords?|prompts?|refresh[_-]?tokens?|secrets?|tokens?)"\s*:\s*)"(?:\\.|[^"\\])*"/gi
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

export interface DiagnosticTraversalBudget {
  bytesRemaining: number
  nodesRemaining: number
  seen: WeakSet<object>
}

export interface SerializedDiagnosticEvidence {
  originalSizeBytes: number
  serialized: string
  sizeBytes: number
  truncated: boolean
}

function truncateText(value: string, maxLength: number): string {
  const boundedMaxLength = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : 0
  if (value.length <= boundedMaxLength) {
    return value
  }
  if (boundedMaxLength <= TRUNCATED.length) {
    return TRUNCATED.slice(0, boundedMaxLength)
  }
  return `${value.slice(0, boundedMaxLength - TRUNCATED.length)}${TRUNCATED}`
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8")
  if (buffer.length <= maxBytes) {
    return value
  }
  let end = Math.max(0, maxBytes)
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
    end -= 1
  }
  return buffer.subarray(0, end).toString("utf8")
}

function sanitizeEmbeddedJson(value: string): string {
  const candidates = [
    { close: "}", open: "{" },
    { close: "]", open: "[" }
  ]
    .map(({ close, open }) => ({ end: value.lastIndexOf(close), start: value.indexOf(open) }))
    .filter(({ end, start }) => start >= 0 && end > start)
    .sort((left, right) => left.start - right.start)
  for (const { end, start } of candidates) {
    const fragment = value.slice(start, end + 1)
    for (const candidate of [fragment, fragment.replace(/\\"/g, '"')]) {
      try {
        const parsed = JSON.parse(candidate) as unknown
        const sanitized = JSON.stringify(sanitizeDiagnosticValue(parsed))
        return `${value.slice(0, start)}${sanitized}${value.slice(end + 1)}`
      } catch {
        continue
      }
    }
  }
  return value
}

function redactUrls(value: string): string {
  return value.replace(URL_PATTERN, (candidate) => {
    try {
      const url = new URL(candidate)
      if (url.protocol === "file:") {
        return REDACTED_PATH
      }
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
}

function clipString(value: string): string {
  const boundedValue = truncateText(value, MAX_STRING_LENGTH)
  let sanitized = boundedValue
  sanitized = sanitized
    .replace(PEM_PATTERN, REDACTED)
    .replace(AUTH_SCHEME_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(PREFIXED_SECRET_PATTERN, REDACTED)
    .replace(JWT_PATTERN, REDACTED)
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=${REDACTED}`)
    .replace(QUOTED_SECRET_PROPERTY_PATTERN, (_match, prefix: string) => {
      return `${prefix}"${REDACTED}"`
    })
  sanitized = redactUrls(sanitized)
    .replace(MULTI_SLASH_ABSOLUTE_PATH_PATTERN, (_match, prefix: string) => {
      return `${prefix}${REDACTED_PATH}`
    })
    .replace(POSIX_ABSOLUTE_PATH_PATTERN, (_match, prefix: string) => {
      return `${prefix}${REDACTED_PATH}`
    })
    .replace(WINDOWS_DEVICE_PATH_PATTERN, (_match, prefix: string) => {
      return `${prefix}${REDACTED_PATH}`
    })
    .replace(WINDOWS_UNC_PATH_PATTERN, (_match, prefix: string) => {
      return `${prefix}${REDACTED_PATH}`
    })
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, (_match, prefix: string) => {
      return `${prefix}${REDACTED_PATH}`
    })
  sanitized = sanitizeEmbeddedJson(sanitized)
  return truncateText(sanitized, MAX_STRING_LENGTH)
}

function isSensitiveKey(key: string): boolean {
  const canonical = key.replace(/[^a-z0-9]/gi, "").toLowerCase()
  return (
    /(?:authorization|cookies?|credentials?|env|environment|headers?|messagecontent|messages|passwords?|prompts?|secrets?|tokens?|apikey|privatekey)$/.test(
      canonical
    ) ||
    /^(?:auth|env|environment|headers?|messages|prompts?|stderr|stdout|tokens)$/.test(canonical)
  )
}

export function sanitizeDiagnosticText(value: string, maxLength: number, key = ""): string {
  if (isSensitiveKey(key)) {
    return REDACTED
  }
  return truncateText(clipString(value), maxLength)
}

function consumeString(value: string, context: DiagnosticTraversalBudget): string {
  if (context.bytesRemaining <= 0) {
    return "[byte-budget-exhausted]"
  }
  const sanitized = clipString(value)
  const bounded = truncateUtf8(sanitized, context.bytesRemaining)
  context.bytesRemaining = Math.max(0, context.bytesRemaining - Buffer.byteLength(bounded, "utf8"))
  return bounded.length === sanitized.length ? bounded : `${bounded}${TRUNCATED}`
}

type DataPropertySnapshot =
  | { kind: "absent" }
  | { kind: "data"; value: unknown }
  | { kind: "unsafe" }

const NATIVE_ERROR_CONSTRUCTOR = Error
const TRUSTED_ERROR_PREPARE_STACK_TRACE = captureDataPropertySnapshot(
  NATIVE_ERROR_CONSTRUCTOR,
  "prepareStackTrace"
)
const TRUSTED_NATIVE_STACK_GETTER = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(new NATIVE_ERROR_CONSTRUCTOR(), "stack")
  return descriptor && !("value" in descriptor) && typeof descriptor.get === "function"
    ? descriptor.get
    : null
})()

function captureDataPropertySnapshot(value: object, key: PropertyKey): DataPropertySnapshot {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) {
      return { kind: "absent" }
    }
    return "value" in descriptor ? { kind: "data", value: descriptor.value } : { kind: "unsafe" }
  } catch {
    return { kind: "unsafe" }
  }
}

function hasUnchangedErrorPrepareStackTrace(): boolean {
  const current = captureDataPropertySnapshot(NATIVE_ERROR_CONSTRUCTOR, "prepareStackTrace")
  if (TRUSTED_ERROR_PREPARE_STACK_TRACE.kind === "absent") {
    return current.kind === "absent"
  }
  return (
    TRUSTED_ERROR_PREPARE_STACK_TRACE.kind === "data" &&
    current.kind === "data" &&
    current.value === TRUSTED_ERROR_PREPARE_STACK_TRACE.value
  )
}

function hasSafeStringProperty(value: object, key: "message" | "name"): boolean {
  let current: object | null = value
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (types.isProxy(current)) {
      return false
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(current, key)
      if (descriptor) {
        return "value" in descriptor && typeof descriptor.value === "string"
      }
      current = Object.getPrototypeOf(current) as object | null
    } catch {
      return false
    }
  }
  return false
}

function readTrustedNativeErrorStack(value: object): unknown {
  if (
    !hasUnchangedErrorPrepareStackTrace() ||
    !hasSafeStringProperty(value, "name") ||
    !hasSafeStringProperty(value, "message")
  ) {
    return undefined
  }
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, "stack")
  } catch {
    return undefined
  }
  if (!descriptor || "value" in descriptor) {
    return descriptor?.value
  }
  if (!TRUSTED_NATIVE_STACK_GETTER || descriptor.get !== TRUSTED_NATIVE_STACK_GETTER) {
    return undefined
  }
  try {
    const stack = Reflect.apply(TRUSTED_NATIVE_STACK_GETTER, value, []) as unknown
    return typeof stack === "string" ? stack : undefined
  } catch {
    return undefined
  }
}

function readOwnDataProperty(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && "value" in descriptor ? descriptor.value : undefined
  } catch {
    return "[unreadable-property]"
  }
}

function isErrorObject(value: object): boolean {
  try {
    return types.isNativeError(value)
  } catch {
    return false
  }
}

function readNativeErrorName(value: object): string {
  try {
    const prototype = Object.getPrototypeOf(value) as object | null
    if (!prototype || types.isProxy(prototype)) {
      return "Error"
    }
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "name")
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : "Error"
  } catch {
    return "Error"
  }
}

function readArrayEntries(value: unknown[]): unknown[] | null {
  const entries: unknown[] = []
  try {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length")
    const length =
      lengthDescriptor &&
      "value" in lengthDescriptor &&
      Number.isSafeInteger(lengthDescriptor.value)
        ? Math.min(Math.max(0, lengthDescriptor.value as number), MAX_ARRAY_ITEMS)
        : 0
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor) {
        continue
      }
      entries.push("value" in descriptor ? descriptor.value : "[accessor]")
    }
  } catch {
    return null
  }
  return entries
}

function sanitizeValue(
  value: unknown,
  key: string,
  depth: number,
  context: DiagnosticTraversalBudget
): unknown {
  if (isSensitiveKey(key)) {
    return REDACTED
  }
  if (context.nodesRemaining <= 0) {
    return "[node-budget-exhausted]"
  }
  context.nodesRemaining -= 1
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value
  }
  if (typeof value === "bigint") {
    return consumeString(value.toString(), context)
  }
  if (typeof value === "string") {
    return consumeString(value, context)
  }
  if (typeof value === "undefined") {
    return null
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`
  }
  if (depth >= MAX_DEPTH) {
    return "[max-depth]"
  }
  if (typeof value !== "object") {
    return consumeString(String(value), context)
  }
  if (types.isProxy(value)) {
    return "[proxy]"
  }
  if (context.seen.has(value)) {
    return "[circular]"
  }
  context.seen.add(value)

  if (isErrorObject(value)) {
    const details: Record<string, unknown> = {}
    for (const field of [
      "name",
      "message",
      "stack",
      "address",
      "code",
      "errno",
      "path",
      "port",
      "syscall",
      "cause",
      "errors"
    ]) {
      const fieldValue =
        field === "stack" ? readTrustedNativeErrorStack(value) : readOwnDataProperty(value, field)
      if (fieldValue !== undefined) {
        details[field] = sanitizeValue(fieldValue, field, depth + 1, context)
      }
    }
    if (!("name" in details)) {
      details["name"] = sanitizeValue(readNativeErrorName(value), "name", depth + 1, context)
    }
    return details
  }

  let isArray = false
  try {
    isArray = Array.isArray(value)
  } catch {
    return "[unreadable-object]"
  }
  if (isArray) {
    const entries = readArrayEntries(value as unknown[])
    if (!entries) {
      return "[unreadable-array]"
    }
    const sanitized: unknown[] = []
    for (const entry of entries) {
      if (
        sanitized.length >= MAX_ARRAY_ITEMS ||
        context.nodesRemaining <= 0 ||
        context.bytesRemaining <= 0
      ) {
        break
      }
      sanitized.push(sanitizeValue(entry, "", depth + 1, context))
    }
    return sanitized
  }
  return "[object-omitted]"
}

export function createDiagnosticTraversalBudget(
  maxBytes = MAX_SANITIZED_BYTES
): DiagnosticTraversalBudget {
  const boundedMaxBytes = Number.isFinite(maxBytes)
    ? Math.min(MAX_SANITIZED_BYTES, Math.max(128, Math.floor(maxBytes)))
    : MAX_SANITIZED_BYTES
  return {
    bytesRemaining: boundedMaxBytes,
    nodesRemaining: MAX_VISITED_NODES,
    seen: new WeakSet()
  }
}

export function sanitizeDiagnosticValue(
  value: unknown,
  maxBytes = MAX_SANITIZED_BYTES,
  budget?: DiagnosticTraversalBudget
): unknown {
  const boundedMaxBytes = Number.isFinite(maxBytes)
    ? Math.min(MAX_SANITIZED_BYTES, Math.max(128, Math.floor(maxBytes)))
    : MAX_SANITIZED_BYTES
  const sanitized = sanitizeValue(
    value,
    "",
    0,
    budget ?? createDiagnosticTraversalBudget(boundedMaxBytes)
  )
  const serialized = JSON.stringify(sanitized)
  if (Buffer.byteLength(serialized, "utf8") <= boundedMaxBytes) {
    return sanitized
  }
  let previewBytes = Math.max(0, boundedMaxBytes - 64)
  let bounded = {
    preview: truncateUtf8(serialized, previewBytes),
    truncated: true
  }
  while (Buffer.byteLength(JSON.stringify(bounded), "utf8") > boundedMaxBytes && previewBytes > 0) {
    previewBytes = Math.max(0, previewBytes - 16)
    bounded = {
      preview: truncateUtf8(serialized, previewBytes),
      truncated: true
    }
  }
  return bounded
}

export function serializeDiagnosticEvidence(
  value: unknown,
  maxBytes = DEFAULT_MAX_EVIDENCE_BYTES,
  budget?: DiagnosticTraversalBudget
): SerializedDiagnosticEvidence {
  const boundedMaxBytes = Number.isFinite(maxBytes)
    ? Math.min(DEFAULT_MAX_EVIDENCE_BYTES, Math.max(128, Math.floor(maxBytes)))
    : DEFAULT_MAX_EVIDENCE_BYTES
  const sanitized = sanitizeDiagnosticValue(
    value,
    Math.min(MAX_SANITIZED_BYTES, boundedMaxBytes * 2),
    budget
  )
  const serialized = JSON.stringify(sanitized)
  const originalSizeBytes = Buffer.byteLength(serialized, "utf8")
  if (originalSizeBytes <= boundedMaxBytes) {
    return {
      originalSizeBytes,
      serialized,
      sizeBytes: originalSizeBytes,
      truncated: false
    }
  }

  let previewBytes = Math.max(0, boundedMaxBytes - 512)
  let truncatedSerialized = JSON.stringify({
    originalSizeBytes,
    preview: truncateUtf8(serialized, previewBytes),
    truncated: true
  })
  while (Buffer.byteLength(truncatedSerialized, "utf8") > boundedMaxBytes && previewBytes > 0) {
    previewBytes = Math.max(0, previewBytes - 512)
    truncatedSerialized = JSON.stringify({
      originalSizeBytes,
      preview: truncateUtf8(serialized, previewBytes),
      truncated: true
    })
  }
  return {
    originalSizeBytes,
    serialized: truncatedSerialized,
    sizeBytes: Buffer.byteLength(truncatedSerialized, "utf8"),
    truncated: true
  }
}
