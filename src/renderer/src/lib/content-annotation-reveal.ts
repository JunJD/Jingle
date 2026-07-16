import type { ContentAnnotation } from "@shared/content-annotation"

export interface AnchorRevealResult {
  status: "ambiguous" | "orphaned" | "resolved"
  target: HTMLElement | null
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
  if (annotation.anchor.kind !== "text-range") return { status: "orphaned", target: null }
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
      return { status: matches.length > 1 ? "ambiguous" : "orphaned", target: null }
    }
    start = matches[0]!
    end = start + annotation.quote.length
  }
  const range = rangeForOffsets(root, start, end)
  if (!range) return { status: "orphaned", target: null }
  revealRange(range)
  return { status: "resolved", target: root }
}

export function revealContentAnnotationAnchor(
  root: HTMLElement,
  annotation: ContentAnnotation
): AnchorRevealResult {
  const anchor = annotation.anchor
  if (anchor.kind === "whole-card") {
    root.scrollIntoView({ behavior: "smooth", block: "center" })
    return { status: "resolved", target: root }
  }
  if (anchor.kind === "text-range") return resolveText(root, annotation)
  if (anchor.kind === "table-cell") {
    const target = root.querySelector<HTMLElement>(
      `[data-table-row-id="${CSS.escape(anchor.rowId)}"] [data-table-column-id="${CSS.escape(anchor.columnId)}"]`
    )
    target?.scrollIntoView({ behavior: "smooth", block: "center" })
    return { status: target ? "resolved" : "orphaned", target }
  }
  if (anchor.kind === "diff-range") {
    const target =
      queryDeep(root, `[data-diff-side="${anchor.side}"][data-diff-line="${anchor.startLine}"]`) ??
      queryDeep(root, `[data-line="${anchor.startLine}"]`)
    target?.scrollIntoView({ behavior: "smooth", block: "center" })
    return { status: target ? "resolved" : "orphaned", target }
  }
  const code = root.querySelector<HTMLElement>("code")
  if (!code) return { status: "orphaned", target: null }
  const lines = (code.textContent ?? "").split("\n")
  const start = lines
    .slice(0, anchor.startLine - 1)
    .reduce((length, line) => length + line.length + 1, 0)
  const end =
    lines.slice(0, anchor.endLine).reduce((length, line) => length + line.length + 1, 0) - 1
  const range = rangeForOffsets(code, start, Math.max(start, end))
  if (!range) return { status: "orphaned", target: null }
  revealRange(range)
  return { status: "resolved", target: code }
}
