import { OpenworkIpcError } from "../ipc/error"

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
      if (
        fingerprint.includes("aborterror") ||
        fingerprint.includes("aborted") ||
        fingerprint.includes("controller is already closed")
      ) {
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
    if (
      fingerprint.includes("model_authentication") ||
      fingerprint.includes("invalid_api_key") ||
      fingerprint.includes("authentication_error") ||
      fingerprint.includes("authentication fails") ||
      (fingerprint.includes("401") && fingerprint.includes("authentication"))
    ) {
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
    if (
      code === "UND_ERR_SOCKET" ||
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      code === "UND_ERR_HEADERS_TIMEOUT" ||
      code === "UND_ERR_BODY_TIMEOUT" ||
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ENETDOWN" ||
      code === "ENETUNREACH" ||
      code === "EHOSTDOWN" ||
      code === "EHOSTUNREACH"
    ) {
      return true
    }

    const fingerprint = getErrorFingerprint(current)
    if (
      fingerprint === "typeerror terminated" ||
      fingerprint === "typeerror fetch failed" ||
      fingerprint.includes("socket hang up") ||
      fingerprint.includes("other side closed")
    ) {
      return true
    }

    queue.push(...errorCauseQueue(current))
  }

  return false
}

export function normalizeAgentRuntimeError(channel: string, error: unknown): unknown {
  if (isModelAuthenticationError(error)) {
    return new OpenworkIpcError({
      channel,
      code: "UNAUTHENTICATED",
      message: "Authentication failed. Please check your API key in settings."
    })
  }

  if (isTransportInterruptionError(error)) {
    return new OpenworkIpcError({
      channel,
      code: "UNAVAILABLE",
      details: ["The underlying model or network transport ended before the run completed."],
      message: "The agent connection was interrupted. Please retry this run."
    })
  }

  return error
}
