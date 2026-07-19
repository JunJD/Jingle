import type { ContentAnnotation as ContentAnnotationRow, PrismaClient } from "@prisma/client"
import type {
  ContentAnnotation,
  CreateContentAnnotationInput,
  DeleteContentAnnotationInput,
  UpdateContentAnnotationInput
} from "@shared/content-annotation"
import {
  projectAssistantDiffLines,
  type AssistantContentPart
} from "@shared/assistant-content-part"
import { readContentCardIdSource, type ContentCardIdentity } from "@shared/content-card"
import { contentAnchorSchema, type ContentAnchor } from "@shared/content-selection"
import { readAssistantContentPartsProjection } from "../db/assistant-content-parts"
import { getPrismaClient } from "../db/client"
import { JingleIpcError } from "../ipc/error"
import type { DiagnosticEventRef, DiagnosticGraphSink } from "../diagnostics/schema"

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>

const NOOP_EVENT_REF: DiagnosticEventRef = {
  eventId: "diag:noop:0",
  sequence: 0,
  sessionId: "noop"
}

const NOOP_DIAGNOSTICS: DiagnosticGraphSink = {
  capture: () => NOOP_EVENT_REF
}

function toIso(value: bigint | null): string | null {
  return value === null ? null : new Date(Number(value)).toISOString()
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
  const selected = projectAssistantDiffLines(patch).filter(
    (line) =>
      line.side === anchor.side &&
      line.lineNumber >= anchor.startLine &&
      line.lineNumber <= anchor.endLine
  )
  const first = selected[0]
  const last = selected.at(-1)
  if (
    !first ||
    first.lineNumber !== anchor.startLine ||
    last?.lineNumber !== anchor.endLine ||
    selected.some((line, index) => line.lineNumber !== anchor.startLine + index)
  ) {
    return null
  }
  return selected.map((line) => line.text).join("\n")
}

function tableCellText(
  part: Extract<AssistantContentPart, { kind: "table" }>,
  anchor: Extract<ContentAnchor, { kind: "table-cell" }>
): string | null {
  const column = part.payload.columns.find((candidate) => candidate.id === anchor.columnId)
  if (!column) return null
  if (anchor.rowId === "header") return column.label
  return (
    part.payload.rows.find((candidate) => candidate.id === anchor.rowId)?.cells[column.id] ?? null
  )
}

function revisionStableAnchorQuote(
  part: AssistantContentPart,
  anchor: ContentAnchor
): string | null {
  const quote =
    anchor.kind === "whole-card"
      ? wholeCardText(part).trim()
      : part.kind === "table" && anchor.kind === "table-cell"
        ? tableCellText(part, anchor)
        : null
  return quote ? quote : null
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
    const owned =
      anchor.patchRevision === part.revision && anchor.filePath === part.payload.filePath
    return owned && diffRangeText(part.payload.patch, anchor)?.includes(quote) ? anchor : null
  }
  if (part.kind === "table" && anchor.kind === "table-cell") {
    return tableCellText(part, anchor) === quote ? anchor : null
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
    card: Pick<
      ContentCardIdentity,
      "kind" | "revision" | "slot" | "sourceId" | "sourceType" | "threadId"
    >
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
  private readonly changedListeners = new Set<(annotation: ContentAnnotation) => void>()

  constructor(private readonly diagnostics: DiagnosticGraphSink = NOOP_DIAGNOSTICS) {}

  onChanged(listener: (annotation: ContentAnnotation) => void): () => void {
    this.changedListeners.add(listener)
    return () => this.changedListeners.delete(listener)
  }

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
    const annotation = await getPrismaClient().$transaction(async (transaction) => {
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
    this.publishChanged(annotation)
    return annotation
  }

  async update(input: UpdateContentAnnotationInput): Promise<ContentAnnotation> {
    const annotation = await getPrismaClient().$transaction(async (transaction) => {
      const current = await transaction.contentAnnotation.findUnique({ where: { id: input.id } })
      if (!current || current.deletedAt !== null || current.revision !== input.expectedRevision) {
        this.throwConflict(input.id)
      }
      let repairAnchor = input.repair?.anchor
      let repairQuote: string | undefined
      if (input.repair) {
        let nextRepairQuote = input.repair.quote
        if (
          input.repair.expected.cardRevision !== current.cardRevision ||
          input.repair.expected.contextHash !== current.contextHash
        ) {
          this.throwConflict(input.id)
        }
        if (input.repair.quote !== current.quote) this.throwConflict(input.id)
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
            (!currentPart || currentPart.kind === source.kind) &&
            (currentPart !== undefined || input.repair.contextHash === current.contextHash) &&
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
          const structuralQuote =
            input.repair.cardRevision !== current.cardRevision
              ? revisionStableAnchorQuote(currentPart, input.repair.anchor)
              : null
          if (structuralQuote !== null) {
            if (JSON.stringify(input.repair.anchor) !== current.anchorJson) {
              throw new JingleIpcError({
                code: "FAILED_PRECONDITION",
                message: "Revision-stable annotation repair cannot change its structural anchor."
              })
            }
            nextRepairQuote = structuralQuote
          }
          repairAnchor =
            resolveCanonicalAnchor({
              anchor: input.repair.anchor,
              cardSlot: source.slot,
              part: currentPart,
              quote: nextRepairQuote
            }) ?? undefined
          if (!repairAnchor) {
            throw new JingleIpcError({
              code: "FAILED_PRECONDITION",
              message: "Resolved annotation repair quote does not match its canonical anchor."
            })
          }
        }
        repairQuote = nextRepairQuote
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
                quote: repairQuote
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
    this.publishChanged(annotation)
    return annotation
  }

  async delete(input: DeleteContentAnnotationInput): Promise<ContentAnnotation> {
    const now = BigInt(Date.now())
    const annotation = await getPrismaClient().$transaction(async (transaction) => {
      const result = await transaction.contentAnnotation.updateMany({
        data: { deletedAt: now, revision: { increment: 1 }, updatedAt: now },
        where: { deletedAt: null, id: input.id, revision: input.expectedRevision }
      })
      if (result.count !== 1) this.throwConflict(input.id)
      const row = await transaction.contentAnnotation.findUnique({ where: { id: input.id } })
      if (!row) this.throwConflict(input.id)
      return toRecord(row)
    })
    this.publishChanged(annotation)
    return annotation
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

  private publishChanged(annotation: ContentAnnotation): void {
    for (const listener of this.changedListeners) {
      try {
        listener(annotation)
      } catch (error) {
        this.diagnostics.capture({
          component: "content-annotations",
          eventCode: "content_annotation.change_listener_failed",
          evidence: [{ kind: "error", value: error }],
          level: "warn",
          operation: "publish-change",
          recoverable: true,
          refs: [
            { id: annotation.threadId, kind: "thread" },
            { id: annotation.id, kind: "content-annotation" }
          ],
          stateImpact: "annotation_saved_notification_missed",
          summary: "Content annotation was saved but a change listener failed"
        })
      }
    }
  }
}
