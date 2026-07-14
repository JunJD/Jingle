import { MessageSquarePlus } from "lucide-react"
import { useCallback, useEffect, useEffectEvent, useState } from "react"
import type { ComposerMessageRef } from "@shared/message-content"
import { Button } from "@/components/ui/button"
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

  if (!draft || !onAddRef || draft.ref.sourceThreadId !== threadId) {
    return null
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="fixed z-50 inline-flex h-[30px] -translate-x-1/2 items-center gap-[var(--ow-space-1-5)] rounded-full border border-border/65 bg-background-elevated/94 px-[var(--ow-space-2-5)] [font-size:var(--ow-font-meta)] text-foreground/90 shadow-[0_8px_22px_rgba(0,0,0,0.16)] backdrop-blur-sm transition-colors duration-100 hover:bg-background-secondary/72 hover:text-foreground"
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
    </Button>
  )
}
