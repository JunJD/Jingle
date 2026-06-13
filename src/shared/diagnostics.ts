export type DiagnosticRendererErrorKind = "error" | "unhandledrejection"

export interface DiagnosticRendererErrorReport {
  kind: DiagnosticRendererErrorKind
  message: string
  stack?: string
  source?: string
  windowKind?: string
}
