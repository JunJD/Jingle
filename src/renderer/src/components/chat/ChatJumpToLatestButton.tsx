import { ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export function ChatJumpToLatestButton(props: {
  className?: string
  isLoading: boolean
  label: string
  onClick: () => void
}): React.JSX.Element {
  const { className, isLoading, label, onClick } = props

  return (
    <Button
      aria-busy={isLoading || undefined}
      type="button"
      variant="ghost"
      className={cn(
        "flex items-center gap-[var(--jingle-gap-sm)] rounded-full border border-border/70 bg-background/92 px-[var(--jingle-space-3)] py-[var(--jingle-space-1-5)] [font-size:var(--jingle-font-meta)] font-medium text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur-md transition hover:bg-background-elevated",
        className
      )}
      onClick={onClick}
    >
      {isLoading ? <Spinner size="sm" /> : <ArrowDown className="size-[var(--jingle-icon-sm)]" />}
      {label}
    </Button>
  )
}
