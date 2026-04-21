export const OPENWORK_IPC_ERROR_PREFIX = "__OPENWORK_IPC_ERROR__:"

export const IPC_ERROR_STATUS_BY_CODE = {
  CANCELLED: 499,
  CONFLICT: 409,
  FAILED_PRECONDITION: 412,
  INTERNAL: 500,
  INVALID_ARGUMENT: 400,
  NOT_FOUND: 404,
  PERMISSION_DENIED: 403,
  UNAUTHENTICATED: 401,
  UNAVAILABLE: 503
} as const

export type IpcErrorCode = keyof typeof IPC_ERROR_STATUS_BY_CODE

export interface IpcErrorPayload {
  channel?: string
  code: IpcErrorCode
  details?: string[]
  message: string
  status: number
}

function normalizeDetails(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const details = value.filter((entry): entry is string => typeof entry === "string")
  return details.length > 0 ? details : undefined
}

export function isIpcErrorCode(value: unknown): value is IpcErrorCode {
  return typeof value === "string" && value in IPC_ERROR_STATUS_BY_CODE
}

export function getIpcErrorStatus(code: IpcErrorCode): number {
  return IPC_ERROR_STATUS_BY_CODE[code]
}

export function serializeIpcErrorPayload(payload: IpcErrorPayload): string {
  return `${OPENWORK_IPC_ERROR_PREFIX}${JSON.stringify(payload)}`
}

export function parseSerializedIpcErrorMessage(message: string): IpcErrorPayload | null {
  if (!message.startsWith(OPENWORK_IPC_ERROR_PREFIX)) {
    return null
  }

  try {
    const parsed = JSON.parse(message.slice(OPENWORK_IPC_ERROR_PREFIX.length)) as {
      channel?: unknown
      code?: unknown
      details?: unknown
      message?: unknown
      status?: unknown
    }

    if (!isIpcErrorCode(parsed.code) || typeof parsed.message !== "string") {
      return null
    }

    return {
      ...(typeof parsed.channel === "string" ? { channel: parsed.channel } : {}),
      code: parsed.code,
      ...(normalizeDetails(parsed.details) ? { details: normalizeDetails(parsed.details) } : {}),
      message: parsed.message,
      status:
        typeof parsed.status === "number" ? parsed.status : getIpcErrorStatus(parsed.code)
    }
  } catch {
    return null
  }
}

export function extractIpcErrorPayload(value: unknown): IpcErrorPayload | null {
  if (typeof value === "string") {
    return parseSerializedIpcErrorMessage(value)
  }

  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Record<string, unknown>
  if (typeof record.message === "string") {
    const serializedPayload = parseSerializedIpcErrorMessage(record.message)
    if (serializedPayload) {
      return serializedPayload
    }
  }

  const code = isIpcErrorCode(record.code)
    ? record.code
    : isIpcErrorCode(record.name)
      ? record.name
      : null
  if (!code || typeof record.message !== "string") {
    return null
  }

  return {
    ...(typeof record.channel === "string" ? { channel: record.channel } : {}),
    code,
    ...(normalizeDetails(record.details) ? { details: normalizeDetails(record.details) } : {}),
    message: record.message,
    status: typeof record.status === "number" ? record.status : getIpcErrorStatus(code)
  }
}
