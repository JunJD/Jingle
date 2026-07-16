import { z } from "zod/v4"
import { contentAnchorSchema } from "./content-selection"
import { contentSelectionDraftSchema } from "./content-selection"

export const annotationLifecycleSchema = z.enum(["open", "resolved"])
export const anchorResolutionSchema = z.enum([
  "resolved",
  "ambiguous",
  "orphaned",
  "pending-stream"
])

export const contentAnnotationSchema = z.object({
  anchor: contentAnchorSchema,
  anchorResolution: anchorResolutionSchema,
  body: z.string().min(1),
  cardId: z.string().min(1),
  cardRevision: z.string().min(1),
  contextHash: z.string().min(1),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  id: z.string().min(1),
  intent: z.enum(["comment", "suggestion"]),
  lifecycle: annotationLifecycleSchema,
  quote: z.string().min(1),
  revision: z.number().int().positive(),
  threadId: z.string().min(1),
  updatedAt: z.iso.datetime()
})

export type ContentAnnotation = z.infer<typeof contentAnnotationSchema>

export const createContentAnnotationInputSchema = z.object({
  body: z.string().min(1),
  id: z.string().min(1),
  intent: z.enum(["comment", "suggestion"]),
  selection: contentSelectionDraftSchema
})

export type CreateContentAnnotationInput = z.infer<typeof createContentAnnotationInputSchema>

const annotationRepairSchema = z.object({
  anchor: contentAnchorSchema,
  anchorResolution: z.enum(["resolved", "ambiguous", "orphaned"]),
  cardRevision: z.string().min(1),
  contextHash: z.string().min(1),
  quote: z.string().min(1)
})

export const updateContentAnnotationInputSchema = z
  .object({
    body: z.string().min(1).optional(),
    expectedRevision: z.number().int().positive(),
    id: z.string().min(1),
    lifecycle: annotationLifecycleSchema.optional(),
    repair: annotationRepairSchema.optional()
  })
  .refine(
    (input) =>
      input.body !== undefined || input.lifecycle !== undefined || input.repair !== undefined,
    {
      message: "Annotation update requires a mutation."
    }
  )

export type UpdateContentAnnotationInput = z.infer<typeof updateContentAnnotationInputSchema>

export const deleteContentAnnotationInputSchema = z.object({
  expectedRevision: z.number().int().positive(),
  id: z.string().min(1)
})

export type DeleteContentAnnotationInput = z.infer<typeof deleteContentAnnotationInputSchema>

export const contentAnnotationListSchema = z.array(contentAnnotationSchema)
