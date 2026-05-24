import type { IpcErrorCode, IpcErrorPayload } from "@shared/ipc-error"
import { extractIpcErrorPayload } from "@shared/ipc-error"

export class OpenworkIpcClientError extends Error {
  readonly channel?: string
  readonly code: IpcErrorCode
  readonly details?: string[]
  readonly status: number

  constructor(payload: IpcErrorPayload) {
    super(payload.message)
    this.name = payload.code
    this.channel = payload.channel
    this.code = payload.code
    this.status = payload.status
    this.details = payload.details
  }
}

export function normalizeInvokeError(error: unknown): Error {
  const payload = extractIpcErrorPayload(error)
  if (payload) {
    return new OpenworkIpcClientError(payload)
  }

  return error instanceof Error ? error : new Error(String(error))
}
