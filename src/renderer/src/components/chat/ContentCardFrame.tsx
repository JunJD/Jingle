import { ChevronDown, Maximize2, MessageSquarePlus } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { ContentCardIdentity } from "@shared/content-card"
import type { ContentSelectionDraft } from "@shared/content-selection"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useCardAnnotations, useContentAnnotations } from "./ContentAnnotationsContext"
import { revealContentAnnotationAnchor } from "@/lib/content-annotation-reveal"

export function ContentCardFrame(props: {
  annotationEnabled?: boolean
  children: ReactNode | ((expanded: boolean) => ReactNode)
  className?: string
  collapsed?: boolean
  collapsible?: boolean
  defaultCollapsed?: boolean
  fullscreenChildren?: ReactNode | ((expanded: boolean) => ReactNode)
  identity: ContentCardIdentity
  onCollapsedChange?: (collapsed: boolean) => void
  selection: ContentSelectionDraft
  title: ReactNode
}): React.JSX.Element {
  const {
    annotationEnabled = true,
    children,
    className,
    collapsed: controlledCollapsed,
    collapsible = true,
    defaultCollapsed = false,
    fullscreenChildren = children,
    identity,
    onCollapsedChange,
    selection,
    title
  } = props
  const annotations = useContentAnnotations()
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const collapsed = controlledCollapsed ?? internalCollapsed
  const [fullscreen, setFullscreen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [body, setBody] = useState("")
  const cardRef = useRef<HTMLDivElement | null>(null)
  const fullscreenTriggerRef = useRef<HTMLButtonElement | null>(null)
  const cardAnnotations = useCardAnnotations(identity.cardId)
  const setCollapsed = useCallback(
    (nextCollapsed: boolean): void => {
      onCollapsedChange?.(nextCollapsed)
      if (controlledCollapsed === undefined) setInternalCollapsed(nextCollapsed)
    },
    [controlledCollapsed, onCollapsedChange]
  )

  const reveal = useCallback(
    (annotation: Parameters<typeof revealContentAnnotationAnchor>[1]): void => {
      setCollapsed(false)
      setFullscreen(false)
      requestAnimationFrame(() => {
        const card = cardRef.current
        if (!card) return
        const selectionSurface =
          card.querySelector<HTMLElement>("[data-assistant-selection-source='true']") ?? card
        const result = revealContentAnnotationAnchor(selectionSurface, annotation)
        if (result.target && result.target.tabIndex < 0) result.target.tabIndex = -1
        result.target?.focus({ preventScroll: true })
        if (result.status !== annotation.anchorResolution) {
          void annotations.update({
            expectedRevision: annotation.revision,
            id: annotation.id,
            repair: {
              anchor: annotation.anchor,
              anchorResolution: result.status,
              cardRevision: identity.revision,
              contextHash: annotation.contextHash,
              quote: annotation.quote
            }
          })
        }
      })
    },
    [annotations, identity.revision, setCollapsed]
  )

  useEffect(
    () => annotations.registerReveal(identity.cardId, { reveal }),
    [annotations, identity.cardId, reveal]
  )

  const submit = useCallback(
    async (intent: "comment" | "suggestion"): Promise<void> => {
      const value = body.trim()
      if (!value) return
      await annotations.create(selection, value, intent)
      setBody("")
      setComposerOpen(false)
    },
    [annotations, body, selection]
  )

  return (
    <section
      ref={cardRef}
      className={cn(
        "group/content-card relative min-w-0 rounded-[var(--jingle-radius-panel)] border border-border/55 bg-background-elevated/28",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      data-content-card-id={identity.cardId}
      data-content-card-annotation-enabled={annotationEnabled ? "true" : "false"}
      data-content-card-kind={identity.kind}
      data-content-card-revision={identity.revision}
      data-content-card-slot={identity.slot}
      data-content-card-source-id={identity.sourceId}
      data-content-card-source-type={identity.sourceType}
      data-content-card-thread-id={identity.threadId}
      tabIndex={-1}
    >
      <div className="flex min-h-8 items-center gap-1 border-b border-border/45 px-2">
        {collapsible ? (
          <button
            aria-expanded={!collapsed}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[var(--jingle-font-meta)] text-muted-foreground"
            onClick={() => setCollapsed(!collapsed)}
            type="button"
          >
            <ChevronDown
              className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")}
            />
            <span className="truncate">{title}</span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center text-[var(--jingle-font-meta)] text-muted-foreground">
            <span className="truncate">{title}</span>
          </div>
        )}
        {cardAnnotations.map((annotation, index) => (
          <button
            aria-label={`批注 ${index + 1}`}
            className="flex size-5 items-center justify-center rounded-full bg-background-secondary text-[10px] tabular-nums text-foreground hover:bg-background-interactive"
            key={annotation.id}
            onClick={() => annotations.reveal(annotation)}
            type="button"
          >
            {index + 1}
          </button>
        ))}
        {annotationEnabled ? (
          <IconButton
            label="创建批注"
            onClick={() => setComposerOpen((value) => !value)}
            size="icon-sm"
            variant="ghost"
          >
            <MessageSquarePlus className="size-3.5" />
          </IconButton>
        ) : null}
        <IconButton
          ref={fullscreenTriggerRef}
          label="全屏查看"
          onClick={() => setFullscreen(true)}
          size="icon-sm"
          variant="ghost"
        >
          <Maximize2 className="size-3.5" />
        </IconButton>
      </div>
      {annotationEnabled && composerOpen ? (
        <div className="border-b border-border/45 p-2">
          <textarea
            aria-label="批注内容"
            autoFocus
            className="min-h-20 w-full resize-y rounded-[var(--jingle-radius-md)] border border-border bg-background px-2.5 py-2 text-[var(--jingle-font-body)] outline-none focus:ring-2 focus:ring-ring"
            onChange={(event) => setBody(event.currentTarget.value)}
            placeholder="写下批注或修改建议"
            value={body}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={() => setComposerOpen(false)} size="sm" variant="ghost">
              取消
            </Button>
            <Button
              disabled={!body.trim()}
              onClick={() => void submit("comment")}
              size="sm"
              variant="secondary"
            >
              评论
            </Button>
            <Button disabled={!body.trim()} onClick={() => void submit("suggestion")} size="sm">
              建议修改
            </Button>
          </div>
        </div>
      ) : null}
      {!collapsed ? (
        <div className="min-w-0 p-3">
          {typeof children === "function" ? children(true) : children}
        </div>
      ) : null}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent
          closeLabel="关闭全屏"
          className="h-[min(88vh,900px)] w-[min(94vw,1100px)] max-w-none grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            fullscreenTriggerRef.current?.focus()
          }}
        >
          <DialogTitle className="border-b border-border px-4 py-3 text-[var(--jingle-font-control)]">
            {title}
          </DialogTitle>
          <div
            className="min-h-0 overflow-auto p-5"
            data-content-card-id={identity.cardId}
            data-content-card-annotation-enabled={annotationEnabled ? "true" : "false"}
            data-content-card-kind={identity.kind}
            data-content-card-revision={identity.revision}
            data-content-card-slot={identity.slot}
            data-content-card-source-id={identity.sourceId}
            data-content-card-source-type={identity.sourceType}
            data-content-card-thread-id={identity.threadId}
          >
            {typeof fullscreenChildren === "function"
              ? fullscreenChildren(true)
              : fullscreenChildren}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
