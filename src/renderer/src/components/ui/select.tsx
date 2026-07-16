import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  indicator?: boolean
  ref?: React.Ref<HTMLSelectElement>
  wrapperClassName?: string
}

export function Select({
  children,
  className,
  indicator = true,
  ref,
  wrapperClassName,
  ...props
}: SelectProps): React.JSX.Element {
  return (
    <span className={cn("relative block", wrapperClassName)}>
      <select
        className={cn(
          "h-[var(--jingle-control-h-md)] w-full appearance-none rounded-[var(--jingle-radius-md)] border border-input bg-background-elevated py-[var(--jingle-space-1)] pl-[var(--jingle-space-3)] pr-[var(--jingle-control-icon-inset)] [font-size:var(--jingle-font-control)] text-foreground shadow-none transition-[border-color,box-shadow,background-color] duration-[var(--jingle-motion-duration-fast)] ease-[var(--jingle-motion-ease-out)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/25 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
      {indicator ? (
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-[var(--jingle-space-3)] top-1/2 size-[var(--jingle-icon-sm)] -translate-y-1/2 text-muted-foreground"
        />
      ) : null}
    </span>
  )
}
