import type { DiagnosticRendererErrorReport } from "@shared/diagnostics"

const MAX_MESSAGE_LENGTH = 4000
const MAX_STACK_LENGTH = 12000
const MAX_SOURCE_LENGTH = 500
const MAX_WINDOW_KIND_LENGTH = 80

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function readString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? truncate(trimmed, maxLength) : undefined
}

function readKind(value: unknown): DiagnosticRendererErrorReport["kind"] {
  return value === "unhandledrejection" ? "unhandledrejection" : "error"
}

export function normalizeRendererErrorReport(input: unknown): DiagnosticRendererErrorReport {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const message = readString(record["message"], MAX_MESSAGE_LENGTH) ?? "Renderer error"
  const stack = readString(record["stack"], MAX_STACK_LENGTH)
  const source = readString(record["source"], MAX_SOURCE_LENGTH)
  const windowKind = readString(record["windowKind"], MAX_WINDOW_KIND_LENGTH)

  return {
    kind: readKind(record["kind"]),
    message,
    ...(stack ? { stack } : {}),
    ...(source ? { source } : {}),
    ...(windowKind ? { windowKind } : {})
  }
}
