import { MessageSquare, Loader2, Clock, Bot } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn, formatRelativeTime, truncate } from "@/lib/utils"
import { getSubagentStatusPresentation } from "@/lib/subagent-view"
import type { Thread, Subagent } from "@/types"

type KanbanStatus = "pending" | "in_progress" | "interrupted" | "done"

interface ThreadCardProps {
  isLoading: boolean
  thread: Thread
  status: KanbanStatus
  onClick: () => void
}

interface SubagentCardProps {
  subagent: Subagent
  parentThread: Thread
  onClick: () => void
}

function ThreadStatusIcon({ isLoading }: { isLoading: boolean }): React.JSX.Element {
  if (isLoading) {
    return (
      <Loader2 className="size-[var(--ow-icon-action)] shrink-0 text-status-info animate-spin" />
    )
  }
  return <MessageSquare className="size-[var(--ow-icon-action)] shrink-0 text-muted-foreground" />
}

export function ThreadKanbanCard({
  isLoading,
  thread,
  status,
  onClick
}: ThreadCardProps): React.JSX.Element {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:border-border-emphasis hover:bg-background-interactive",
        status === "in_progress" && "border-status-info/50",
        status === "interrupted" && "!border-amber-500/50 !bg-amber-500/5"
      )}
      onClick={onClick}
    >
      <CardContent className="p-[var(--ow-space-3)]">
        <div className="flex items-start gap-[var(--ow-gap-sm)]">
          {status === "interrupted" ? (
            <MessageSquare className="size-[var(--ow-icon-action)] shrink-0 text-amber-500" />
          ) : (
            <ThreadStatusIcon isLoading={isLoading} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-[var(--ow-gap-sm)]">
              <span className="truncate [font-size:var(--ow-font-body)] font-medium">
                {thread.title || truncate(thread.thread_id, 20)}
              </span>
              {status === "done" && (
                <Badge variant="nominal" className="shrink-0 [font-size:var(--ow-font-micro)]">
                  DONE
                </Badge>
              )}
            </div>
            <div className="mt-[var(--ow-space-1)] flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-caption)] text-muted-foreground">
              <Clock className="size-[var(--ow-icon-compact)]" />
              {formatRelativeTime(thread.updated_at)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function SubagentKanbanCard({
  subagent,
  parentThread,
  onClick
}: SubagentCardProps): React.JSX.Element {
  const isDone = subagent.status === "completed" || subagent.status === "failed"
  const statusPresentation = getSubagentStatusPresentation(subagent.status)

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:border-border-emphasis hover:bg-background-interactive border-dashed",
        subagent.status === "running" && "border-status-info/50"
      )}
      onClick={onClick}
    >
      <CardContent className="overflow-hidden p-[var(--ow-space-3)]">
        <div className="flex min-w-0 items-start gap-[var(--ow-gap-sm)]">
          <Bot
            className={cn(
              "size-[var(--ow-icon-action)] shrink-0",
              subagent.status === "running" ? "text-status-info" : "text-muted-foreground"
            )}
          />
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-[var(--ow-gap-sm)]">
              <span className="truncate [font-size:var(--ow-font-body)] font-medium">
                {subagent.name}
              </span>
              {isDone && (
                <Badge
                  variant={statusPresentation.badge}
                  className="shrink-0 [font-size:var(--ow-font-micro)]"
                >
                  {statusPresentation.label}
                </Badge>
              )}
            </div>
            <p className="mt-[var(--ow-space-0-5)] line-clamp-2 break-words [font-size:var(--ow-font-caption)] text-muted-foreground">
              {subagent.description}
            </p>
            <div className="mt-[var(--ow-space-1)] flex items-center gap-[var(--ow-gap-xs)] [font-size:var(--ow-font-caption)] text-muted-foreground">
              <span className="truncate">
                ↳ {parentThread.title || truncate(parentThread.thread_id, 15)}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
