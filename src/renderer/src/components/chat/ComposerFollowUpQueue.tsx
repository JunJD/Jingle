import { CornerDownRight, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import type {
  JingleAgentFollowUpQueueItem,
  JingleAgentFollowUpQueueSummary
} from "@jingle/agent-client"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface ComposerFollowUpQueueProps {
  className?: string
  onDeleteQueuedFollowUp: (item: JingleAgentFollowUpQueueItem) => Promise<void> | void
  onEditQueuedFollowUp: (item: JingleAgentFollowUpQueueItem) => Promise<void> | void
  onSteerQueuedFollowUp: (item: JingleAgentFollowUpQueueItem) => Promise<void> | void
  queue: JingleAgentFollowUpQueueSummary
}

export function ComposerFollowUpQueue({
  className,
  onDeleteQueuedFollowUp,
  onEditQueuedFollowUp,
  onSteerQueuedFollowUp,
  queue
}: ComposerFollowUpQueueProps): React.JSX.Element | null {
  const { copy } = useI18n()

  if (queue.count === 0 || queue.items.length === 0) {
    return null
  }

  const remainingCount = Math.max(0, queue.count - queue.items.length)

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-t-[var(--jingle-radius-lg)] border-x border-t border-border/70 bg-background-elevated/78 px-[var(--jingle-space-3)] py-[var(--jingle-space-1-5)] text-foreground/82 shadow-[0_-10px_28px_rgba(15,23,42,0.04)] backdrop-blur-sm",
        className
      )}
    >
      <div className="hide-scrollbar flex max-h-[30dvh] flex-col gap-px overflow-y-auto">
        {queue.items.map((item) => (
          <div
            className="group flex min-w-0 items-center justify-between gap-[var(--jingle-space-2)] py-[var(--jingle-space-0-5)] [font-size:var(--jingle-font-body)]"
            key={item.requestId}
          >
            <div className="flex min-w-0 flex-1 items-center gap-[var(--jingle-space-1-5)]">
              <CornerDownRight className="size-[var(--jingle-icon-sm)] shrink-0 text-muted-foreground/68" />
              <span className="line-clamp-2 min-w-0 leading-[var(--jingle-line-tight)] text-muted-foreground">
                {item.text || copy.chat.queuedFollowUpUntitled}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-[var(--jingle-space-1)]">
              <Button
                type="button"
                variant="ghost"
                className="inline-flex h-[var(--jingle-control-h-sm)] items-center gap-[var(--jingle-space-1)] rounded-full px-[var(--jingle-space-2)] [font-size:var(--jingle-font-meta)] font-medium text-muted-foreground transition-colors hover:bg-background-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  void onSteerQueuedFollowUp(item)
                }}
              >
                <CornerDownRight className="size-[var(--jingle-icon-xs)]" />
                <span>{copy.chat.queuedFollowUpSteer}</span>
              </Button>
              <IconButton
                type="button"
                label={copy.chat.queuedFollowUpDelete}
                className="inline-flex size-[var(--jingle-control-h-sm)] items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  void onDeleteQueuedFollowUp(item)
                }}
                size="icon-sm"
                variant="ghost"
              >
                <Trash2 className="size-[var(--jingle-icon-xs)]" />
              </IconButton>
              <IconButton
                type="button"
                label={copy.chat.queuedFollowUpEdit}
                className="inline-flex size-[var(--jingle-control-h-sm)] items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  void onEditQueuedFollowUp(item)
                }}
                size="icon-sm"
                variant="ghost"
              >
                <Pencil className="size-[var(--jingle-icon-xs)]" />
              </IconButton>
            </div>
          </div>
        ))}
        {remainingCount > 0 ? (
          <div className="px-[var(--jingle-space-6)] py-[var(--jingle-space-0-5)] [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-tight)] text-muted-foreground/72">
            {copy.chat.queuedFollowUpMore(remainingCount)}
          </div>
        ) : null}
      </div>
    </div>
  )
}
