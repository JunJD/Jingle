import {
  Bot,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  Search,
  FileCheck
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useThreadSelector } from "@/lib/thread-context"
import type { Subagent } from "@/types"

// Icon component for subagent type (avoid creating components during render)
function SubagentTypeIcon({
  subagentType,
  className
}: {
  subagentType?: string
  className?: string
}): React.JSX.Element {
  switch (subagentType) {
    case "correctness-checker":
      return <FileCheck className={className} />
    case "final-reviewer":
      return <Search className={className} />
    case "research":
      return <Search className={className} />
    default:
      return <Sparkles className={className} />
  }
}

// Get badge variant for subagent type
function getSubagentTypeBadge(subagentType?: string): string {
  switch (subagentType) {
    case "correctness-checker":
      return "CHECKER"
    case "final-reviewer":
      return "REVIEWER"
    case "research":
      return "RESEARCH"
    case "general-purpose":
      return "GENERAL"
    default:
      return subagentType?.toUpperCase() || "TASK"
  }
}

const EMPTY_SUBAGENTS: readonly Subagent[] = []

export function SubagentPanel(): React.JSX.Element {
  const currentThreadId = useHistoryShellStore((state) => state.currentThreadId)
  const subagents = useThreadSelector(
    currentThreadId,
    (state) => state?.subagents ?? EMPTY_SUBAGENTS
  )

  // Count by status
  const runningCount = subagents.filter((s) => s.status === "running").length
  const completedCount = subagents.filter((s) => s.status === "completed").length

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-[var(--ow-space-4)]">
        <div className="flex items-center justify-between">
          <span className="text-section-header">SUBAGENTS</span>
          <div className="flex items-center gap-[var(--ow-gap-sm)]">
            {runningCount > 0 && (
              <Badge variant="info">
                <Loader2 className="mr-[var(--ow-space-1)] size-[var(--ow-icon-compact)] animate-spin" />
                {runningCount} ACTIVE
              </Badge>
            )}
            <Badge variant="outline">{subagents.length} TOTAL</Badge>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-[var(--ow-space-3)] p-[var(--ow-space-4)]">
          {subagents.length === 0 ? (
            <div className="py-[var(--ow-space-8)] text-center [font-size:var(--ow-font-body)] text-muted-foreground">
              <Bot className="mx-auto mb-[var(--ow-space-2)] size-[var(--ow-icon-xl)] opacity-50" />
              No subagent tasks
              <div className="mt-[var(--ow-space-1)] [font-size:var(--ow-font-meta)]">
                Subagents will appear here when spawned
              </div>
            </div>
          ) : (
            subagents.map((subagent) => <SubagentCard key={subagent.id} subagent={subagent} />)
          )}
        </div>
      </ScrollArea>

      {/* Summary footer when there are completed subagents */}
      {completedCount > 0 && (
        <div className="border-t border-border bg-muted/30 p-[var(--ow-space-3)]">
          <div className="flex items-center justify-between [font-size:var(--ow-font-meta)] text-muted-foreground">
            <span className="flex items-center gap-[var(--ow-gap-xs)]">
              <CheckCircle2 className="size-[var(--ow-icon-compact)] text-status-nominal" />
              {completedCount} completed
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function SubagentCard({ subagent }: { subagent: Subagent }): React.JSX.Element {
  const getStatusConfig = (): {
    icon: React.ElementType
    badge: "outline" | "info" | "nominal" | "critical"
    label: string
  } => {
    switch (subagent.status) {
      case "pending":
        return { icon: Clock, badge: "outline" as const, label: "PENDING" }
      case "running":
        return { icon: Loader2, badge: "info" as const, label: "RUNNING" }
      case "completed":
        return { icon: CheckCircle2, badge: "nominal" as const, label: "DONE" }
      case "failed":
        return { icon: XCircle, badge: "critical" as const, label: "FAILED" }
    }
  }

  const config = getStatusConfig()
  const StatusIcon = config.icon

  // Calculate duration only for completed subagents (to avoid impure Date.now() during render)
  const getDuration = (): string | null => {
    if (!subagent.startedAt || !subagent.completedAt) return null
    const start = new Date(subagent.startedAt).getTime()
    const end = new Date(subagent.completedAt).getTime()
    const durationMs = end - start
    if (durationMs < 1000) return `${durationMs}ms`
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`
    return `${(durationMs / 60000).toFixed(1)}m`
  }

  const duration = getDuration()

  return (
    <Card className={cn(subagent.status === "running" && "border-status-info/50")}>
      <CardHeader className="pb-[var(--ow-space-2)]">
        <div className="flex items-center justify-between gap-[var(--ow-gap-sm)]">
          <CardTitle className="flex items-center gap-[var(--ow-gap-sm)] truncate [font-size:var(--ow-font-body)] font-medium">
            <SubagentTypeIcon
              subagentType={subagent.subagentType}
              className={cn(
                "size-[var(--ow-icon-action)] shrink-0",
                subagent.status === "running" ? "text-status-info" : "text-muted-foreground"
              )}
            />
            <span className="truncate">{subagent.name}</span>
          </CardTitle>
          <Badge variant={config.badge} className="shrink-0">
            <StatusIcon
              className={cn(
                "mr-[var(--ow-space-1)] size-[var(--ow-icon-compact)]",
                subagent.status === "running" && "animate-spin"
              )}
            />
            {config.label}
          </Badge>
        </div>
        {subagent.subagentType && (
          <Badge
            variant="outline"
            className="mt-[var(--ow-space-1)] w-fit [font-size:var(--ow-font-caption)]"
          >
            {getSubagentTypeBadge(subagent.subagentType)}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <p className="line-clamp-2 [font-size:var(--ow-font-body)] text-muted-foreground">
          {subagent.description}
        </p>
        <div className="mt-[var(--ow-space-2)] flex items-center gap-[var(--ow-gap-md)] [font-size:var(--ow-font-meta)] text-muted-foreground">
          {subagent.startedAt && (
            <span className="flex items-center gap-[var(--ow-gap-xs)]">
              <Clock className="size-[var(--ow-icon-compact)]" />
              {new Date(subagent.startedAt).toLocaleTimeString()}
            </span>
          )}
          {duration && (
            <span className="flex items-center gap-[var(--ow-gap-xs)]">
              {subagent.status === "running" ? (
                <Loader2 className="size-[var(--ow-icon-compact)] animate-spin" />
              ) : (
                <CheckCircle2 className="size-[var(--ow-icon-compact)]" />
              )}
              {duration}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
