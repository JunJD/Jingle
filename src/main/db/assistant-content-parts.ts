import { createHash, randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import {
  assistantContentPartSchema,
  assistantContentPartsProjectionSchema,
  projectAssistantContentPartInputs,
  type AssistantContentPart,
  type AssistantContentPartInput,
  type AssistantContentPartsProjection
} from "@shared/assistant-content-part"
import { extractMessageText } from "@shared/message-content"
import { getPrismaClient } from "./client"

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function parseContent(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function partRevision(part: AssistantContentPartInput): string {
  const payload =
    part.kind === "table"
      ? {
          columns: part.payload.columns.map((column) => column.label),
          rows: part.payload.rows.map((row) =>
            part.payload.columns.map((column) => row.cells[column.id] ?? "")
          )
        }
      : part.payload
  return sha256(JSON.stringify({ kind: part.kind, payload }))
}

function reconcileTablePayload(
  draft: Extract<AssistantContentPartInput, { kind: "table" }>["payload"],
  existing: Extract<AssistantContentPart, { kind: "table" }>["payload"]
): Extract<AssistantContentPart, { kind: "table" }>["payload"] {
  const existingColumnsByLabel = new Map<string, typeof existing.columns>()
  for (const column of existing.columns) {
    existingColumnsByLabel.set(column.label, [
      ...(existingColumnsByLabel.get(column.label) ?? []),
      column
    ])
  }
  const draftLabelCounts = new Map<string, number>()
  for (const column of draft.columns) {
    draftLabelCounts.set(column.label, (draftLabelCounts.get(column.label) ?? 0) + 1)
  }
  const columns = draft.columns.map((column) => {
    const candidates = existingColumnsByLabel.get(column.label) ?? []
    return candidates.length === 1 && draftLabelCounts.get(column.label) === 1
      ? { ...column, id: candidates[0]!.id }
      : column
  })

  const rowValues = (payload: typeof existing, row: (typeof existing.rows)[number]): string =>
    JSON.stringify(payload.columns.map((column) => row.cells[column.id] ?? ""))
  const existingRowsByValue = new Map<string, typeof existing.rows>()
  for (const row of existing.rows) {
    const key = rowValues(existing, row)
    existingRowsByValue.set(key, [...(existingRowsByValue.get(key) ?? []), row])
  }
  const draftRows = draft.rows.map((row) => ({
    key: JSON.stringify(draft.columns.map((column) => row.cells[column.id] ?? "")),
    row
  }))
  const draftRowCounts = new Map<string, number>()
  for (const row of draftRows) draftRowCounts.set(row.key, (draftRowCounts.get(row.key) ?? 0) + 1)

  return {
    columns,
    rows: draftRows.map(({ key, row }) => {
      const candidates = existingRowsByValue.get(key) ?? []
      const id =
        candidates.length === 1 && draftRowCounts.get(key) === 1 ? candidates[0]!.id : row.id
      return {
        id,
        cells: Object.fromEntries(
          columns.map((column, index) => [column.id, row.cells[draft.columns[index]!.id] ?? ""])
        )
      }
    })
  }
}

function matchAssistantContentParts(input: {
  drafts: Array<{ part: AssistantContentPartInput; revision: string }>
  existing: AssistantContentPart[]
}): Map<number, AssistantContentPart> {
  const existingKeys = input.existing.map((part) => `${part.kind}:${part.revision}`)
  const draftKeys = input.drafts.map(({ part, revision }) => `${part.kind}:${revision}`)
  const lengths = Array.from({ length: existingKeys.length + 1 }, () =>
    Array<number>(draftKeys.length + 1).fill(0)
  )

  for (let existingIndex = existingKeys.length - 1; existingIndex >= 0; existingIndex -= 1) {
    for (let draftIndex = draftKeys.length - 1; draftIndex >= 0; draftIndex -= 1) {
      lengths[existingIndex]![draftIndex] =
        existingKeys[existingIndex] === draftKeys[draftIndex]
          ? 1 + lengths[existingIndex + 1]![draftIndex + 1]!
          : Math.max(
              lengths[existingIndex + 1]![draftIndex]!,
              lengths[existingIndex]![draftIndex + 1]!
            )
    }
  }

  const matches = new Map<number, AssistantContentPart>()
  const usedExisting = new Set<number>()
  let existingIndex = 0
  let draftIndex = 0
  while (existingIndex < existingKeys.length && draftIndex < draftKeys.length) {
    if (existingKeys[existingIndex] === draftKeys[draftIndex]) {
      matches.set(draftIndex, input.existing[existingIndex]!)
      usedExisting.add(existingIndex)
      existingIndex += 1
      draftIndex += 1
    } else if (
      lengths[existingIndex + 1]![draftIndex]! >= lengths[existingIndex]![draftIndex + 1]!
    ) {
      existingIndex += 1
    } else {
      draftIndex += 1
    }
  }

  for (let index = 0; index < input.drafts.length; index += 1) {
    if (matches.has(index)) continue
    const kind = input.drafts[index]!.part.kind
    const candidate = input.existing
      .map((part, priorIndex) => ({ part, priorIndex }))
      .filter(({ part, priorIndex }) => part.kind === kind && !usedExisting.has(priorIndex))
      .sort(
        (left, right) =>
          Math.abs(left.priorIndex - index) - Math.abs(right.priorIndex - index) ||
          left.priorIndex - right.priorIndex
      )[0]
    if (!candidate) continue
    matches.set(index, candidate.part)
    usedExisting.add(candidate.priorIndex)
  }

  return matches
}

export function buildAssistantContentPartsProjection(input: {
  content: string
  existing: AssistantContentPartsProjection | null
}): AssistantContentPartsProjection {
  const text = extractMessageText(parseContent(input.content) as never)
  const contentRevision = sha256(text)
  if (input.existing?.contentRevision === contentRevision) return input.existing

  const drafts = projectAssistantContentPartInputs(text, randomUUID).map((part) => ({
    part,
    revision: partRevision(part)
  }))
  const matches = matchAssistantContentParts({
    drafts,
    existing: input.existing?.parts ?? []
  })

  const parts = drafts.map(({ part, revision }, index) => {
    const prior = matches.get(index) ?? null
    if (prior?.revision === revision) return prior
    const payload =
      part.kind === "table" && prior?.kind === "table"
        ? reconcileTablePayload(part.payload, prior.payload)
        : part.payload
    return assistantContentPartSchema.parse({
      ...part,
      id: prior?.id ?? randomUUID(),
      payload,
      revision
    })
  })
  return assistantContentPartsProjectionSchema.parse({ contentRevision, parts, schemaVersion: 1 })
}

function projectionFromRows(input: {
  contentRevision: string
  parts: Array<{ kind: string; partId: string; payloadJson: string; revision: string }>
}): AssistantContentPartsProjection {
  return assistantContentPartsProjectionSchema.parse({
    contentRevision: input.contentRevision,
    parts: input.parts.map((part) => ({
      id: part.partId,
      kind: part.kind,
      payload: JSON.parse(part.payloadJson) as unknown,
      revision: part.revision
    })),
    schemaVersion: 1
  })
}

export async function readAssistantContentPartsProjection(
  input: {
    messageId: string
    threadId: string
  },
  tx: TransactionClient = getPrismaClient()
): Promise<AssistantContentPartsProjection | null> {
  const projection = await tx.assistantContentProjection.findUnique({
    include: { parts: { orderBy: { ordinal: "asc" } } },
    where: { threadId_messageId: input }
  })
  return projection
    ? projectionFromRows({ contentRevision: projection.contentRevision, parts: projection.parts })
    : null
}

async function writeProjection(
  tx: TransactionClient,
  input: { messageId: string; projection: AssistantContentPartsProjection; threadId: string }
): Promise<void> {
  const now = BigInt(Date.now())
  await tx.assistantContentProjection.upsert({
    create: {
      contentRevision: input.projection.contentRevision,
      finalizedAt: now,
      messageId: input.messageId,
      threadId: input.threadId
    },
    update: { contentRevision: input.projection.contentRevision, finalizedAt: now },
    where: { threadId_messageId: { messageId: input.messageId, threadId: input.threadId } }
  })
  await tx.assistantContentPart.deleteMany({
    where: { messageId: input.messageId, threadId: input.threadId }
  })
  if (input.projection.parts.length > 0) {
    await tx.assistantContentPart.createMany({
      data: input.projection.parts.map((part, ordinal) => ({
        kind: part.kind,
        messageId: input.messageId,
        ordinal,
        partId: part.id,
        payloadJson: JSON.stringify(part.payload),
        revision: part.revision,
        threadId: input.threadId
      }))
    })
  }
}

export async function finalizeAssistantContentPartsForRun(input: {
  runId: string
  threadId: string
}): Promise<void> {
  const prisma = getPrismaClient()
  await prisma.$transaction(async (tx) => {
    const run = await tx.run.findUnique({
      select: { status: true, threadId: true },
      where: { runId: input.runId }
    })
    if (
      !run ||
      run.threadId !== input.threadId ||
      !["success", "error"].includes(run.status ?? "")
    ) {
      return
    }
    const messages = await tx.message.findMany({
      orderBy: { seq: "asc" },
      where: { role: "assistant", runId: input.runId, threadId: input.threadId }
    })
    for (const message of messages) {
      const existing = await readAssistantContentPartsProjection(
        { messageId: message.messageId, threadId: input.threadId },
        tx
      )
      const projection = buildAssistantContentPartsProjection({
        content: message.content,
        existing
      })
      if (projection.contentRevision !== existing?.contentRevision) {
        await writeProjection(tx, {
          messageId: message.messageId,
          projection,
          threadId: input.threadId
        })
      }
    }
  })
}
