"use client"

import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { TextShimmer } from "./TextShimmer"

export type ThinkingBarProps = {
  className?: string
  onClick?: () => void
  text?: string
}

const thinkingShimmerStyle = {
  "--ow-text-shimmer-base": "var(--ow-agent-timeline-muted)",
  "--ow-text-shimmer-highlight":
    "color-mix(in srgb, var(--ow-agent-timeline-muted) 58%, var(--foreground) 42%)"
} as React.CSSProperties

export function ThinkingBar(props: ThinkingBarProps): React.JSX.Element {
  const { className, onClick, text = "Thinking" } = props

  if (onClick) {
    return (
      <button
        className={cn(
          "ow-thinking-bar inline-flex min-w-0 items-center gap-[var(--ow-gap-sm)] text-[var(--ow-agent-timeline-muted)] transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
        onClick={onClick}
        type="button"
      >
        <TextShimmer
          className="min-w-0 truncate [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
          style={thinkingShimmerStyle}
        >
          {text}
        </TextShimmer>
        <ChevronRight className="size-[var(--ow-icon-xs)] shrink-0 text-[var(--ow-agent-timeline-muted)]" />
      </button>
    )
  }

  return (
    <div
      className={cn(
        "ow-thinking-bar inline-flex min-w-0 items-center text-[var(--ow-agent-timeline-muted)]",
        className
      )}
    >
      <TextShimmer
        className="min-w-0 truncate [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
        style={thinkingShimmerStyle}
      >
        {text}
      </TextShimmer>
    </div>
  )
}
