import { z } from "zod/v4"

export const contentCardKindSchema = z.enum([
  "narrative",
  "code",
  "diff",
  "table",
  "mermaid",
  "artifact",
  "tool"
])

export type ContentCardKind = z.infer<typeof contentCardKindSchema>

const contentCardIdentityBaseSchema = z.object({
  cardId: z.string().min(1),
  kind: contentCardKindSchema,
  revision: z.string().min(1),
  slot: z.string().min(1),
  sourceId: z.string().min(1),
  sourceType: z.enum(["message", "tool-call", "artifact"]),
  threadId: z.string().min(1)
})

export function createContentCardId(
  source: Pick<ContentCardIdentity, "sourceType" | "sourceId" | "slot" | "kind">
): string {
  return `${source.sourceType}:${encodeURIComponent(source.sourceId)}:${source.kind}:${encodeURIComponent(source.slot)}`
}

export function readContentCardIdSource(
  cardId: string
): Pick<ContentCardIdentity, "kind" | "slot" | "sourceId" | "sourceType"> | null {
  const [sourceType, encodedSourceId, kind, encodedSlot, ...extra] = cardId.split(":")
  if (extra.length > 0) return null
  const parsedSourceType = z.enum(["message", "tool-call", "artifact"]).safeParse(sourceType)
  const parsedKind = contentCardKindSchema.safeParse(kind)
  if (!parsedSourceType.success || !parsedKind.success || !encodedSourceId || !encodedSlot) return null
  try {
    return {
      kind: parsedKind.data,
      slot: decodeURIComponent(encodedSlot),
      sourceId: decodeURIComponent(encodedSourceId),
      sourceType: parsedSourceType.data
    }
  } catch {
    return null
  }
}

export const contentCardIdentitySchema = contentCardIdentityBaseSchema.superRefine(
  (identity, context) => {
    if (identity.cardId !== createContentCardId(identity)) {
      context.addIssue({
        code: "custom",
        message: "cardId must match the typed source identity.",
        path: ["cardId"]
      })
    }
  }
)

export type ContentCardIdentity = z.infer<typeof contentCardIdentitySchema>
