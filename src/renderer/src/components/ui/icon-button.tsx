import type { ReactNode } from "react"
import { Button, type ButtonProps } from "./button"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

export interface IconButtonProps extends Omit<ButtonProps, "aria-label" | "children" | "size"> {
  children: ReactNode
  label: string
  pressed?: boolean
  size?: "icon" | "icon-sm"
  tooltip?: boolean | ReactNode
  tooltipSide?: "bottom" | "left" | "right" | "top"
}

export function IconButton({
  children,
  label,
  pressed,
  size = "icon",
  tooltip = true,
  tooltipSide = "top",
  ...props
}: IconButtonProps): React.JSX.Element {
  const button = (
    <Button
      {...props}
      aria-label={label}
      aria-pressed={pressed}
      data-active={pressed ? "" : undefined}
      size={size}
    >
      {children}
    </Button>
  )

  if (tooltip === false || tooltip == null) {
    return button
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip === true ? label : tooltip}</TooltipContent>
    </Tooltip>
  )
}
