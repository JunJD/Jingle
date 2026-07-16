import type { ContentAnnotation as ContentAnnotationRow, PrismaClient } from "@prisma/client"
import type {
  ContentAnnotation,
  CreateContentAnnotationInput,
  DeleteContentAnnotationInput,
  UpdateContentAnnotationInput
} from "@shared/content-annotation"
import type { AssistantContentPart } from "@shared/assistant-content-part"
import { readContentCardIdSource, type ContentCardIdentity } from "@shared/content-card"
import { contentAnchorSchema, type ContentAnchor } from "@shared/content-selection"
import { readAssistantContentPartsProjection } from "../db/assistant-content-parts"
import { getPrismaClient } from "../db/client"
import { JingleIpcError } from "../ipc/error"

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>

function toIso(value: bigint | null): string | null {
  return value === null ? null : new Date(Number(value)).toISOString()
}

function diffLineCounts(patch: string): { after: number; before: number } {
  let before = 0
  let after = 0
  for (const line of patch.split("\n")) {
    if (line.startsWith("-") && !line.startsWith("---")) before += 1
    else if (line.startsWith("+") && !line.startsWith("+++")) after += 1
    else {
      before += 1
      after += 1
    }
  }
  return { after, before }
}

function anchorTypeBelongsToPart(
  anchor: ContentAnchor,
  cardSlot: string,
  part: AssistantContentPart
): boolean {
  if (anchor.kind === "whole-card") return true
  if (part.kind === "narrative") return anchor.kind === "text-range" && anchor.blockId === cardSlot
  if (part.kind === "code") return anchor.kind === "code-range" && anchor.blockId === cardSlot
  if (part.kind === "diff") return anchor.kind === "diff-range"
  if (part.kind === "table") return anchor.kind === "table-cell"
  return false
}

function wholeCardText(part: AssistantContentPart): string {
  if (part.kind === "narrative") return part.payload.markdown
  if (part.kind === "code") return part.payload.code
  if (part.kind === "diff") return part.payload.patch
  if (part.kind === "mermaid") return part.payload.source
  return [
    part.payload.columns.map((column) => column.label).join(" | "),
    ...part.payload.rows.map((row) =>
      part.payload.columns.map((column) => row.cells[column.id] ?? "").join(" | ")
    )
  ].join("\n")
}

function codeRangeText(
  code: string,
  anchor: Extract<ContentAnchor, { kind: "code-range" }>
): string | null {
  const lines = code.split("\n")
  if (anchor.endLine > lines.length) return null
  const selected = lines.slice(anchor.startLine - 1, anchor.endLine)
  if (selected.length === 0) return null
  selected[0] = selected[0]!.slice((anchor.startColumn ?? 1) - 1)
  if (anchor.endColumn !== undefined) {
    selected[selected.length - 1] = selected.at(-1)!.slice(0, anchor.endColumn - 1)
  }
  return selected.join("\n")
}

function diffRangeText(
  patch: string,
  anchor: Extract<ContentAnchor, { kind: "diff-range" }>
): string | null {
  let before = 0
  let after = 0
  const selected: string[] = []
  for (const line of patch.split("\n")) {
    const side = line.startsWith("-") && !line.startsWith("---") ? "before" : "after"
    if (side === "before") before += 1
    else if (line.startsWith("+") && !line.startsWith("+++")) after += 1
    else {
      before += 1
      after += 1
    }
    const lineNumber = anchor.side === "before" ? before : after
    const existsOnSide = side === anchor.side || (!line.startsWith("+") && !line.startsWith("-"))
    if (existsOnSide && lineNumber >= anchor.startLine && lineNumber <= anchor.endLine) {
      selected.push(line)
    }
  }
  return selected.length > 0 ? selected.join("\n") : null
}

function resolveCanonicalAnchor(input: {
  anchor: ContentAnchor
  cardSlot: string
  part: AssistantContentPart
  quote: string
}): ContentAnchor | null {
  const { anchor, cardSlot, part, quote } = input
  if (!anchorTypeBelongsToPart(anchor, cardSlot, part)) return null
  if (anchor.kind === "whole-card") {
    return wholeCardText(part).trim() === quote.trim() ? anchor : null
  }
  if (part.kind === "narrative" && anchor.kind === "text-range") {
    const matches: number[] = []
    let cursor = part.payload.markdown.indexOf(quote)
    while (cursor >= 0) {
      matches.push(cursor)
      cursor = part.payload.markdown.indexOf(quote, cursor + 1)
    }
    if (matches.length === 1) {
      return { ...anchor, end: matches[0]! + quote.length, start: matches[0]! }
    }
    return part.payload.markdown.slice(anchor.start, anchor.end) === quote ? anchor : null
  }
  if (part.kind === "code" && anchor.kind === "code-range") {
    return codeRangeText(part.payload.code, anchor) === quote ? anchor : null
  }
  if (part.kind === "diff" && anchor.kind === "diff-range") {
    const counts = diffLineCounts(part.payload.patch)
    const owned =
      anchor.patchRevision === part.revision &&
      anchor.filePath === part.payload.filePath &&
      anchor.endLine <= counts[anchor.side]
    return owned && diffRangeText(part.payload.patch, anchor)?.includes(quote) ? anchor : null
  }
  if (part.kind === "table" && anchor.kind === "table-cell") {
    const column = part.payload.columns.find((candidate) => candidate.id === anchor.columnId)
    if (!column) return null
    if (anchor.rowId === "header") return quote === column.label ? anchor : null
    const row = part.payload.rows.find((candidate) => candidate.id === anchor.rowId)
    return row?.cells[column.id] === quote ? anchor : null
  }
  return null
}

function toRecord(row: ContentAnnotationRow): ContentAnnotation {
  return {
    anchor: contentAnchorSchema.parse(JSON.parse(row.anchorJson)),
    anchorResolution: row.anchorResolution as ContentAnnotation["anchorResolution"],
    body: row.body,
    cardId: row.cardId,
    cardRevision: row.cardRevision,
    contextHash: row.contextHash,
    createdAt: toIso(row.createdAt)!,
    deletedAt: toIso(row.deletedAt),
    id: row.id,
    intent: row.intent as ContentAnnotation["intent"],
    lifecycle: row.lifecycle as ContentAnnotation["lifecycle"],
    quote: row.quote,
    revision: row.revision,
    threadId: row.threadId,
    updatedAt: toIso(row.updatedAt)!
  }
}

async function findDurablePart(
  tx: TransactionClient,
  input: {
    card: Pick<ContentCardIdentity, "kind" | "revision" | "slot" | "sourceId" | "sourceType" | "threadId">
  }
): Promise<AssistantContentPart | null> {
  if (input.card.sourceType !== "message" || !input.card.slot.startsWith("part:")) return null
  const message = await tx.message.findUnique({
    select: { role: true },
    where: {
      threadId_messageId: {
        messageId: input.card.sourceId,
        threadId: input.card.threadId
      }
    }
  })
  if (message?.role !== "assistant") return null
  const projection = await readAssistantContentPartsProjection(
    { messageId: input.card.sourceId, threadId: input.card.threadId },
    tx
  )
  const part = projection?.parts.find(
    (candidate) => candidate.id === input.card.slot.slice("part:".length)
  )
  return part?.kind === input.card.kind && part.revision === input.card.revision ? part : null
}

export class ContentAnnotationsService {
  async get(id: string): Promise<ContentAnnotation> {
    return this.getRequired(id)
  }

  async list(threadId: string): Promise<ContentAnnotation[]> {
    const rows = await getPrismaClient().contentAnnotation.findMany({
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      where: { threadId }
    })
    return rows.map(toRecord)
  }

  async create(input: CreateContentAnnotationInput): Promise<ContentAnnotation> {
    if (input.selection.anchorResolution === "pending-stream") {
      throw new JingleIpcError({
        code: "FAILED_PRECONDITION",
        message: "Pending stream selections cannot be persisted as annotations."
      })
    }
    return getPrismaClient().$transaction(async (transaction) => {
      const part = await findDurablePart(transaction, { card: input.selection.card })
      if (
        !part ||
        !anchorTypeBelongsToPart(input.selection.anchor, input.selection.card.slot, part)
      ) {
        throw new JingleIpcError({
          code: "FAILED_PRECONDITION",
          message: "Annotation anchor type does not match the durable assistant content part."
        })
      }
      const canonicalAnchor = resolveCanonicalAnchor({
        anchor: input.selection.anchor,
        cardSlot: input.selection.card.slot,
        part,
        quote: input.selection.quote
      })
      const now = BigInt(Date.now())
      return toRecord(
        await transaction.contentAnnotation.create({
          data: {
            anchorResolution: canonicalAnchor ? "resolved" : "ambiguous",
            anchorJson: JSON.stringify(canonicalAnchor ?? input.selection.anchor),
            body: input.body,
            cardId: input.selection.card.cardId,
            cardRevision: input.selection.card.revision,
            contextHash: input.selection.contextHash,
            createdAt: now,
            deletedAt: null,
            id: input.id,
            intent: input.intent,
            lifecycle: "open",
            quote: input.selection.quote,
            revision: 1,
            threadId: input.selection.card.threadId,
            updatedAt: now
          }
        })
      )
    })
  }

  async update(input: UpdateContentAnnotationInput): Promise<ContentAnnotation> {
    return getPrismaClient().$transaction(async (transaction) => {
      const current = await transaction.contentAnnotation.findUnique({ where: { id: input.id } })
      if (!current || current.deletedAt !== null || current.revision !== input.expectedRevision) {
        this.throwConflict(input.id)
      }
      let repairAnchor = input.repair?.anchor
      if (input.repair) {
        const source = readContentCardIdSource(current.cardId)
        if (!source || source.sourceType !== "message" || !source.slot.startsWith("part:")) {
          throw new JingleIpcError({
            code: "FAILED_PRECONDITION",
            message: "Annotation repair card identity is invalid."
          })
        }
        const projection = await readAssistantContentPartsProjection(
          { messageId: source.sourceId, threadId: current.threadId },
          transaction
        )
        const currentPart = projection?.parts.find(
          (part) => part.id === source.slot.slice("part:".length)
        )
        if (input.repair.anchorResolution === "orphaned") {
          const validOrphan =
            input.repair.cardRevision === (currentPart?.revision ?? current.cardRevision) &&
            input.repair.quote === current.quote &&
            input.repair.contextHash === current.contextHash &&
            JSON.stringify(input.repair.anchor) === current.anchorJson
          if (!validOrphan) {
            throw new JingleIpcError({
              code: "FAILED_PRECONDITION",
              message: "Orphan repair does not match the last durable anchor."
            })
          }
        } else if (
          !currentPart ||
          currentPart.kind !== source.kind ||
          currentPart.revision !== input.repair.cardRevision ||
          !anchorTypeBelongsToPart(input.repair.anchor, source.slot, currentPart)
        ) {
          throw new JingleIpcError({
            code: "FAILED_PRECONDITION",
            message: "Annotation repair does not match the durable content part."
          })
        } else if (input.repair.anchorResolution === "resolved") {
          repairAnchor = resolveCanonicalAnchor({
            anchor: input.repair.anchor,
            cardSlot: source.slot,
            part: currentPart,
            quote: input.repair.quote
          }) ?? undefined
          if (!repairAnchor) {
            throw new JingleIpcError({
              code: "FAILED_PRECONDITION",
              message: "Resolved annotation repair quote does not match its canonical anchor."
            })
          }
        }
      }
      const result = await transaction.contentAnnotation.updateMany({
        data: {
          ...(input.body ? { body: input.body } : {}),
          ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
          ...(input.repair
            ? {
                anchorJson: JSON.stringify(repairAnchor),
                anchorResolution: input.repair.anchorResolution,
                cardRevision: input.repair.cardRevision,
                contextHash: input.repair.contextHash,
                quote: input.repair.quote
              }
            : {}),
          revision: { increment: 1 },
          updatedAt: BigInt(Date.now())
        },
        where: { deletedAt: null, id: input.id, revision: input.expectedRevision }
      })
      if (result.count !== 1) this.throwConflict(input.id)
      const row = await transaction.contentAnnotation.findUnique({ where: { id: input.id } })
      if (!row) this.throwConflict(input.id)
      return toRecord(row)
    })
  }

  async delete(input: DeleteContentAnnotationInput): Promise<ContentAnnotation> {
    const now = BigInt(Date.now())
    return getPrismaClient().$transaction(async (transaction) => {
      const result = await transaction.contentAnnotation.updateMany({
        data: { deletedAt: now, revision: { increment: 1 }, updatedAt: now },
        where: { deletedAt: null, id: input.id, revision: input.expectedRevision }
      })
      if (result.count !== 1) this.throwConflict(input.id)
      const row = await transaction.contentAnnotation.findUnique({ where: { id: input.id } })
      if (!row) this.throwConflict(input.id)
      return toRecord(row)
    })
  }

  private async getRequired(id: string): Promise<ContentAnnotation> {
    const row = await getPrismaClient().contentAnnotation.findUnique({ where: { id } })
    if (!row) throw new JingleIpcError({ code: "NOT_FOUND", message: "Annotation not found." })
    return toRecord(row)
  }

  private throwConflict(id: string): never {
    throw new JingleIpcError({
      code: "CONFLICT",
      message: `Annotation ${id} changed since it was read.`
    })
  }
}
