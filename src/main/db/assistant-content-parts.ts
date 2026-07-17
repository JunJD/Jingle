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
import { extractMessageText, parsePersistedMessageContent } from "@shared/message-content"
import {
  AssistantContentProjectionDecodeError,
  AssistantContentProjectionInputError,
  assistantContentProjectionSourceRevision,
  isAssistantContentProjectionInputError,
  type AssistantContentProjectionBlockedInput
} from "../content-cards/projection-error"
import { isAssistantContentProjectionTerminalRunStatus } from "../content-cards/projection-status"
import { getPrismaClient } from "./client"

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function parseContent(value: string): unknown {
  let failureReason: "invalid-json" | "noncanonical" | null = null
  const content = parsePersistedMessageContent(value, {
    onInvalid: (reason) => {
      failureReason = reason
    },
    role: "assistant"
  })
  if (failureReason) {
    throw new AssistantContentProjectionInputError(failureReason)
  }
  return content
}

interface CanonicalAssistantContent {
  revision: string
  text: string
}

function readCanonicalAssistantContent(content: string): CanonicalAssistantContent {
  const text = extractMessageText(parseContent(content) as never)
  return { revision: sha256(text), text }
}

export function assistantContentRevision(content: string): string {
  return readCanonicalAssistantContent(content).revision
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
  locked?: Map<number, AssistantContentPart>
}): Map<number, AssistantContentPart> {
  const matches = new Map(input.locked ?? [])
  const lockedPartIds = new Set(Array.from(matches.values(), (part) => part.id))
  const usedExisting = new Set<number>()
  const existingCandidates = input.existing
    .map((part, index) => ({ index, key: `${part.kind}:${part.revision}`, part }))
    .filter(({ part }) => !lockedPartIds.has(part.id))
  const draftCandidates = input.drafts
    .map(({ part, revision }, index) => ({ index, key: `${part.kind}:${revision}` }))
    .filter(({ index }) => !matches.has(index))
  for (const [index, part] of input.existing.entries()) {
    if (lockedPartIds.has(part.id)) usedExisting.add(index)
  }
  const lengths = Array.from({ length: existingCandidates.length + 1 }, () =>
    Array<number>(draftCandidates.length + 1).fill(0)
  )

  for (let existingIndex = existingCandidates.length - 1; existingIndex >= 0; existingIndex -= 1) {
    for (let draftIndex = draftCandidates.length - 1; draftIndex >= 0; draftIndex -= 1) {
      lengths[existingIndex]![draftIndex] =
        existingCandidates[existingIndex]!.key === draftCandidates[draftIndex]!.key
          ? 1 + lengths[existingIndex + 1]![draftIndex + 1]!
          : Math.max(
              lengths[existingIndex + 1]![draftIndex]!,
              lengths[existingIndex]![draftIndex + 1]!
            )
    }
  }

  let existingIndex = 0
  let draftIndex = 0
  while (existingIndex < existingCandidates.length && draftIndex < draftCandidates.length) {
    if (existingCandidates[existingIndex]!.key === draftCandidates[draftIndex]!.key) {
      const existing = existingCandidates[existingIndex]!
      matches.set(draftCandidates[draftIndex]!.index, existing.part)
      usedExisting.add(existing.index)
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
  canonical?: CanonicalAssistantContent
  content: string
  existing: AssistantContentPartsProjection | null
  fixedParts?: Array<{ ordinal: number; part: AssistantContentPart }>
  forceRebuild?: boolean
}): AssistantContentPartsProjection {
  const canonical = input.canonical ?? readCanonicalAssistantContent(input.content)
  const { revision: contentRevision, text } = canonical
  if (!input.forceRebuild && input.existing?.contentRevision === contentRevision) {
    return input.existing
  }

  const drafts = projectAssistantContentPartInputs(text, randomUUID).map((part) => ({
    part,
    revision: partRevision(part)
  }))
  const locked = new Map<number, AssistantContentPart>()
  for (const fixed of input.fixedParts ?? []) {
    const draft = drafts[fixed.ordinal]
    if (draft?.part.kind === fixed.part.kind && draft.revision === fixed.part.revision) {
      locked.set(fixed.ordinal, fixed.part)
    }
  }
  const matches = matchAssistantContentParts({
    drafts,
    existing: input.existing?.parts ?? [],
    locked
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

function projectionForRepairFromRows(input: {
  canonicalContentRevision: string
  contentRevision: string
  parts: Array<{
    kind: string
    ordinal: number
    partId: string
    payloadJson: string
    revision: string
  }>
}): {
  corruptions: AssistantContentProjectionDecodeError[]
  fixedParts: Array<{ ordinal: number; part: AssistantContentPart }>
  projection: AssistantContentPartsProjection
} {
  const corruptions: AssistantContentProjectionDecodeError[] = []
  const fixedParts: Array<{ ordinal: number; part: AssistantContentPart }> = []
  const parts: AssistantContentPart[] = []
  for (const part of input.parts) {
    try {
      const parsed = assistantContentPartSchema.parse({
        id: part.partId,
        kind: part.kind,
        payload: JSON.parse(part.payloadJson) as unknown,
        revision: part.revision
      })
      parts.push(parsed)
      fixedParts.push({ ordinal: part.ordinal, part: parsed })
    } catch (error) {
      corruptions.push(new AssistantContentProjectionDecodeError(error))
    }
  }
  try {
    return {
      corruptions,
      fixedParts: input.contentRevision === input.canonicalContentRevision ? fixedParts : [],
      projection: assistantContentPartsProjectionSchema.parse({
        contentRevision: input.contentRevision,
        parts,
        schemaVersion: 1
      })
    }
  } catch (error) {
    corruptions.push(new AssistantContentProjectionDecodeError(error))
    return {
      corruptions,
      fixedParts: [],
      projection: assistantContentPartsProjectionSchema.parse({
        contentRevision: input.canonicalContentRevision,
        parts,
        schemaVersion: 1
      })
    }
  }
}

async function readAssistantContentPartsProjectionForRepair(
  input: {
    canonicalContentRevision: string
    messageId: string
    threadId: string
  },
  tx: TransactionClient
): Promise<{
  corruptions: AssistantContentProjectionDecodeError[]
  fixedParts: Array<{ ordinal: number; part: AssistantContentPart }>
  projection: AssistantContentPartsProjection | null
}> {
  const projection = await tx.assistantContentProjection.findUnique({
    include: { parts: { orderBy: { ordinal: "asc" } } },
    where: {
      threadId_messageId: { messageId: input.messageId, threadId: input.threadId }
    }
  })
  if (!projection) return { corruptions: [], fixedParts: [], projection: null }
  const repaired = projectionForRepairFromRows({
    canonicalContentRevision: input.canonicalContentRevision,
    contentRevision: projection.contentRevision,
    parts: projection.parts
  })
  return repaired
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
  if (!projection) return null
  try {
    return projectionFromRows({
      contentRevision: projection.contentRevision,
      parts: projection.parts
    })
  } catch (error) {
    throw new AssistantContentProjectionDecodeError(error)
  }
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
}): Promise<{
  blockedInputs: Array<
    AssistantContentProjectionBlockedInput & { error: AssistantContentProjectionInputError }
  >
  repairedCorruptions: Array<{ error: AssistantContentProjectionDecodeError; messageId: string }>
}> {
  const prisma = getPrismaClient()
  return prisma.$transaction(async (tx) => {
    const blockedInputs: Array<
      AssistantContentProjectionBlockedInput & { error: AssistantContentProjectionInputError }
    > = []
    const repairedCorruptions: Array<{
      error: AssistantContentProjectionDecodeError
      messageId: string
    }> = []
    const run = await tx.run.findUnique({
      select: { status: true, threadId: true },
      where: { runId: input.runId }
    })
    if (
      !run ||
      run.threadId !== input.threadId ||
      !isAssistantContentProjectionTerminalRunStatus(run.status)
    ) {
      return { blockedInputs, repairedCorruptions }
    }
    const messages = await tx.message.findMany({
      orderBy: { seq: "asc" },
      where: { role: "assistant", runId: input.runId, threadId: input.threadId }
    })
    for (const message of messages) {
      let canonical: CanonicalAssistantContent
      try {
        canonical = readCanonicalAssistantContent(message.content)
      } catch (error) {
        if (!isAssistantContentProjectionInputError(error)) throw error
        blockedInputs.push({
          error,
          messageId: message.messageId,
          reason: error.reason,
          sourceRevision: assistantContentProjectionSourceRevision(message.content)
        })
        continue
      }
      const repairRead = await readAssistantContentPartsProjectionForRepair(
        {
          canonicalContentRevision: canonical.revision,
          messageId: message.messageId,
          threadId: input.threadId
        },
        tx
      )
      repairedCorruptions.push(
        ...repairRead.corruptions.map((error) => ({ error, messageId: message.messageId }))
      )
      const projection = buildAssistantContentPartsProjection({
        canonical,
        content: message.content,
        existing: repairRead.projection,
        fixedParts: repairRead.fixedParts,
        forceRebuild: repairRead.corruptions.length > 0
      })
      if (
        repairRead.corruptions.length > 0 ||
        projection.contentRevision !== repairRead.projection?.contentRevision
      ) {
        await writeProjection(tx, {
          messageId: message.messageId,
          projection,
          threadId: input.threadId
        })
      }
    }
    return { blockedInputs, repairedCorruptions }
  })
}
