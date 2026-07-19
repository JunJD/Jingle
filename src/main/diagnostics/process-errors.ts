import { types } from "node:util"
import { sanitizeDiagnosticValue } from "./redaction"
import type { FatalDiagnosticWriteOutcome } from "./electron-failure"

export interface SerializedProcessError {
  message: string
  name?: string
  stack?: string
}

export function serializeProcessError(error: unknown): SerializedProcessError {
  const sanitized = sanitizeDiagnosticValue(error, 16 * 1024)
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
    const record = sanitized as Record<string, unknown>
    return {
      message:
        typeof record["message"] === "string" ? record["message"] : "Non-Error process failure",
      name: typeof record["name"] === "string" ? record["name"] : undefined,
      stack: typeof record["stack"] === "string" ? record["stack"] : undefined
    }
  }

  return {
    message: typeof sanitized === "string" ? sanitized : "Non-Error process failure"
  }
}

export function errorFromUnhandledRejection(reason: unknown): Error {
  try {
    if (types.isNativeError(reason)) {
      return reason
    }
  } catch {
    // Fall through to the safe serialized representation.
  }

  return new Error(`Unhandled promise rejection: ${serializeProcessError(reason).message}`)
}

function formatFatalDiagnosticWriteStatus(
  logFilePath: string,
  outcome: FatalDiagnosticWriteOutcome
): string {
  switch (outcome.kind) {
    case "written":
      return `Diagnostics were written to: ${logFilePath}`
    case "partial":
      return `Some diagnostics were written to: ${logFilePath}`
    case "failed":
      return "Diagnostics could not be confirmed as written before Jingle quit."
    case "timed_out":
      return "Diagnostics did not finish writing before Jingle quit."
  }
}

export function formatFatalMainProcessError(
  error: unknown,
  logFilePath: string,
  diagnosticWriteOutcome: FatalDiagnosticWriteOutcome
): string {
  const serialized = serializeProcessError(error)
  return [
    serialized.message || "Jingle encountered an unrecoverable main process error.",
    "",
    formatFatalDiagnosticWriteStatus(logFilePath, diagnosticWriteOutcome),
    "",
    "Jingle will quit now. Please restart the app."
  ].join("\n")
}
