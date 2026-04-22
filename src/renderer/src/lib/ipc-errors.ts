import type { IpcErrorPayload } from "@shared/ipc-error"
import { extractIpcErrorPayload } from "@shared/ipc-error"

export function getIpcErrorPayload(error: unknown): IpcErrorPayload | null {
  return extractIpcErrorPayload(error)
}

export function getIpcErrorDisplayMessage(error: unknown, fallback: string): string {
  const payload = getIpcErrorPayload(error)
  if (payload) {
    return payload.message
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === "string" && error.length > 0) {
    return error
  }

  return fallback
}
