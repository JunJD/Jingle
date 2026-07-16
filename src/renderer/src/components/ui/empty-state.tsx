import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function EmptyState(props: {
  action?: ReactNode
  className?: string
  description?: ReactNode
  icon?: ReactNode
  title: ReactNode
}): React.JSX.Element {
  const { action, className, description, icon, title } = props

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col items-center justify-center gap-[var(--jingle-space-2)] px-[var(--jingle-space-4)] py-[var(--jingle-space-6)] text-center",
        className
      )}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="[font-size:var(--jingle-font-label)] font-semibold text-foreground">
        {title}
      </div>
      {description ? (
        <div className="max-w-[var(--jingle-empty-max-w)] [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] text-muted-foreground">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-[var(--jingle-space-1)]">{action}</div> : null}
    </div>
  )
}
