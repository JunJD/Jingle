import { z } from "zod/v4"

export const assistantContentPartKindSchema = z.enum([
  "narrative",
  "code",
  "diff",
  "table",
  "mermaid"
])

const partBaseSchema = z.object({
  id: z.string().uuid(),
  revision: z.string().regex(/^sha256:[a-f0-9]{64}$/)
})

const narrativePartSchema = partBaseSchema.extend({
  kind: z.literal("narrative"),
  payload: z.object({ markdown: z.string() })
})

const codePartSchema = partBaseSchema.extend({
  kind: z.literal("code"),
  payload: z.object({ code: z.string(), language: z.string().nullable() })
})

const diffPartSchema = partBaseSchema.extend({
  kind: z.literal("diff"),
  payload: z.object({ filePath: z.string().min(1).nullable(), patch: z.string() })
})

const tablePartSchema = partBaseSchema.extend({
  kind: z.literal("table"),
  payload: z.object({
    columns: z.array(z.object({ id: z.string().uuid(), label: z.string() })),
    rows: z.array(
      z.object({
        cells: z.record(z.string().uuid(), z.string()),
        id: z.string().uuid()
      })
    )
  })
})

const mermaidPartSchema = partBaseSchema.extend({
  kind: z.literal("mermaid"),
  payload: z.object({ source: z.string() })
})

export const assistantContentPartSchema = z.discriminatedUnion("kind", [
  narrativePartSchema,
  codePartSchema,
  diffPartSchema,
  tablePartSchema,
  mermaidPartSchema
])

export const assistantContentPartIdentitySchema = partBaseSchema.extend({
  kind: assistantContentPartKindSchema
})

const assistantContentRevisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const assistantContentProjectionFingerprintSchema = z.string().regex(/^fnv1a64:[a-f0-9]{16}$/)

export const assistantContentPartsProjectionSchema = z.object({
  contentRevision: assistantContentRevisionSchema,
  parts: z.array(assistantContentPartSchema),
  schemaVersion: z.literal(1)
})

export const assistantContentProjectionJobStatusSchema = z.enum([
  "pending",
  "running",
  "failed",
  "blocked",
  "completed"
])

export const assistantContentProjectionBlockedReasonSchema = z.enum([
  "invalid-json",
  "noncanonical"
])
export const assistantContentProjectionJobRevisionSchema = z
  .string()
  .regex(/^job:[1-9]\d*:[1-9]\d*$/)

export const assistantContentProjectionChangedEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ready"),
      messageId: z.string().min(1),
      projectionFingerprint: assistantContentProjectionFingerprintSchema,
      revision: assistantContentRevisionSchema,
      threadId: z.string().min(1)
    })
    .strict(),
  z
    .object({
      kind: z.literal("issue"),
      revision: assistantContentProjectionJobRevisionSchema,
      runId: z.string().min(1),
      status: z.enum(["blocked", "failed"]),
      threadId: z.string().min(1)
    })
    .strict()
])

export const assistantContentProjectionInspectionSchema = z.discriminatedUnion("status", [
  z
    .object({
      messageId: z.string().min(1),
      projectionFingerprint: z.string().regex(/^fnv1a64:[a-f0-9]{16}$/),
      status: z.literal("ready")
    })
    .strict(),
  z.object({ messageId: z.string().min(1), status: z.literal("stale") }).strict()
])

export const assistantContentProjectionInspectionListSchema = z.array(
  assistantContentProjectionInspectionSchema
)

export const assistantContentPartsResultSchema = z.discriminatedUnion("status", [
  z
    .object({ projection: assistantContentPartsProjectionSchema, status: z.literal("ready") })
    .strict(),
  z.object({ status: z.literal("pending-stream") }).strict(),
  z
    .object({
      issue: z
        .object({
          code: z.literal("source-invalid"),
          reason: assistantContentProjectionBlockedReasonSchema
        })
        .strict(),
      status: z.literal("blocked")
    })
    .strict(),
  z
    .object({
      issue: z.object({ code: z.literal("retryable-failure") }).strict(),
      status: z.literal("failed")
    })
    .strict()
])

export type AssistantContentPart = z.infer<typeof assistantContentPartSchema>
export type AssistantContentPartsProjection = z.infer<typeof assistantContentPartsProjectionSchema>
export type AssistantContentProjectionChangedEvent = z.infer<
  typeof assistantContentProjectionChangedEventSchema
>
export type AssistantContentProjectionBlockedReason = z.infer<
  typeof assistantContentProjectionBlockedReasonSchema
>
export type AssistantContentProjectionInspection = z.infer<
  typeof assistantContentProjectionInspectionSchema
>
export type AssistantContentPartsResult = z.infer<typeof assistantContentPartsResultSchema>

export interface AssistantDiffProjectedLine {
  lineNumber: number
  side: "after" | "before"
  text: string
}

export function projectAssistantDiffLines(patch: string): AssistantDiffProjectedLine[] {
  let beforeLine = 0
  let afterLine = 0
  const result: AssistantDiffProjectedLine[] = []
  for (const line of patch.split("\n")) {
    const side = line.startsWith("-") && !line.startsWith("---") ? "before" : "after"
    if (side === "before") beforeLine += 1
    else if (line.startsWith("+")) afterLine += 1
    else {
      beforeLine += 1
      afterLine += 1
    }
    result.push({ lineNumber: side === "before" ? beforeLine : afterLine, side, text: line })
  }
  return result
}

export function assistantContentProjectionJobRevision(input: {
  attemptCount: number
  generation: number
}): string {
  return assistantContentProjectionJobRevisionSchema.parse(
    `job:${input.generation}:${input.attemptCount}`
  )
}

export function assistantContentProjectionFingerprint(projection: {
  contentRevision: string
  parts: readonly Pick<AssistantContentPart, "id" | "kind" | "revision">[]
  schemaVersion: 1
}): string {
  let hash = 14695981039346656037n
  const update = (value: string): void => {
    const framed = `${value.length}:${value}`
    for (let index = 0; index < framed.length; index += 1) {
      hash ^= BigInt(framed.charCodeAt(index))
      hash = BigInt.asUintN(64, hash * 1099511628211n)
    }
  }
  update(String(projection.schemaVersion))
  update(projection.contentRevision)
  for (const part of projection.parts) {
    update(part.id)
    update(part.kind)
    update(part.revision)
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`
}

type WithoutContentPartIdentity<T> = T extends unknown ? Omit<T, "id" | "revision"> : never
export type AssistantContentPartInput = WithoutContentPartIdentity<AssistantContentPart>

interface MarkdownSpan {
  end: number
  kind: AssistantContentPart["kind"]
  language: string | null
  start: number
}

function lineOffsets(text: string): number[] {
  const offsets = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") offsets.push(index + 1)
  }
  return offsets
}

function lineEnd(text: string, offsets: readonly number[], line: number): number {
  return line + 1 < offsets.length ? offsets[line + 1]! : text.length
}

function isTableDelimiter(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line)
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim())
}

function projectMarkdownSpans(text: string): MarkdownSpan[] {
  if (!text.trim()) return []
  const offsets = lineOffsets(text)
  const lines = offsets.map((offset, line) =>
    text.slice(offset, lineEnd(text, offsets, line)).replace(/\n$/, "")
  )
  const rich: MarkdownSpan[] = []
  let line = 0

  while (line < lines.length) {
    const fence = /^\s*```\s*([^\s`]*)/.exec(lines[line] ?? "")
    if (fence) {
      let closingLine = line + 1
      while (closingLine < lines.length && !/^\s*```\s*$/.test(lines[closingLine] ?? "")) {
        closingLine += 1
      }
      if (closingLine === lines.length) break
      const language = (fence[1] ?? "").trim().toLowerCase() || null
      rich.push({
        end: lineEnd(text, offsets, closingLine),
        kind: language === "mermaid" ? "mermaid" : language === "diff" ? "diff" : "code",
        language,
        start: offsets[line]!
      })
      line = closingLine + 1
      continue
    }

    if (
      line + 1 < lines.length &&
      (lines[line] ?? "").includes("|") &&
      isTableDelimiter(lines[line + 1] ?? "")
    ) {
      let endLine = line + 2
      while (endLine < lines.length && (lines[endLine] ?? "").trim().includes("|")) {
        endLine += 1
      }
      rich.push({
        end: lineEnd(text, offsets, endLine - 1),
        kind: "table",
        language: null,
        start: offsets[line]!
      })
      line = endLine
      continue
    }
    line += 1
  }

  const spans: MarkdownSpan[] = []
  let cursor = 0
  for (const span of rich) {
    if (text.slice(cursor, span.start).trim()) {
      spans.push({ end: span.start, kind: "narrative", language: null, start: cursor })
    }
    spans.push(span)
    cursor = span.end
  }
  if (text.slice(cursor).trim()) {
    spans.push({ end: text.length, kind: "narrative", language: null, start: cursor })
  }
  return spans
}

function stripFence(value: string): string {
  const firstBreak = value.indexOf("\n")
  const lastFence = value.lastIndexOf("```")
  if (firstBreak < 0 || lastFence <= firstBreak) return ""
  return value.slice(firstBreak + 1, lastFence).replace(/\n$/, "")
}

export function projectAssistantContentPartInputs(
  text: string,
  createId: () => string
): AssistantContentPartInput[] {
  return projectMarkdownSpans(text).map((span): AssistantContentPartInput => {
    const value = text.slice(span.start, span.end)
    if (span.kind === "narrative") {
      return { kind: "narrative", payload: { markdown: value.trim() } }
    }
    if (span.kind === "code") {
      return { kind: "code", payload: { code: stripFence(value), language: span.language } }
    }
    if (span.kind === "diff") {
      return { kind: "diff", payload: { filePath: null, patch: stripFence(value) } }
    }
    if (span.kind === "mermaid") {
      return { kind: "mermaid", payload: { source: stripFence(value) } }
    }

    const lines = value.trim().split("\n")
    const labels = splitTableRow(lines[0] ?? "")
    const columns = labels.map((label) => ({ id: createId(), label }))
    return {
      kind: "table",
      payload: {
        columns,
        rows: lines.slice(2).map((row) => {
          const values = splitTableRow(row)
          return {
            cells: Object.fromEntries(
              columns.map((column, index) => [column.id, values[index] ?? ""])
            ),
            id: createId()
          }
        })
      }
    }
  })
}
