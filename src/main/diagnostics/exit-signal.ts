import { constants as osConstants } from "node:os"

export function normalizeDiagnosticExitSignal(value: unknown): string {
  if (value === null) {
    return "none"
  }
  return typeof value === "string" && Object.hasOwn(osConstants.signals, value) ? value : "unknown"
}
