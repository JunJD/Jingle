import { ZodError, type ZodType } from "zod/v4"
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

export async function parseToolInputWithSchema<TSchema extends ZodType>(
  toolName: string,
  schema: TSchema,
  value: unknown
): Promise<TSchema["_output"]> {
  try {
    return await schema.parseAsync(value)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ToolSchemaValidationError(toolName, formatToolSchemaIssues(error))
    }

    throw error
  }
}
