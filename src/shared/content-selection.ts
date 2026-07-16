import { z } from "zod/v4"
import { contentCardIdentitySchema } from "./content-card"

const textRangeAnchorSchema = z
  .object({
    blockId: z.string().min(1),
    end: z.number().int().nonnegative(),
    kind: z.literal("text-range"),
    start: z.number().int().nonnegative()
  })
  .refine((anchor) => anchor.start <= anchor.end, {
    message: "Text range start must not exceed end."
  })

const codeRangeAnchorSchema = z
  .object({
    blockId: z.string().min(1),
    endColumn: z.number().int().positive().optional(),
    endLine: z.number().int().positive(),
    kind: z.literal("code-range"),
    startColumn: z.number().int().positive().optional(),
    startLine: z.number().int().positive()
  })
  .refine(
    (anchor) => {
      if (anchor.startLine < anchor.endLine) return true
      if (anchor.startLine > anchor.endLine) return false
      return (anchor.startColumn ?? 1) <= (anchor.endColumn ?? Number.MAX_SAFE_INTEGER)
    },
    { message: "Code range start must not exceed end." }
  )

const diffRangeAnchorSchema = z
  .object({
    endLine: z.number().int().positive(),
    filePath: z.string().min(1).nullable(),
    kind: z.literal("diff-range"),
    patchRevision: z.string().min(1),
    side: z.enum(["before", "after"]),
    startLine: z.number().int().positive()
  })
  .refine((anchor) => anchor.startLine <= anchor.endLine, {
    message: "Diff range start must not exceed end."
  })

const tableCellAnchorSchema = z.object({
  columnId: z.string().min(1),
  kind: z.literal("table-cell"),
  rowId: z.string().min(1)
})

const wholeCardAnchorSchema = z.object({ kind: z.literal("whole-card") })

export const contentAnchorSchema = z.discriminatedUnion("kind", [
  textRangeAnchorSchema,
  codeRangeAnchorSchema,
  diffRangeAnchorSchema,
  tableCellAnchorSchema,
  wholeCardAnchorSchema
])

export type ContentAnchor = z.infer<typeof contentAnchorSchema>

export const selectionAnchorResolutionSchema = z.enum(["resolved", "pending-stream"])

export const contentSelectionDraftSchema = z.object({
  anchor: contentAnchorSchema,
  anchorResolution: selectionAnchorResolutionSchema,
  card: contentCardIdentitySchema,
  contextHash: z.string().min(1),
  quote: z.string().min(1)
})

export type ContentSelectionDraft = z.infer<typeof contentSelectionDraftSchema>

export const selectionReferenceSchema = z.object({
  anchor: contentAnchorSchema,
  anchorResolution: selectionAnchorResolutionSchema,
  cardId: z.string().min(1),
  cardRevision: z.string().min(1),
  contextHash: z.string().min(1),
  quote: z.string().min(1),
  threadId: z.string().min(1),
  type: z.literal("content-selection")
})

export type SelectionReference = z.infer<typeof selectionReferenceSchema>

export function createSelectionReference(draft: ContentSelectionDraft): SelectionReference {
  return {
    anchor: draft.anchor,
    anchorResolution: draft.anchorResolution,
    cardId: draft.card.cardId,
    cardRevision: draft.card.revision,
    contextHash: draft.contextHash,
    quote: draft.quote,
    threadId: draft.card.threadId,
    type: "content-selection"
  }
}
