import { createHash } from "node:crypto"
import { sanitizeDiagnosticText } from "../diagnostics/redaction"

export const ASSISTANT_CONTENT_PROJECTION_ERROR_MAX_LENGTH = 512

export class AssistantContentProjectionInputError extends Error {
  readonly code = "ASSISTANT_CONTENT_PROJECTION_INPUT_INVALID"

  constructor(readonly reason: "invalid-json" | "noncanonical") {
    super(`Assistant content projection rejected ${reason} persisted content.`)
    this.name = "AssistantContentProjectionInputError"
  }
}

export class AssistantContentProjectionDecodeError extends Error {
  readonly code = "ASSISTANT_CONTENT_PROJECTION_DERIVED_CORRUPT"

  constructor(readonly decodeCause: unknown) {
    super("Stored assistant content projection could not be decoded.")
    this.name = "AssistantContentProjectionDecodeError"
  }
}

export interface AssistantContentProjectionBlockedInput {
  messageId: string
  reason: AssistantContentProjectionInputError["reason"]
  sourceRevision: string
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

export function assistantContentProjectionSourceRevision(content: string): string {
  return sha256(content)
}

export function isAssistantContentProjectionDecodeError(
  error: unknown
): error is AssistantContentProjectionDecodeError {
  return error instanceof AssistantContentProjectionDecodeError
}

export function isAssistantContentProjectionInputError(
  error: unknown
): error is AssistantContentProjectionInputError {
  return error instanceof AssistantContentProjectionInputError
}

export function summarizeAssistantContentProjectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeDiagnosticText(
    message,
    ASSISTANT_CONTENT_PROJECTION_ERROR_MAX_LENGTH,
    "projectionError"
  )
}
