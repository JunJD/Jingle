import { z } from "zod/v4"
import type { ContentAnnotation } from "./content-annotation"

export const contentAnnotationAgentContextSchema = z.object({
  anchor: z.object({
    cardId: z.string().min(1),
    cardRevision: z.string().min(1),
    quote: z.string().min(1)
  }),
  annotation: z.object({
    body: z.string().min(1),
    id: z.string().min(1),
    intent: z.enum(["comment", "suggestion"]),
    revision: z.number().int().positive()
  }),
  command: z.literal("request-change"),
  threadId: z.string().min(1),
  type: z.literal("jingle-content-annotation-context"),
  version: z.literal(1)
})

export type ContentAnnotationAgentContext = z.infer<
  typeof contentAnnotationAgentContextSchema
>

export function createContentAnnotationAgentContext(
  annotation: ContentAnnotation
): ContentAnnotationAgentContext {
  return {
    anchor: {
      cardId: annotation.cardId,
      cardRevision: annotation.cardRevision,
      quote: annotation.quote
    },
    annotation: {
      body: annotation.body,
      id: annotation.id,
      intent: annotation.intent,
      revision: annotation.revision
    },
    command: "request-change",
    threadId: annotation.threadId,
    type: "jingle-content-annotation-context",
    version: 1
  }
}

export function serializeContentAnnotationAgentContext(
  context: ContentAnnotationAgentContext
): string {
  const validated = contentAnnotationAgentContextSchema.parse(context)
  return `<jingle_content_annotation_context>\n${JSON.stringify(validated)}\n</jingle_content_annotation_context>`
}
