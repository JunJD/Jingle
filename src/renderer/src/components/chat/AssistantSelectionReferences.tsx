import { MessageSquareQuote, X } from "lucide-react"
import {
  extractComposerMessageRefsMetadata,
  type ComposerMessageRef
} from "@shared/message-content"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import {
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger
} from "@/components/attachments"
import { useAssistantSelectionReferenceNavigation } from "./assistant-selection-reference-navigation-context"
import { getAssistantSelectionRefs } from "./useAssistantSelectionRefs"

type AssistantSelectionRef = Extract<ComposerMessageRef, { type: "assistant-message-selection" }>

function AssistantSelectionPreviewList(props: {
  onRemove?: (ref: AssistantSelectionRef) => void
  refs: readonly AssistantSelectionRef[]
}): React.JSX.Element {
  const { copy } = useI18n()
  const { onRemove, refs } = props
  const referenceNavigation = useAssistantSelectionReferenceNavigation()

  return (
    <div className="flex max-h-[260px] w-[min(360px,calc(100vw-var(--jingle-space-8)))] flex-col gap-[var(--jingle-space-1-5)] overflow-y-auto">
      {refs.map((ref, index) => {
        const canReveal =
          referenceNavigation !== null && referenceNavigation.canRevealReference(ref)
        return (
          <div
            key={`${ref.sourceThreadId}:${ref.sourceMessageId}:${index}`}
            className="group/reference flex min-w-0 items-start gap-[var(--jingle-space-2)] rounded-[var(--jingle-radius-md)] bg-background-secondary/45 px-[var(--jingle-space-2-5)] py-[var(--jingle-space-2)]"
          >
            <button
              type="button"
              className="mt-[var(--jingle-leading-nudge)] flex size-[var(--jingle-icon-sm)] shrink-0 items-center justify-center rounded-full bg-background-elevated/60 text-muted-foreground [font-size:var(--jingle-font-caption)] transition-colors enabled:hover:bg-background-secondary/80 enabled:hover:text-foreground disabled:cursor-default"
              aria-label={copy.chat.revealSelectionReference}
              disabled={!canReveal}
              title={canReveal ? copy.chat.revealSelectionReference : undefined}
              onClick={() => {
                if (referenceNavigation === null || !referenceNavigation.canRevealReference(ref)) {
                  return
                }

                referenceNavigation.revealReference(ref)
              }}
            >
              {index + 1}
            </button>
            <button
              type="button"
              className="min-w-0 flex-1 whitespace-pre-wrap text-left [overflow-wrap:anywhere] [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-foreground/88 transition-colors enabled:hover:text-foreground disabled:cursor-default"
              disabled={!canReveal}
              title={canReveal ? copy.chat.revealSelectionReference : undefined}
              onClick={() => {
                if (referenceNavigation === null || !referenceNavigation.canRevealReference(ref)) {
                  return
                }

                referenceNavigation.revealReference(ref)
              }}
            >
              {ref.selectedText}
            </button>
            {onRemove ? (
              <button
                type="button"
                className="mt-[var(--jingle-leading-nudge)] inline-flex size-[var(--jingle-icon-sm)] shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-60 transition-colors hover:bg-background-secondary/70 hover:text-foreground group-hover/reference:opacity-100"
                aria-label={copy.chat.removeSelectionReference}
                title={copy.chat.removeSelectionReference}
                onClick={() => onRemove(ref)}
              >
                <X className="size-[var(--jingle-icon-micro)]" />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function AssistantSelectionReferencePill(props: {
  className?: string
  onClear?: () => void
  onRemove?: (ref: AssistantSelectionRef) => void
  refs: readonly AssistantSelectionRef[]
  removable?: boolean
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { className, onClear, onRemove, refs, removable = false } = props
  const referenceNavigation = useAssistantSelectionReferenceNavigation()

  if (refs.length === 0) {
    return null
  }

  const label = copy.chat.selectedTextReferences(refs.length)
  const firstRevealableRef =
    referenceNavigation === null
      ? null
      : refs.find((ref) => referenceNavigation.canRevealReference(ref))

  return (
    <AttachmentHoverCard closeDelay={180}>
      <div
        className={cn("flex min-w-0 max-w-full items-center gap-[var(--jingle-space-1)]", className)}
      >
        <AttachmentHoverCardTrigger asChild>
          <button
            type="button"
            className="inline-flex h-[28px] max-w-full min-w-0 items-center gap-[var(--jingle-space-1-5)] rounded-full border border-border/60 bg-background-secondary/42 px-[var(--jingle-space-2-5)] [font-size:var(--jingle-font-meta)] text-muted-foreground transition-colors duration-100 hover:border-border/75 hover:bg-background-secondary/62 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={label}
            onClick={() => {
              if (referenceNavigation !== null && firstRevealableRef) {
                referenceNavigation.revealReference(firstRevealableRef)
              }
            }}
          >
            <MessageSquareQuote className="size-[var(--jingle-icon-sm)] shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{label}</span>
          </button>
        </AttachmentHoverCardTrigger>
        {removable && onClear ? (
          <button
            type="button"
            className="inline-flex size-[24px] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-100 hover:bg-background-secondary/62 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={copy.chat.removeSelectionReference}
            title={copy.chat.removeSelectionReference}
            onClick={onClear}
          >
            <X className="size-[var(--jingle-icon-xs)]" />
          </button>
        ) : null}
      </div>
      <AttachmentHoverCardContent
        align="start"
        side="top"
        className="border-border/70 bg-popover/96 p-[var(--jingle-space-2)] shadow-[0_10px_28px_rgba(0,0,0,0.14)]"
      >
        <AssistantSelectionPreviewList refs={refs} onRemove={onRemove} />
      </AttachmentHoverCardContent>
    </AttachmentHoverCard>
  )
}

export function AssistantSelectionReferencesFromMetadata(props: {
  className?: string
  metadata?: unknown
}): React.JSX.Element | null {
  const { className, metadata } = props
  const refs = getAssistantSelectionRefs(extractComposerMessageRefsMetadata(metadata))

  return <AssistantSelectionReferencePill className={className} refs={refs} />
}
