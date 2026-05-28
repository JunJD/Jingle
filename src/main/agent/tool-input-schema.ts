import { ZodError } from "zod/v4"
import type { ExtensionToolSchema } from "@shared/extension-sources"
export { z } from "zod/v4"

export class ToolSchemaValidationError extends Error {
  readonly issues: string[]
  readonly toolName: string

  constructor(toolName: string, issues: string[]) {
    const detail = issues.length > 0 ? ` ${issues.join("; ")}` : ""
    super(`${toolName} input validation failed.${detail}`)
    this.name = "ToolSchemaValidationError"
    this.toolName = toolName
    this.issues = issues
  }
}

export function formatToolSchemaIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "$"
    return `${path}: ${issue.message}`
  })
}

function isZodErrorLike(error: unknown): error is { issues: ZodError["issues"] } {
  return (
    error instanceof ZodError ||
    (typeof error === "object" &&
      error !== null &&
      Array.isArray((error as { issues?: unknown }).issues))
  )
}

export async function parseToolInputWithSchema<TInput>(
  toolName: string,
  schema: ExtensionToolSchema<TInput>,
  value: unknown
): Promise<TInput> {
  try {
    return await schema.parseAsync(value)
  } catch (error) {
    if (isZodErrorLike(error)) {
      throw new ToolSchemaValidationError(toolName, formatToolSchemaIssues(error as ZodError))
    }

    throw error
  }
}
