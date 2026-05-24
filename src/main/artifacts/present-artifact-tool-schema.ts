import { z } from "../agent/tool-input-schema"
import {
  nonEmptyTrimmedStringSchema,
  optionalNullableTrimmedStringSchema,
  optionalTrimmedStringSchema
} from "../agent/tool-input-schema-primitives"

const presentArtifactBaseSchema = z.object({
  dedupeKey: optionalTrimmedStringSchema,
  subtitle: optionalNullableTrimmedStringSchema
})

const presentFileArtifactSchema = presentArtifactBaseSchema.extend({
  kind: z.literal("file"),
  mimeType: optionalNullableTrimmedStringSchema,
  path: nonEmptyTrimmedStringSchema,
  previewText: optionalNullableTrimmedStringSchema,
  title: optionalTrimmedStringSchema
})

const presentPatchArtifactSchema = presentArtifactBaseSchema.extend({
  kind: z.literal("patch"),
  mimeType: optionalNullableTrimmedStringSchema,
  patchText: nonEmptyTrimmedStringSchema,
  previewText: optionalNullableTrimmedStringSchema,
  title: optionalTrimmedStringSchema
})

const presentLinkArtifactSchema = presentArtifactBaseSchema.extend({
  kind: z.literal("link"),
  previewText: optionalNullableTrimmedStringSchema,
  title: nonEmptyTrimmedStringSchema,
  url: nonEmptyTrimmedStringSchema
})

const presentSummaryArtifactSchema = presentArtifactBaseSchema.extend({
  format: z.enum(["markdown", "plain"]).optional(),
  kind: z.literal("summary"),
  text: nonEmptyTrimmedStringSchema,
  title: nonEmptyTrimmedStringSchema
})

export const presentArtifactToolItemSchema = z.discriminatedUnion("kind", [
  presentFileArtifactSchema,
  presentPatchArtifactSchema,
  presentLinkArtifactSchema,
  presentSummaryArtifactSchema
])

export const presentArtifactToolInputSchema = z.object({
  artifacts: z.array(presentArtifactToolItemSchema).min(1)
})

export type PresentArtifactToolItem = z.infer<typeof presentArtifactToolItemSchema>
export type PresentArtifactToolInput = z.infer<typeof presentArtifactToolInputSchema>
