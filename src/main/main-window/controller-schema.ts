import { z } from "zod/v4"

const threadIdSchema = z.string().trim().min(1)
const optionalThreadParamsSchema = z
  .object({
    threadId: threadIdSchema.optional()
  })
  .strict()
const requiredThreadParamsSchema = z
  .object({
    threadId: threadIdSchema
  })
  .strict()

export const getMainWindowThreadBindingArgsSchema = z.tuple([])
export const openPrimaryMainWindowArgsSchema = z.union([
  z.tuple([]),
  z.tuple([z.undefined()]),
  z.tuple([optionalThreadParamsSchema])
])
export const pinThreadWindowArgsSchema = z.union([
  z.tuple([]),
  z.tuple([z.undefined()]),
  z.tuple([optionalThreadParamsSchema])
])
export const setDurableWindowThreadArgsSchema = z.tuple([requiredThreadParamsSchema])
