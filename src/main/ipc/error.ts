import type { IpcErrorCode, IpcErrorPayload } from "@shared/ipc-error"
import { getIpcErrorStatus, isIpcErrorCode, serializeIpcErrorPayload } from "@shared/ipc-error"
import { IpcSchemaValidationError } from "./schema"

interface JingleIpcErrorOptions {
  channel?: string
  code: IpcErrorCode
  details?: string[]
  message: string
  status?: number
}

export class JingleIpcError extends Error {
  readonly channel?: string
  readonly code: IpcErrorCode
  readonly details?: string[]
  readonly status: number

  constructor(options: JingleIpcErrorOptions) {
    super(options.message)
    this.name = options.code
    this.channel = options.channel
    this.code = options.code
    this.status = resolveIpcErrorStatus(options.status, options.code)
    this.details = options.details
  }

  toPayload(): IpcErrorPayload {
    const payload: IpcErrorPayload = {
      code: this.code,
      message: this.message,
      status: this.status
    }
    if (this.channel) {
      payload.channel = this.channel
    }
    if (this.details) {
      payload.details = this.details
    }

    return payload
  }
}

function resolveIpcErrorStatus(status: number | undefined, code: IpcErrorCode): number {
  if (typeof status === "number") {
    return status
  }

  return getIpcErrorStatus(code)
}

function readErrorCode(error: Error): IpcErrorCode | null {
  const record = error as Error & { code?: unknown }
  if (isIpcErrorCode(record.code)) {
    return record.code
  }

  return null
}

function readUnknownIpcErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return "Unknown IPC error"
}

export function buildIpcError(channel: string, error: unknown): JingleIpcError {
  if (error instanceof JingleIpcError) {
    return error
  }

  if (error instanceof IpcSchemaValidationError) {
    return new JingleIpcError({
      channel,
      code: "INVALID_ARGUMENT",
      details: error.issues,
      message: error.message
    })
  }

  if (error instanceof Error) {
    const code = readErrorCode(error)
    if (code) {
      return new JingleIpcError({
        channel,
        code,
        message: error.message
      })
    }
  }

  return new JingleIpcError({
    channel,
    code: "INTERNAL",
    message: readUnknownIpcErrorMessage(error)
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
  const event = {
    code: payload.code,
    error: payload.message,
    message: payload.message,
    status: payload.status
  }
  if (payload.channel) {
    const eventWithChannel = {
      ...event,
      channel: payload.channel
    }
    if (payload.details) {
      return {
        ...eventWithChannel,
        details: payload.details
      }
    }

    return eventWithChannel
  }

  if (payload.details) {
    return {
      ...event,
      details: payload.details
    }
  }

  return event
}
