import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  ref?: React.Ref<HTMLInputElement>
}

function Input({ className, ref, type, ...props }: InputProps): React.JSX.Element {
  return (
    <input
      type={type}
      className={cn(
        "flex h-[var(--ow-control-h-md)] w-full rounded-[var(--ow-radius-md)] border border-input bg-background-elevated px-[var(--ow-space-3)] py-[var(--ow-space-1)] [font-size:var(--ow-font-control)] shadow-none transition-colors file:border-0 file:bg-transparent file:[font-size:var(--ow-font-control)] file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
}

export { Input }
