"use client"

import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { TextShimmer } from "./TextShimmer"

export type ThinkingBarProps = {
  className?: string
  onClick?: () => void
  text?: string
}

export function ThinkingBar(props: ThinkingBarProps): React.JSX.Element {
  const { className, onClick, text = "Thinking" } = props

  if (onClick) {
    return (
      <button
        className={cn(
          "ow-thinking-bar inline-flex min-w-0 items-center gap-[var(--ow-gap-sm)] text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
        onClick={onClick}
        type="button"
      >
        <TextShimmer className="min-w-0 truncate [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]">
          {text}
        </TextShimmer>
        <ChevronRight className="size-[var(--ow-icon-xs)] shrink-0 text-muted-foreground/72" />
      </button>
    )
  }

  return (
    <div
      className={cn(
        "ow-thinking-bar inline-flex min-w-0 items-center text-muted-foreground",
        className
      )}
    >
      <TextShimmer className="min-w-0 truncate [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]">
        {text}
      </TextShimmer>
    </div>
  )
}
