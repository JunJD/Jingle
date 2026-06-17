import { AlertCircle, X } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function AgentErrorNotice(props: {
  className?: string
  error: string
  onDismiss?: () => void
}): React.JSX.Element {
  const { className, error, onDismiss } = props
  const { copy } = useI18n()

  return (
    <div
      className={cn(
        "flex w-full min-w-0 items-start gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] border border-destructive/20 bg-destructive/8 px-[var(--ow-space-3)] py-[var(--ow-space-2)] text-left text-destructive",
        className
      )}
      role="alert"
    >
      <AlertCircle className="mt-[var(--ow-leading-nudge)] size-[var(--ow-icon-sm)] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="[font-size:var(--ow-font-meta)] font-medium">{copy.chat.agentError}</div>
        <div className="mt-[var(--ow-space-0-5)] break-words [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
          {error}
        </div>
      </div>
      {onDismiss ? (
        <button
          aria-label={copy.chat.dismissError}
          className="-mr-[var(--ow-space-1)] -mt-[var(--ow-space-0-5)] flex size-[var(--ow-control-h-compact)] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={onDismiss}
          type="button"
        >
          <X className="size-[var(--ow-icon-sm)]" />
        </button>
      ) : null}
    </div>
  )
}
