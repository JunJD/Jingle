import { Check, MessageSquareText, Trash2, X } from "lucide-react"
import { useEffect, useRef } from "react"
import type { ComposerMessageRef } from "@shared/message-content"
import {
  createContentAnnotationAgentContext,
  serializeContentAnnotationAgentContext
} from "@shared/content-annotation-agent-context"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import {
  useContentAnnotations,
  useContentAnnotationRecords,
  useContentAnnotationsSidebar
} from "./ContentAnnotationsContext"

type AssistantSelectionRef = Extract<ComposerMessageRef, { type: "assistant-message-selection" }>

function sourceMessageId(cardId: string): string | null {
  const segments = cardId.split(":")
  if (segments[0] !== "message" || !segments[1]) return null
  try {
    return decodeURIComponent(segments[1])
  } catch {
    return null
  }
}

export function ContentAnnotationsSidebar(props: {
  onAddPromptRef?: (ref: AssistantSelectionRef) => void
}): React.JSX.Element {
  const annotations = useContentAnnotations()
  const annotationRecords = useContentAnnotationRecords()
  const sidebar = useContentAnnotationsSidebar()
  const { open: sidebarOpen, setOpen: setSidebarOpen } = sidebar
  const visible = annotationRecords.filter((annotation) => annotation.deletedAt === null)
  const sidebarRef = useRef<HTMLElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!sidebarOpen) return undefined
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => sidebarRef.current?.focus())
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setSidebarOpen(false)
      requestAnimationFrame(() => returnFocusRef.current?.focus())
    }
    window.addEventListener("keydown", handleEscape)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("keydown", handleEscape)
    }
  }, [setSidebarOpen, sidebarOpen])

  const closeSidebar = (): void => {
    setSidebarOpen(false)
    requestAnimationFrame(() => returnFocusRef.current?.focus())
  }

  return (
    <>
      <IconButton
        className="fixed bottom-4 right-4 z-30 shadow-md"
        label="打开批注"
        onClick={() => setSidebarOpen(true)}
        size="icon"
        variant="secondary"
      >
        <MessageSquareText className="size-4" />
        {visible.length > 0 ? <span className="sr-only">{visible.length}</span> : null}
      </IconButton>
      {sidebarOpen ? (
        <aside
          ref={sidebarRef}
          aria-label="批注"
          className="fixed inset-y-3 right-3 z-40 flex w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-[var(--jingle-radius-dialog)] border border-border bg-background shadow-xl"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              closeSidebar()
            }
          }}
          tabIndex={-1}
        >
          <header className="flex h-11 items-center justify-between border-b border-border px-3">
            <div className="text-[var(--jingle-font-control)] font-medium">
              批注 · {visible.length}
            </div>
            <IconButton
              label="关闭批注"
              onClick={closeSidebar}
              size="icon-sm"
              variant="ghost"
            >
              <X className="size-4" />
            </IconButton>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {visible.length === 0 ? (
              <div className="px-3 py-10 text-center text-[var(--jingle-font-body)] text-muted-foreground">
                暂无批注
              </div>
            ) : (
              <div className="space-y-2">
                {visible.map((annotation) => (
                  <article
                    className="rounded-[var(--jingle-radius-md)] border border-border/60 p-3"
                    key={annotation.id}
                  >
                    <button
                      className="w-full text-left"
                      onClick={() => annotations.reveal(annotation)}
                      type="button"
                    >
                      <div className="line-clamp-2 text-[var(--jingle-font-meta)] text-muted-foreground">
                        “{annotation.quote}”
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-[var(--jingle-font-body)]">
                        {annotation.body}
                      </div>
                      <div className="mt-2 text-[var(--jingle-font-caption)] text-muted-foreground">
                        {annotation.anchorResolution} · {annotation.lifecycle}
                      </div>
                    </button>
                    <div className="mt-2 flex items-center justify-end gap-1">
                      {props.onAddPromptRef && sourceMessageId(annotation.cardId) ? (
                        <Button
                          onClick={() =>
                            props.onAddPromptRef?.({
                              selectedText: serializeContentAnnotationAgentContext(
                                createContentAnnotationAgentContext(annotation)
                              ),
                              sourceMessageId: sourceMessageId(annotation.cardId)!,
                              sourceThreadId: annotation.threadId,
                              type: "assistant-message-selection"
                            })
                          }
                          size="sm"
                          variant="ghost"
                        >
                          {annotation.intent === "suggestion" ? "根据批注修改" : "加入输入"}
                        </Button>
                      ) : null}
                      <IconButton
                        label={annotation.lifecycle === "open" ? "标记已解决" : "重新打开"}
                        onClick={() =>
                          void annotations.update({
                            expectedRevision: annotation.revision,
                            id: annotation.id,
                            lifecycle: annotation.lifecycle === "open" ? "resolved" : "open"
                          })
                        }
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Check className="size-3.5" />
                      </IconButton>
                      <IconButton
                        label="删除批注"
                        onClick={() => void annotations.remove(annotation)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </aside>
      ) : null}
    </>
  )
}
