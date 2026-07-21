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

function errorReportFromUnhandledRejection(
  event: PromiseRejectionEvent
): DiagnosticRendererErrorReport {
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

export function sendRendererErrorReport(
  report: DiagnosticRendererErrorReport,
  reporter: (input: DiagnosticRendererErrorReport) => Promise<void> = (input) =>
    window.api.diagnostics.reportRendererError(input)
): void {
  try {
    void Promise.resolve(reporter(report)).then(undefined, () => undefined)
  } catch {
    // A failed diagnostic report cannot become another global renderer error.
  }
}

export function installRendererDiagnostics(): void {
  window.addEventListener("error", (event) => {
    sendRendererErrorReport(errorReportFromErrorEvent(event))
  })

  window.addEventListener("unhandledrejection", (event) => {
    sendRendererErrorReport(errorReportFromUnhandledRejection(event))
  })
}
