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
        "flex h-[var(--jingle-control-h-md)] w-full rounded-[var(--jingle-radius-md)] border border-input bg-background-elevated px-[var(--jingle-space-3)] py-[var(--jingle-space-1)] [font-size:var(--jingle-font-control)] shadow-none transition-[border-color,box-shadow,background-color] duration-[var(--jingle-motion-duration-fast)] ease-[var(--jingle-motion-ease-out)] file:border-0 file:bg-transparent file:[font-size:var(--jingle-font-control)] file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/25 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        className
      )}
      ref={ref}
      {...props}
    />
  )
}

export { Input }
