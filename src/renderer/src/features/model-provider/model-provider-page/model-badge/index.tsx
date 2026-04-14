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
        "inline-flex h-[18px] shrink-0 items-center justify-center whitespace-nowrap rounded-[5px] border border-border/80 bg-background-elevated/75 px-[5px] text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  )
}
