import { JingleIpcError } from "../ipc/error"

const ABORT_FINGERPRINT_PATTERN = /aborterror|aborted|controller is already closed/

const MODEL_AUTHENTICATION_FINGERPRINT_PATTERN =
  /model_authentication|invalid_api_key|authentication_error|authentication fails/
const MODEL_AUTHENTICATION_STATUS_PATTERN = /(?:401.*authentication|authentication.*401)/

const TRANSPORT_INTERRUPTION_CODES = new Set([
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTDOWN",
  "EHOSTUNREACH"
])

const TRANSPORT_INTERRUPTION_FINGERPRINTS = new Set([
  "typeerror terminated",
  "typeerror fetch failed"
])

const TRANSPORT_INTERRUPTION_FINGERPRINT_PATTERN = /socket hang up|other side closed/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getErrorLikeCause(value: unknown): unknown {
  if (!isRecord(value)) {
    return null
  }

  return "cause" in value ? value.cause : null
}

export function isAbortLikeError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return true
  }

  const visited = new Set<unknown>()
  const queue: unknown[] = [error]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) {
      continue
    }

    visited.add(current)

    if (current instanceof Error) {
      const fingerprint = `${current.name} ${current.message}`.toLowerCase()
      if (ABORT_FINGERPRINT_PATTERN.test(fingerprint)) {
        return true
      }

      const cause = getErrorLikeCause(current)
      if (cause) {
        queue.push(cause)
      }
      continue
    }

    const cause = getErrorLikeCause(current)
    if (cause) {
      queue.push(cause)
    }
  }

  return false
}

function getErrorFingerprint(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name} ${value.message}`.toLowerCase()
  }

  return typeof value === "string" ? value.toLowerCase() : ""
}

function getErrorCode(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  return typeof value.code === "string" ? value.code : null
}

function errorCauseQueue(error: unknown): unknown[] {
  const queue: unknown[] = []
  const cause = getErrorLikeCause(error)
  if (cause) {
    queue.push(cause)
  }
  return queue
}

export function isModelAuthenticationError(error: unknown): boolean {
  const visited = new Set<unknown>()
  const queue: unknown[] = [error]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) {
      continue
    }

    visited.add(current)

    const fingerprint = getErrorFingerprint(current)
    if (MODEL_AUTHENTICATION_FINGERPRINT_PATTERN.test(fingerprint)) {
      return true
    }

    if (MODEL_AUTHENTICATION_STATUS_PATTERN.test(fingerprint)) {
      return true
    }

    queue.push(...errorCauseQueue(current))
  }

  return false
}

export function isTransportInterruptionError(error: unknown): boolean {
  const visited = new Set<unknown>()
  const queue: unknown[] = [error]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) {
      continue
    }

    visited.add(current)

    const code = getErrorCode(current)
    if (code && TRANSPORT_INTERRUPTION_CODES.has(code)) {
      return true
    }

    const fingerprint = getErrorFingerprint(current)
    if (
      TRANSPORT_INTERRUPTION_FINGERPRINTS.has(fingerprint) ||
      TRANSPORT_INTERRUPTION_FINGERPRINT_PATTERN.test(fingerprint)
    ) {
      return true
    }

    queue.push(...errorCauseQueue(current))
  }

  return false
}

export function normalizeAgentRuntimeError(channel: string, error: unknown): unknown {
  if (isModelAuthenticationError(error)) {
    return new JingleIpcError({
      channel,
      code: "UNAUTHENTICATED",
      message: "Authentication failed. Please check your API key in settings."
    })
  }

  if (isTransportInterruptionError(error)) {
    return new JingleIpcError({
      channel,
      code: "UNAVAILABLE",
      details: ["The underlying model or network transport ended before the run completed."],
      message: "The agent connection was interrupted. Please retry this run."
    })
  }

  return error
}
