export const JINGLE_IPC_ERROR_PREFIX = "__JINGLE_IPC_ERROR__:"

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

interface IpcErrorPayloadRecord {
  channel?: unknown
  code?: unknown
  details?: unknown
  message?: unknown
  name?: unknown
  status?: unknown
}

function normalizeDetails(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const details = value.filter((entry): entry is string => typeof entry === "string")
  if (details.length === 0) {
    return undefined
  }

  return details
}

function getSerializedIpcErrorPayloadText(message: string): string | null {
  const prefixIndex = message.indexOf(JINGLE_IPC_ERROR_PREFIX)
  if (prefixIndex >= 0) {
    return message.slice(prefixIndex + JINGLE_IPC_ERROR_PREFIX.length)
  }

  return null
}

function normalizeIpcErrorStatus(value: unknown, code: IpcErrorCode): number {
  if (typeof value === "number") {
    return value
  }

  return getIpcErrorStatus(code)
}

function normalizeDecodedIpcErrorCode(record: Record<string, unknown>): IpcErrorCode | null {
  if (isIpcErrorCode(record.code)) {
    return record.code
  }

  if (isIpcErrorCode(record.name)) {
    return record.name
  }

  return null
}

function buildIpcErrorPayloadFromRecord(
  record: IpcErrorPayloadRecord,
  code: IpcErrorCode
): IpcErrorPayload | null {
  if (typeof record.message !== "string") {
    return null
  }

  const payload: IpcErrorPayload = {
    code,
    message: record.message,
    status: normalizeIpcErrorStatus(record.status, code)
  }
  if (typeof record.channel === "string") {
    payload.channel = record.channel
  }

  const details = normalizeDetails(record.details)
  if (details) {
    payload.details = details
  }

  return payload
}

export function isIpcErrorCode(value: unknown): value is IpcErrorCode {
  return typeof value === "string" && value in IPC_ERROR_STATUS_BY_CODE
}

export function getIpcErrorStatus(code: IpcErrorCode): number {
  return IPC_ERROR_STATUS_BY_CODE[code]
}

export function serializeIpcErrorPayload(payload: IpcErrorPayload): string {
  return `${JINGLE_IPC_ERROR_PREFIX}${JSON.stringify(payload)}`
}

export function parseSerializedIpcErrorMessage(message: string): IpcErrorPayload | null {
  const payloadText = getSerializedIpcErrorPayloadText(message)
  if (!payloadText) {
    return null
  }

  try {
    const parsed = JSON.parse(payloadText) as IpcErrorPayloadRecord

    if (!isIpcErrorCode(parsed.code)) {
      return null
    }

    return buildIpcErrorPayloadFromRecord(parsed, parsed.code)
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

  const code = normalizeDecodedIpcErrorCode(record)
  if (!code) {
    return null
  }

  return buildIpcErrorPayloadFromRecord(record, code)
}
