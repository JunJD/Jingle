import { z } from "zod/v4"

export type DiagnosticRendererErrorKind = "error" | "unhandledrejection"

export interface DiagnosticRendererErrorReport {
  kind: DiagnosticRendererErrorKind
  message: string
  stack?: string
  source?: string
  windowKind?: string
}

export const diagnosticSupportPacketCoverageSchema = z.enum([
  "causal-events-observed",
  "no-failure-events-observed",
  "legacy-only",
  "empty"
])

export type DiagnosticSupportPacketCoverage = z.infer<typeof diagnosticSupportPacketCoverageSchema>

export const diagnosticSupportPacketFailureCodeSchema = z.enum([
  "bounds_exceeded",
  "destination_incomplete",
  "destination_unavailable",
  "destination_unsafe",
  "integrity_failed",
  "platform_unavailable",
  "source_changed",
  "source_unavailable",
  "source_unsafe",
  "unexpected"
])

export type DiagnosticSupportPacketFailureCode = z.infer<
  typeof diagnosticSupportPacketFailureCodeSchema
>

export const diagnosticSupportPacketExportResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cancelled") }).strict(),
  z
    .object({
      coverage: diagnosticSupportPacketCoverageSchema,
      eventCount: z.number().int().nonnegative(),
      evidenceCount: z.number().int().nonnegative(),
      gapCount: z.number().int().nonnegative(),
      kind: z.literal("exported"),
      packetId: z.string().min(1).max(64)
    })
    .strict(),
  z
    .object({
      code: diagnosticSupportPacketFailureCodeSchema,
      kind: z.literal("failed")
    })
    .strict()
])

export type DiagnosticSupportPacketExportResult = z.infer<
  typeof diagnosticSupportPacketExportResultSchema
>
