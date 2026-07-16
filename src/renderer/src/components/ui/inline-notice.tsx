import * as React from "react"
import { cn } from "@/lib/utils"

const noticeToneClassName = {
  critical: "border-destructive/25 bg-destructive/8 text-destructive",
  info: "border-status-info/25 bg-status-info/8 text-foreground",
  neutral: "border-border bg-background-secondary/60 text-foreground",
  nominal: "border-status-nominal/25 bg-status-nominal/8 text-foreground",
  warning: "border-status-warning/25 bg-status-warning/8 text-foreground"
} as const

export interface InlineNoticeProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: keyof typeof noticeToneClassName
}

export function InlineNotice({
  className,
  tone = "neutral",
  ...props
}: InlineNoticeProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "rounded-[var(--jingle-radius-md)] border px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)]",
        noticeToneClassName[tone],
        className
      )}
      {...props}
    />
  )
}
