import { MessageSquareQuote, X } from "lucide-react"
import {
  extractComposerMessageRefsMetadata,
  type ComposerMessageRef
} from "@shared/message-content"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { getAssistantSelectionRefs } from "./useAssistantSelectionRefs"

type AssistantSelectionRef = Extract<ComposerMessageRef, { type: "assistant-message-selection" }>

function AssistantSelectionPreviewList(props: {
  onRemove?: (ref: AssistantSelectionRef) => void
  refs: readonly AssistantSelectionRef[]
}): React.JSX.Element {
  const { copy } = useI18n()
  const { onRemove, refs } = props

  return (
    <div className="flex max-h-[260px] w-[min(360px,calc(100vw-var(--ow-space-8)))] flex-col gap-[var(--ow-space-2)] overflow-y-auto">
      {refs.map((ref, index) => (
        <div
          key={`${ref.sourceThreadId}:${ref.sourceMessageId}:${index}`}
          className="group/reference flex min-w-0 items-start gap-[var(--ow-space-2)] rounded-[var(--ow-radius-md)] bg-background-secondary px-[var(--ow-space-2-5)] py-[var(--ow-space-2)]"
        >
          <div className="mt-[var(--ow-leading-nudge)] flex size-[var(--ow-icon-sm)] shrink-0 items-center justify-center rounded-full bg-background-elevated text-muted-foreground [font-size:var(--ow-font-caption)]">
            {index + 1}
          </div>
          <div className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-foreground">
            {ref.selectedText}
          </div>
          {onRemove ? (
            <button
              type="button"
              className="mt-[var(--ow-leading-nudge)] inline-flex size-[var(--ow-icon-sm)] shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-70 transition hover:bg-background-interactive hover:text-foreground group-hover/reference:opacity-100"
              aria-label={copy.chat.removeSelectionReference}
              title={copy.chat.removeSelectionReference}
              onClick={() => onRemove(ref)}
            >
              <X className="size-[var(--ow-icon-micro)]" />
            </button>
          ) : null}
        </div>
      ))}
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

  if (refs.length === 0) {
    return null
  }

  const label = copy.chat.selectedTextReferences(refs.length)

  return (
    <Popover>
      <div
        className={cn(
          "flex min-w-0 max-w-full items-center gap-[var(--ow-space-1)]",
          className
        )}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-[30px] max-w-full min-w-0 items-center gap-[var(--ow-space-1-5)] rounded-full border border-border bg-background-secondary px-[var(--ow-space-2-5)] [font-size:var(--ow-font-meta)] text-foreground shadow-sm transition hover:bg-background-interactive"
            title={label}
          >
            <MessageSquareQuote className="size-[var(--ow-icon-sm)] shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{label}</span>
          </button>
        </PopoverTrigger>
        {removable && onClear ? (
          <button
            type="button"
            className="inline-flex size-[24px] shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background-secondary hover:text-foreground"
            aria-label={copy.chat.removeSelectionReference}
            title={copy.chat.removeSelectionReference}
            onClick={onClear}
          >
            <X className="size-[var(--ow-icon-xs)]" />
          </button>
        ) : null}
      </div>
      <PopoverContent
        align="start"
        side="top"
        className="p-[var(--ow-space-2)]"
      >
        <AssistantSelectionPreviewList refs={refs} onRemove={onRemove} />
      </PopoverContent>
    </Popover>
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
