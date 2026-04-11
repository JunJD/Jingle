import { Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { cn } from "@/lib/utils"

export function KanbanHeader({ className }: { className?: string }): React.JSX.Element {
  const { showSubagentsInKanban, setShowSubagentsInKanban, threads } = useHistoryShellStore()

  const activeCount = threads.filter(
    (t) => t.status === "busy" || t.status === "interrupted"
  ).length

  return (
    <div
      className={cn(
        "flex items-center justify-between px-3 app-no-drag relative overflow-hidden",
        className
      )}
    >
      {/* Scan line effect */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, currentColor 2px, currentColor 3px)",
            backgroundSize: "100% 3px"
          }}
        />
      </div>

      {/* Left side - Status indicator */}
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <div
          className={cn(
            "size-1.5 rounded-full",
            activeCount > 0 ? "bg-status-nominal animate-tactical-pulse" : "bg-muted-foreground"
          )}
        />
        <span className="tabular-nums">{activeCount > 0 ? `${activeCount} ACTIVE` : "IDLE"}</span>
      </div>

      {/* Right side - Controls */}
      <Button
        variant={showSubagentsInKanban ? "secondary" : "ghost"}
        size="sm"
        onClick={() => setShowSubagentsInKanban(!showSubagentsInKanban)}
        className="gap-2 h-7 relative"
      >
        <Bot className="size-3.5" />
        {showSubagentsInKanban ? "Hide" : "Show"} Subagents
      </Button>
    </div>
  )
}
