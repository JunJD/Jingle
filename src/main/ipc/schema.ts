import { ZodError, type ZodType } from "zod/v4"

export { z } from "zod/v4"

export class IpcSchemaValidationError extends Error {
  readonly channel: string
  readonly issues: string[]

  constructor(channel: string, issues: string[]) {
    const detail = issues.length > 0 ? ` ${issues.join("; ")}` : ""
    super(`${channel} params validation failed.${detail}`)
    this.name = "IpcSchemaValidationError"
    this.channel = channel
    this.issues = issues
  }
}

export function formatIpcSchemaIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "$"
    return `${path}: ${issue.message}`
  })
}

export function parseIpcPayloadWithSchema<TSchema extends ZodType>(
  channel: string,
  schema: TSchema,
  value: unknown
): TSchema["_output"] {
  try {
    return schema.parse(value)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new IpcSchemaValidationError(channel, formatIpcSchemaIssues(error))
    }

    throw error
  }
}
