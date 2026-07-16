import type { ComponentProps } from "react"
import { LoaderCircle } from "lucide-react"
import { cn } from "@/lib/utils"

const spinnerSizeClassName = {
  sm: "size-[var(--jingle-icon-sm)]",
  md: "size-[var(--jingle-icon-action)]",
  lg: "size-[var(--jingle-icon-md)]"
} as const

export interface SpinnerProps extends Omit<ComponentProps<typeof LoaderCircle>, "aria-label"> {
  label?: string
  size?: keyof typeof spinnerSizeClassName
}

export function Spinner({
  className,
  label,
  size = "md",
  ...props
}: SpinnerProps): React.JSX.Element {
  return (
    <LoaderCircle
      {...props}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn("jingle-spinner shrink-0", spinnerSizeClassName[size], className)}
      role={label ? "status" : undefined}
    />
  )
}
