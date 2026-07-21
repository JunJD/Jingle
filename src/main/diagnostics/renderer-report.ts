import type { DiagnosticRendererErrorReport } from "@shared/diagnostics"
import type { WindowIdentity } from "../windows/window-identity"
import type { DiagnosticGraphEventInput, DiagnosticResourceRef } from "./schema"

const MAX_MESSAGE_LENGTH = 4000
const MAX_STACK_LENGTH = 12000
const MAX_SOURCE_LENGTH = 500

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

export function normalizeRendererErrorReport(
  input: unknown,
  windowKind?: WindowIdentity["kind"]
): DiagnosticRendererErrorReport {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const message = readString(record["message"], MAX_MESSAGE_LENGTH) ?? "Renderer error"
  const stack = readString(record["stack"], MAX_STACK_LENGTH)
  const source = readString(record["source"], MAX_SOURCE_LENGTH)

  return {
    kind: readKind(record["kind"]),
    message,
    ...(stack ? { stack } : {}),
    ...(source ? { source } : {}),
    ...(windowKind ? { windowKind } : {})
  }
}

function createRendererRefs(
  identity: WindowIdentity,
  webContentsId: unknown
): DiagnosticResourceRef[] {
  const refs: DiagnosticResourceRef[] = []
  if (
    typeof webContentsId === "number" &&
    Number.isSafeInteger(webContentsId) &&
    webContentsId > 0
  ) {
    refs.push({ id: String(webContentsId), kind: "web-contents" })
  }
  if (identity.kind === "main" || identity.kind === "thread-window") {
    refs.unshift({ id: identity.windowId, kind: "window" })
  }
  return refs
}

export function createRendererErrorDiagnostic(
  report: DiagnosticRendererErrorReport,
  identity: WindowIdentity,
  webContentsId: unknown
): DiagnosticGraphEventInput {
  const eventCode =
    report.kind === "unhandledrejection" ? "renderer.unhandled_rejection" : "renderer.global_error"
  return {
    component: "renderer",
    dimensionEntries: [
      { key: "kind", value: report.kind },
      { key: "windowKind", value: identity.kind }
    ],
    eventCode,
    fingerprint: `${eventCode}:${identity.kind}`,
    level: "error",
    operation: "observe-global-error",
    recoverable: true,
    refs: createRendererRefs(identity, webContentsId),
    stateImpact: "renderer_state_uncertain",
    summary:
      report.kind === "unhandledrejection"
        ? "Renderer reported an unhandled promise rejection"
        : "Renderer reported a global error"
  }
}
