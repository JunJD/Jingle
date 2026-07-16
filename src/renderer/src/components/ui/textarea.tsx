import * as React from "react"
import { cn } from "@/lib/utils"

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: React.Ref<HTMLTextAreaElement>
}

export function Textarea({ className, ref, ...props }: TextareaProps): React.JSX.Element {
  return (
    <textarea
      className={cn(
        "flex min-h-[var(--jingle-textarea-min-h)] w-full resize-y rounded-[var(--jingle-radius-md)] border border-input bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-control)] leading-[var(--jingle-line-body)] shadow-none transition-[border-color,box-shadow,background-color] duration-[var(--jingle-motion-duration-fast)] ease-[var(--jingle-motion-ease-out)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/25 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        className
      )}
      ref={ref}
      {...props}
    />
  )
}
