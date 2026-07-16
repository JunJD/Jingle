import * as React from "react"
import { cn } from "@/lib/utils"

export interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "role"
> {
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
  ref?: React.Ref<HTMLButtonElement>
}

export function Switch({
  checked,
  className,
  disabled,
  label,
  onCheckedChange,
  onClick,
  ref,
  ...props
}: SwitchProps): React.JSX.Element {
  return (
    <button
      {...props}
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "jingle-pressable jingle-switch inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border p-[2px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50",
        checked ? "border-primary bg-primary" : "border-border bg-background-elevated",
        className
      )}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          onCheckedChange(!checked)
        }
      }}
      ref={ref}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          "jingle-switch__thumb block size-[12px] rounded-full bg-background shadow-sm",
          checked ? "translate-x-[14px]" : "translate-x-0"
        )}
      />
    </button>
  )
}
