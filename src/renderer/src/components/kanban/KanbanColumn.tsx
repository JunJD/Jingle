import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type ColumnStatus = "pending" | "in_progress" | "interrupted" | "done"

interface KanbanColumnProps {
  title: string
  status: ColumnStatus
  children: React.ReactNode
}

const columnConfig: Record<ColumnStatus, { borderColor: string }> = {
  pending: { borderColor: "border-t-border" },
  in_progress: { borderColor: "border-t-status-info" },
  interrupted: { borderColor: "border-t-status-warning" },
  done: { borderColor: "border-t-status-nominal" }
}

export function KanbanColumn({ title, status, children }: KanbanColumnProps): React.JSX.Element {
  const config = columnConfig[status]

  return (
    <div
      className={cn(
        "flex flex-col min-w-[200px] w-[200px] flex-1 bg-muted/30 rounded-sm border border-border border-t-2",
        config.borderColor
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-section-header">{title}</span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-2">{children}</div>
      </ScrollArea>
    </div>
  )
}
