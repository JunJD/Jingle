import { z } from "zod/v4"

const canonicalPathSchema = z.string().trim().min(1)
const canonicalTargetIdSchema = z.string().trim().min(1)

export const openTargetKindSchema = z.enum(["file-manager", "terminal", "application"])
export type OpenTargetKind = z.infer<typeof openTargetKindSchema>

export const openTargetSchema = z
  .object({
    appPath: canonicalPathSchema.optional(),
    iconDataUrl: z.string().min(1).optional(),
    id: canonicalTargetIdSchema,
    kind: openTargetKindSchema,
    label: z.string().trim().min(1)
  })
  .strict()
export type OpenTarget = z.infer<typeof openTargetSchema>

export const listOpenTargetsRequestSchema = z
  .object({
    folderPath: canonicalPathSchema
  })
  .strict()
export type ListOpenTargetsRequest = z.infer<typeof listOpenTargetsRequestSchema>

export const listOpenTargetsResponseSchema = z
  .object({
    targets: z.array(openTargetSchema)
  })
  .strict()
export type ListOpenTargetsResponse = z.infer<typeof listOpenTargetsResponseSchema>

export const openTargetRequestSchema = z
  .object({
    filePath: canonicalPathSchema.optional(),
    folderPath: canonicalPathSchema,
    targetId: canonicalTargetIdSchema
  })
  .strict()
export type OpenTargetRequest = z.infer<typeof openTargetRequestSchema>

export const listOpenTargetsArgsSchema = z.tuple([listOpenTargetsRequestSchema])
export const openTargetArgsSchema = z.tuple([openTargetRequestSchema])
