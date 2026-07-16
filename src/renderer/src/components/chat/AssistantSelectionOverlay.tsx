import { MessageSquarePlus, Quote } from "lucide-react"
import { useCallback, useEffect, useEffectEvent, useState } from "react"
import type { ComposerMessageRef } from "@shared/message-content"
import { contentCardIdentitySchema } from "@shared/content-card"
import type { ContentAnchor, ContentSelectionDraft } from "@shared/content-selection"
import { Button } from "@/components/ui/button"
import { toAssistantSelectionRef } from "@/lib/text-content-selection-adapter"
import { useContentAnnotations } from "./ContentAnnotationsContext"

type AssistantSelectionRef = Extract<ComposerMessageRef, { type: "assistant-message-selection" }>

interface AssistantSelectionDraft {
  annotationEnabled: boolean
  rect: { left: number; top: number }
  selection: ContentSelectionDraft
}

function closestSelectionSurface(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement
  const direct = element?.closest<HTMLElement>("[data-assistant-selection-source='true']") ?? null
  if (direct) return direct
  const root = node?.getRootNode()
  return root instanceof ShadowRoot
    ? root.host.closest<HTMLElement>("[data-assistant-selection-source='true']")
    : null
}

function readCard(surface: HTMLElement) {
  const card = surface.closest<HTMLElement>("[data-content-card-id]")
  if (!card) return null
  const parsed = contentCardIdentitySchema.safeParse({
    cardId: card.dataset.contentCardId,
    kind: card.dataset.contentCardKind,
    revision: card.dataset.contentCardRevision,
    slot: card.dataset.contentCardSlot,
    sourceId: card.dataset.contentCardSourceId,
    sourceType: card.dataset.contentCardSourceType,
    threadId: card.dataset.contentCardThreadId
  })
  return parsed.success ? parsed.data : null
}

function hashSelectionContext(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function textOffset(surface: HTMLElement, container: Node, offset: number): number {
  const prefix = document.createRange()
  prefix.selectNodeContents(surface)
  prefix.setEnd(container, offset)
  return prefix.toString().length
}

function projectAnchor(
  surface: HTMLElement,
  range: Range,
  rawSelectedText: string
): ContentAnchor | null {
  const card = readCard(surface)
  if (!card) return null
  if (card.kind === "table") {
    const anchorCell = (
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
    )?.closest<HTMLElement>("td,th")
    const focusCell = (
      range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
    )?.closest<HTMLElement>("td,th")
    if (!anchorCell || anchorCell !== focusCell) return null
    const rowId = anchorCell.closest<HTMLElement>("tr")?.dataset.tableRowId ?? "header"
    const columnId = anchorCell.dataset.tableColumnId
    return columnId ? { columnId, kind: "table-cell", rowId } : null
  }
  if (card.kind === "diff") {
    const start = (
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
    )?.closest<HTMLElement>("[data-diff-line],[data-line]")
    const end = (
      range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
    )?.closest<HTMLElement>("[data-diff-line],[data-line]")
    const startLine = Number(start?.dataset.diffLine ?? start?.dataset.line)
    const endLine = Number(end?.dataset.diffLine ?? end?.dataset.line)
    if (!start || !end || !Number.isInteger(startLine) || !Number.isInteger(endLine)) return null
    const startSide =
      start.dataset.diffSide === "before" || start.dataset.lineType?.includes("deletion")
        ? "before"
        : "after"
    const endSide =
      end.dataset.diffSide === "before" || end.dataset.lineType?.includes("deletion")
        ? "before"
        : "after"
    if (startSide !== endSide) return null
    return {
      endLine: Math.max(startLine, endLine),
      filePath: start.closest<HTMLElement>("[data-file-mutation-path]")?.dataset
        .fileMutationPath ?? null,
      kind: "diff-range",
      patchRevision: card.revision,
      side: startSide,
      startLine: Math.min(startLine, endLine)
    }
  }
  const leadingWhitespace = rawSelectedText.length - rawSelectedText.trimStart().length
  const start = textOffset(surface, range.startContainer, range.startOffset) + leadingWhitespace
  const quoteLength = rawSelectedText.trim().length
  if (card.kind === "code") {
    const before = (surface.textContent ?? "").slice(0, start)
    const selected = rawSelectedText.trim()
    const startLine = before.split("\n").length
    return {
      blockId: card.slot,
      endColumn: selected.includes("\n")
        ? undefined
        : (before.split("\n").at(-1)?.length ?? 0) + selected.length + 1,
      endLine: startLine + selected.split("\n").length - 1,
      kind: "code-range",
      startColumn: (before.split("\n").at(-1)?.length ?? 0) + 1,
      startLine
    }
  }
  return { blockId: card.slot, end: start + quoteLength, kind: "text-range", start }
}

function getSelectionDraft(threadId: string): AssistantSelectionDraft | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const rawSelectedText = selection.toString()
  const quote = rawSelectedText.trim()
  if (!quote) return null
  const anchorSurface = closestSelectionSurface(selection.anchorNode)
  const focusSurface = closestSelectionSurface(selection.focusNode)
  if (!anchorSurface || anchorSurface !== focusSurface) return null
  const card = readCard(anchorSurface)
  if (!card || card.threadId !== threadId) return null
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  const anchor = projectAnchor(anchorSurface, range, rawSelectedText)
  if (!anchor) return null
  const surfaceText = anchorSurface.textContent ?? ""
  return {
    annotationEnabled:
      anchorSurface.closest<HTMLElement>("[data-content-card-id]")?.dataset
        .contentCardAnnotationEnabled === "true",
    rect: { left: Math.round(rect.left + rect.width / 2), top: Math.round(rect.bottom + 8) },
    selection: {
      anchor,
      anchorResolution:
        anchorSurface.dataset.assistantMessageStreaming === "true" ? "pending-stream" : "resolved",
      card,
      contextHash: hashSelectionContext(surfaceText),
      quote
    }
  }
}

export function AssistantSelectionOverlay(props: {
  onAddRef?: (ref: AssistantSelectionRef) => void
  threadId: string
}): React.JSX.Element | null {
  const { onAddRef, threadId } = props
  const annotations = useContentAnnotations()
  const [draft, setDraft] = useState<AssistantSelectionDraft | null>(null)
  const [annotationOpen, setAnnotationOpen] = useState(false)
  const [body, setBody] = useState("")

  const refreshSelection = useCallback((): void => {
    if (!annotationOpen) setDraft(getSelectionDraft(threadId))
  }, [annotationOpen, threadId])
  const refreshSelectionEvent = useEffectEvent(refreshSelection)

  useEffect(() => {
    document.addEventListener("selectionchange", refreshSelectionEvent)
    window.addEventListener("scroll", refreshSelectionEvent, true)
    window.addEventListener("resize", refreshSelectionEvent)
    return () => {
      document.removeEventListener("selectionchange", refreshSelectionEvent)
      window.removeEventListener("scroll", refreshSelectionEvent, true)
      window.removeEventListener("resize", refreshSelectionEvent)
    }
  }, [])

  if (!draft) return null
  return (
    <div
      className="fixed z-50 -translate-x-1/2 rounded-[var(--jingle-radius-md)] border border-border bg-background-elevated p-1 shadow-lg"
      onMouseDown={(event) => event.preventDefault()}
      style={{ left: draft.rect.left, top: draft.rect.top }}
    >
      {annotationOpen ? (
        <div className="w-[min(320px,calc(100vw-24px))] p-1">
          <textarea
            aria-label="批注内容"
            autoFocus
            className="min-h-20 w-full resize-y rounded border border-border bg-background p-2 text-[var(--jingle-font-body)] outline-none focus:ring-2 focus:ring-ring"
            onChange={(event) => setBody(event.currentTarget.value)}
            placeholder="写下批注"
            value={body}
          />
          <div className="mt-1 flex justify-end gap-1">
            <Button onClick={() => setAnnotationOpen(false)} size="sm" variant="ghost">
              取消
            </Button>
            <Button
              disabled={!body.trim() || draft.selection.anchorResolution === "pending-stream"}
              onClick={() =>
                void annotations.create(draft.selection, body.trim(), "comment").then(() => {
                  setBody("")
                  setDraft(null)
                  setAnnotationOpen(false)
                  window.getSelection()?.removeAllRanges()
                })
              }
              size="sm"
            >
              创建批注
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          {onAddRef ? (
            <Button
              onClick={() => {
                onAddRef(toAssistantSelectionRef(draft.selection))
                setDraft(null)
                window.getSelection()?.removeAllRanges()
              }}
              size="sm"
              variant="ghost"
            >
              <Quote className="mr-1 size-3.5" />
              加入输入
            </Button>
          ) : null}
          {draft.annotationEnabled ? (
            <Button
              disabled={draft.selection.anchorResolution === "pending-stream"}
              onClick={() => setAnnotationOpen(true)}
              size="sm"
              variant="ghost"
            >
              <MessageSquarePlus className="mr-1 size-3.5" />
              批注
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}
