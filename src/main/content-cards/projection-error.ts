import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { ASSISTANT_CONTENT_PROJECTION_ERROR_MAX_LENGTH } from "@shared/assistant-content-part"
import { sanitizeDiagnosticText } from "../diagnostics/redaction"

export const ASSISTANT_CONTENT_PROJECTION_MAX_ATTEMPTS = 4
export const ASSISTANT_CONTENT_PROJECTION_ERROR_FALLBACK =
  "Assistant content projection failed without a diagnostic message."

export type ProjectionFailure =
  | {
      code: "execution-interrupted" | "persistence-unavailable"
      kind: "retryable"
    }
  | {
      code: "projection-contract-invalid" | "unexpected"
      kind: "terminal"
    }

export class AssistantContentProjectionFailureError extends Error {
  constructor(
    readonly failure: ProjectionFailure,
    readonly failureCause: unknown
  ) {
    super(`Assistant content projection failed with ${failure.code}.`)
    this.name = "AssistantContentProjectionFailureError"
  }
}

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

export function asAssistantContentProjectionPersistenceFailure(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    return new AssistantContentProjectionFailureError(
      { code: "persistence-unavailable", kind: "retryable" },
      error
    )
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return new AssistantContentProjectionFailureError(
      { code: "projection-contract-invalid", kind: "terminal" },
      error
    )
  }
  return error
}

export function classifyAssistantContentProjectionFailure(error: unknown): ProjectionFailure {
  if (error instanceof AssistantContentProjectionFailureError) return error.failure
  return { code: "unexpected", kind: "terminal" }
}

export function assistantContentProjectionFailureCause(error: unknown): unknown {
  return error instanceof AssistantContentProjectionFailureError ? error.failureCause : error
}

export function summarizeAssistantContentProjectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const sanitized = sanitizeDiagnosticText(
    message,
    ASSISTANT_CONTENT_PROJECTION_ERROR_MAX_LENGTH,
    "projectionError"
  )
  return sanitized.trim() ? sanitized : ASSISTANT_CONTENT_PROJECTION_ERROR_FALLBACK
}
