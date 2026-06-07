import { MessageSquarePlus } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import type { ComposerMessageRef } from "@shared/message-content"
import { useI18n } from "@/lib/i18n"

type AssistantSelectionRef = Extract<ComposerMessageRef, { type: "assistant-message-selection" }>

interface AssistantSelectionDraft {
  rect: {
    left: number
    top: number
  }
  ref: AssistantSelectionRef
}

function closestAssistantMessageElement(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest<HTMLElement>("[data-assistant-selection-source='true']") ?? null
}

function getSelectionDraft(threadId: string): AssistantSelectionDraft | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }

  const selectedText = selection.toString().trim()
  if (!selectedText) {
    return null
  }

  const anchorMessage = closestAssistantMessageElement(selection.anchorNode)
  const focusMessage = closestAssistantMessageElement(selection.focusNode)
  if (!anchorMessage || !focusMessage || anchorMessage !== focusMessage) {
    return null
  }

  const sourceMessageId = anchorMessage.dataset.assistantMessageId?.trim()
  if (!sourceMessageId) {
    return null
  }

  const range = selection.getRangeAt(0)
  const rangeRect = range.getBoundingClientRect()
  if (rangeRect.width === 0 && rangeRect.height === 0) {
    return null
  }

  return {
    rect: {
      left: Math.round(rangeRect.left + rangeRect.width / 2),
      top: Math.round(rangeRect.bottom + 8)
    },
    ref: {
      selectedText,
      sourceMessageId,
      sourceThreadId: threadId,
      type: "assistant-message-selection"
    }
  }
}

export function AssistantSelectionOverlay(props: {
  onAddRef?: (ref: AssistantSelectionRef) => void
  threadId: string
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { onAddRef, threadId } = props
  const [draft, setDraft] = useState<AssistantSelectionDraft | null>(null)

  const refreshSelection = useCallback((): void => {
    if (!onAddRef) {
      setDraft(null)
      return
    }

    setDraft(getSelectionDraft(threadId))
  }, [onAddRef, threadId])

  useEffect(() => {
    document.addEventListener("selectionchange", refreshSelection)
    window.addEventListener("scroll", refreshSelection, true)
    window.addEventListener("resize", refreshSelection)

    return () => {
      document.removeEventListener("selectionchange", refreshSelection)
      window.removeEventListener("scroll", refreshSelection, true)
      window.removeEventListener("resize", refreshSelection)
    }
  }, [refreshSelection])

  if (!draft || !onAddRef) {
    return null
  }

  return (
    <button
      type="button"
      className="fixed z-50 inline-flex h-[32px] -translate-x-1/2 items-center gap-[var(--ow-space-1-5)] rounded-full border border-border/70 bg-background-elevated px-[var(--ow-space-2-5)] [font-size:var(--ow-font-meta)] text-foreground shadow-lg transition hover:bg-background-interactive"
      style={{
        left: draft.rect.left,
        top: draft.rect.top
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        onAddRef(draft.ref)
        window.getSelection()?.removeAllRanges()
        setDraft(null)
      }}
    >
      <MessageSquarePlus className="size-[var(--ow-icon-sm)] text-muted-foreground" />
      <span>{copy.chat.addSelectionToChat}</span>
    </button>
  )
}
