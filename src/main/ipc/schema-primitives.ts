import { z } from "./schema"

export const nonEmptyTrimmedStringSchema = z.string().trim().min(1)

export const optionalNormalizedTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}, nonEmptyTrimmedStringSchema.optional())
