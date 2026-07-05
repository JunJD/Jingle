import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

type ModelBadgeProps = {
  children: ReactNode
  className?: string
}

export default function ModelBadge(props: ModelBadgeProps): React.JSX.Element {
  const { children, className } = props

  return (
    <div
      className={cn(
        "inline-flex h-[var(--ow-model-badge-h)] shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--ow-model-badge-radius)] border border-border/80 bg-background-elevated/75 px-[var(--ow-model-badge-x)] [font-size:var(--ow-font-caption)] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  )
}
