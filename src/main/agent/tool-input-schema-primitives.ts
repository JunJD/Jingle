import { z } from "./tool-input-schema"

export const nonEmptyTrimmedStringSchema = z.string().trim().min(1)

export const optionalTrimmedStringSchema = nonEmptyTrimmedStringSchema.optional()

export const optionalNullableTrimmedStringSchema = z
  .union([z.null(), nonEmptyTrimmedStringSchema])
  .optional()
