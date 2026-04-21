import type { IpcErrorCode, IpcErrorPayload } from "@shared/ipc-error"
import { getIpcErrorStatus, serializeIpcErrorPayload } from "@shared/ipc-error"
import { IpcSchemaValidationError } from "./schema"

interface OpenworkIpcErrorOptions {
  channel?: string
  code: IpcErrorCode
  details?: string[]
  message: string
  status?: number
}

export class OpenworkIpcError extends Error {
  readonly channel?: string
  readonly code: IpcErrorCode
  readonly details?: string[]
  readonly status: number

  constructor(options: OpenworkIpcErrorOptions) {
    super(options.message)
    this.name = options.code
    this.channel = options.channel
    this.code = options.code
    this.status = options.status ?? getIpcErrorStatus(options.code)
    this.details = options.details
  }

  toPayload(): IpcErrorPayload {
    return {
      ...(this.channel ? { channel: this.channel } : {}),
      code: this.code,
      ...(this.details ? { details: this.details } : {}),
      message: this.message,
      status: this.status
    }
  }
}

export function buildIpcError(channel: string, error: unknown): OpenworkIpcError {
  if (error instanceof OpenworkIpcError) {
    return error
  }

  if (error instanceof IpcSchemaValidationError) {
    return new OpenworkIpcError({
      channel,
      code: "INVALID_ARGUMENT",
      details: error.issues,
      message: error.message
    })
  }

  return new OpenworkIpcError({
    channel,
    code: "INTERNAL",
    message: error instanceof Error && error.message ? error.message : "Unknown IPC error"
  })
}

export function buildIpcErrorPayload(channel: string, error: unknown): IpcErrorPayload {
  return buildIpcError(channel, error).toPayload()
}

export function buildSerializedIpcErrorMessage(channel: string, error: unknown): string {
  return serializeIpcErrorPayload(buildIpcErrorPayload(channel, error))
}

export function buildIpcErrorEvent(
  channel: string,
  error: unknown
): {
  channel?: string
  code: IpcErrorCode
  details?: string[]
  error: string
  message: string
  status: number
} {
  const payload = buildIpcErrorPayload(channel, error)

  return {
    ...(payload.channel ? { channel: payload.channel } : {}),
    code: payload.code,
    ...(payload.details ? { details: payload.details } : {}),
    error: payload.message,
    message: payload.message,
    status: payload.status
  }
}
