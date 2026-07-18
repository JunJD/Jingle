import type { ContentAnnotation } from "@shared/content-annotation"
import {
  projectAssistantDiffLines,
  type AssistantDiffProjectedLine
} from "@shared/assistant-content-part"
import type { ContentAnchor } from "@shared/content-selection"

type CodeRangeAnchor = Extract<ContentAnchor, { kind: "code-range" }>
type DiffRangeAnchor = Extract<ContentAnchor, { kind: "diff-range" }>
type CandidateResolution<T extends ContentAnchor> =
  | { anchor: T; status: "resolved" }
  | { anchor: null; status: "ambiguous" | "orphaned" }

export type AnchorRevealResult =
  | { anchor: ContentAnchor; status: "resolved"; target: HTMLElement }
  | { anchor: null; status: "ambiguous" | "orphaned"; target: null }

interface QuoteMatch {
  end: number
  start: number
}

function locateUniqueQuote(source: string, quote: string): QuoteMatch | "ambiguous" | "orphaned" {
  if (!quote) return "orphaned"
  let match: QuoteMatch | null = null
  let cursor = source.indexOf(quote)
  while (cursor >= 0) {
    if (match) return "ambiguous"
    match = { end: cursor + quote.length, start: cursor }
    cursor = source.indexOf(quote, cursor + 1)
  }
  return match ?? "orphaned"
}

function sourcePosition(source: string, offset: number): { column: number; line: number } {
  const prefix = source.slice(0, offset)
  const lastLineBreak = prefix.lastIndexOf("\n")
  return {
    column: offset - lastLineBreak,
    line: prefix.split("\n").length
  }
}

export function resolveCodeAnnotationAnchorCandidate(input: {
  anchor: CodeRangeAnchor
  quote: string
  source: string
}): CandidateResolution<CodeRangeAnchor> {
  const match = locateUniqueQuote(input.source, input.quote)
  if (typeof match === "string") return { anchor: null, status: match }
  const start = sourcePosition(input.source, match.start)
  const end = sourcePosition(input.source, match.end)
  return {
    anchor: {
      ...input.anchor,
      endColumn: end.column,
      endLine: end.line,
      startColumn: start.column,
      startLine: start.line
    },
    status: "resolved"
  }
}

interface DiffSideLine extends AssistantDiffProjectedLine {
  end: number
  start: number
}

function resolveDiffAnnotationAnchorFromLines(input: {
  anchor: DiffRangeAnchor
  cardRevision: string
  lines: readonly AssistantDiffProjectedLine[]
  quote: string
}): CandidateResolution<DiffRangeAnchor> {
  let offset = 0
  const projectedLines: DiffSideLine[] = []
  const projectedText: string[] = []
  for (const line of input.lines) {
    if (line.side !== input.anchor.side) continue
    if (projectedText.length > 0) offset += 1
    const start = offset
    projectedText.push(line.text)
    offset += line.text.length
    projectedLines.push({ ...line, end: offset, start })
  }
  const match = locateUniqueQuote(projectedText.join("\n"), input.quote)
  if (typeof match === "string") return { anchor: null, status: match }
  const startLine = projectedLines.find(
    (line) => match.start >= line.start && match.start <= line.end
  )
  const endLine = [...projectedLines]
    .reverse()
    .find((line) => match.end >= line.start && match.end <= line.end)
  if (!startLine || !endLine) return { anchor: null, status: "orphaned" }
  return {
    anchor: {
      ...input.anchor,
      endLine: endLine.lineNumber,
      patchRevision: input.cardRevision,
      startLine: startLine.lineNumber
    },
    status: "resolved"
  }
}

export function resolveDiffAnnotationAnchorCandidate(input: {
  anchor: DiffRangeAnchor
  cardRevision: string
  quote: string
  source: string
}): CandidateResolution<DiffRangeAnchor> {
  return resolveDiffAnnotationAnchorFromLines({
    ...input,
    lines: projectAssistantDiffLines(input.source)
  })
}

function queryDeep(root: HTMLElement, selector: string): HTMLElement | null {
  const direct = root.querySelector<HTMLElement>(selector)
  if (direct) return direct
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    const nested = element.shadowRoot?.querySelector<HTMLElement>(selector)
    if (nested) return nested
  }
  return null
}

function queryDeepAll(root: HTMLElement, selector: string): HTMLElement[] {
  const matches = [...root.querySelectorAll<HTMLElement>(selector)]
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    if (element.shadowRoot) {
      matches.push(...element.shadowRoot.querySelectorAll<HTMLElement>(selector))
    }
  }
  return matches
}

function textNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (node instanceof Text) nodes.push(node)
    node = walker.nextNode()
  }
  return nodes
}

function rangeForOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const nodes = textNodes(root)
  let cursor = 0
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0
  for (const node of nodes) {
    const next = cursor + node.data.length
    if (!startNode && start >= cursor && start <= next) {
      startNode = node
      startOffset = start - cursor
    }
    if (end >= cursor && end <= next) {
      endNode = node
      endOffset = end - cursor
      break
    }
    cursor = next
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

function revealRange(range: Range): void {
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  const element =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement
  element?.scrollIntoView({ behavior: "smooth", block: "center" })
}

function resolveText(root: HTMLElement, annotation: ContentAnnotation): AnchorRevealResult {
  if (annotation.anchor.kind !== "text-range") {
    return { anchor: null, status: "orphaned", target: null }
  }
  let start = annotation.anchor.start
  let end = annotation.anchor.end
  const text = root.textContent ?? ""
  if (text.slice(start, end) !== annotation.quote) {
    const matches: number[] = []
    let cursor = text.indexOf(annotation.quote)
    while (cursor >= 0) {
      matches.push(cursor)
      cursor = text.indexOf(annotation.quote, cursor + 1)
    }
    if (matches.length !== 1) {
      return {
        anchor: null,
        status: matches.length > 1 ? "ambiguous" : "orphaned",
        target: null
      }
    }
    start = matches[0]!
    end = start + annotation.quote.length
  }
  const range = rangeForOffsets(root, start, end)
  if (!range) return { anchor: null, status: "orphaned", target: null }
  revealRange(range)
  return {
    anchor: { ...annotation.anchor, end, start },
    status: "resolved",
    target: root
  }
}

function renderedDiffLines(root: HTMLElement): AssistantDiffProjectedLine[] {
  return queryDeepAll(root, "[data-diff-side][data-diff-line][data-diff-text]").flatMap(
    (element) => {
      const lineNumber = Number(element.dataset.diffLine)
      const side = element.dataset.diffSide
      const text = element.dataset.diffText
      return Number.isInteger(lineNumber) &&
        lineNumber > 0 &&
        (side === "after" || side === "before") &&
        text !== undefined
        ? [{ lineNumber, side, text }]
        : []
    }
  )
}

export function revealContentAnnotationAnchor(
  root: HTMLElement,
  annotation: ContentAnnotation,
  cardRevision: string
): AnchorRevealResult {
  const anchor = annotation.anchor
  if (anchor.kind === "whole-card") {
    root.scrollIntoView({ behavior: "smooth", block: "center" })
    return { anchor, status: "resolved", target: root }
  }
  if (anchor.kind === "text-range") return resolveText(root, annotation)
  if (anchor.kind === "table-cell") {
    const target = root.querySelector<HTMLElement>(
      `[data-table-row-id="${CSS.escape(anchor.rowId)}"] [data-table-column-id="${CSS.escape(anchor.columnId)}"]`
    )
    target?.scrollIntoView({ behavior: "smooth", block: "center" })
    return target
      ? { anchor, status: "resolved", target }
      : { anchor: null, status: "orphaned", target: null }
  }
  if (anchor.kind === "diff-range") {
    const resolution = resolveDiffAnnotationAnchorFromLines({
      anchor,
      cardRevision,
      lines: renderedDiffLines(root),
      quote: annotation.quote
    })
    if (resolution.status !== "resolved") return { ...resolution, target: null }
    const target = queryDeep(
      root,
      `[data-diff-side="${resolution.anchor.side}"][data-diff-line="${resolution.anchor.startLine}"]`
    )
    if (!target) return { anchor: null, status: "orphaned", target: null }
    target.scrollIntoView({ behavior: "smooth", block: "center" })
    return { anchor: resolution.anchor, status: "resolved", target }
  }
  const code = root.querySelector<HTMLElement>("code")
  if (!code) return { anchor: null, status: "orphaned", target: null }
  const source = code.textContent ?? ""
  const resolution = resolveCodeAnnotationAnchorCandidate({
    anchor,
    quote: annotation.quote,
    source
  })
  if (resolution.status !== "resolved") return { ...resolution, target: null }
  const match = locateUniqueQuote(source, annotation.quote)
  if (typeof match === "string") return { anchor: null, status: match, target: null }
  const range = rangeForOffsets(code, match.start, match.end)
  if (!range) return { anchor: null, status: "orphaned", target: null }
  revealRange(range)
  return { anchor: resolution.anchor, status: "resolved", target: code }
}
