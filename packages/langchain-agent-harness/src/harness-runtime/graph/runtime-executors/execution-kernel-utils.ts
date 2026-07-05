
import { ReducedValue, StateSchema } from "@langchain/langgraph"
import {
  interopZodObjectPartial,
  isInteropZodObject,
  isZodSchemaV4
} from "@langchain/core/utils/types"
import { z } from "zod/v4"

function toPartialZodObject(schema: any) {
  if (isInteropZodObject(schema)) return interopZodObjectPartial(schema)
  if (StateSchema.isInstance(schema)) {
    const partialShape: Record<string, any> = {}
    for (const [key, field] of Object.entries(schema.fields)) {
      let fieldSchema: any
      if (ReducedValue.isInstance(field)) fieldSchema = field.inputSchema || field.valueSchema
      else fieldSchema = field
      partialShape[key] = isZodSchemaV4(fieldSchema) ? (fieldSchema as any).optional() : z.any().optional()
    }
    return z.object(partialShape)
  }
  return z.object({})
}

function mergeAbortSignals(...signals: unknown[]) {
  return AbortSignal.any(
    signals.filter(
      (maybeSignal) =>
        maybeSignal !== null &&
        maybeSignal !== void 0 &&
        typeof maybeSignal === "object" &&
        "aborted" in maybeSignal &&
        typeof maybeSignal.aborted === "boolean"
    ) as AbortSignal[]
  )
}

export { mergeAbortSignals, toPartialZodObject }
