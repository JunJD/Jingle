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
