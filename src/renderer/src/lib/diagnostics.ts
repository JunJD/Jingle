import type { DiagnosticRendererErrorReport } from "@shared/diagnostics"

function getWindowKind(): string {
  return document.documentElement.dataset.window ?? "main"
}

function errorReportFromErrorEvent(event: ErrorEvent): DiagnosticRendererErrorReport {
  return {
    kind: "error",
    message: event.message || "Renderer error",
    source: event.filename,
    stack: event.error instanceof Error ? event.error.stack : undefined,
    windowKind: getWindowKind()
  }
}

function errorReportFromUnhandledRejection(event: PromiseRejectionEvent): DiagnosticRendererErrorReport {
  const reason = event.reason
  if (reason instanceof Error) {
    return {
      kind: "unhandledrejection",
      message: reason.message,
      stack: reason.stack,
      windowKind: getWindowKind()
    }
  }

  return {
    kind: "unhandledrejection",
    message: typeof reason === "string" ? reason : "Unhandled renderer promise rejection",
    windowKind: getWindowKind()
  }
}

function sendRendererErrorReport(report: DiagnosticRendererErrorReport): void {
  void window.api.diagnostics.reportRendererError(report).catch((error) => {
    console.error("[Diagnostics] Failed to report renderer error:", error)
  })
}

export function installRendererDiagnostics(): void {
  window.addEventListener("error", (event) => {
    sendRendererErrorReport(errorReportFromErrorEvent(event))
  })

  window.addEventListener("unhandledrejection", (event) => {
    sendRendererErrorReport(errorReportFromUnhandledRejection(event))
  })
}
