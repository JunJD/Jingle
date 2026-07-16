import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"
import {
  useFloatingSurfaceRef,
  withoutFloatingSurfaceForceMount,
  type FloatingSurfacePrimitiveProps
} from "./floating-surface"

function TooltipProvider({
  delayDuration = 420,
  skipDelayDuration = 80,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>): React.JSX.Element {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  )
}

const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

function TooltipContent(
  allProps: FloatingSurfacePrimitiveProps<React.ComponentProps<typeof TooltipPrimitive.Content>>
): React.JSX.Element {
  const { className, ref, sideOffset = 6, ...props } = withoutFloatingSurfaceForceMount(allProps)
  const surfaceRef = useFloatingSurfaceRef(ref)

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        className={cn(
          "jingle-floating-surface z-70 max-w-[18rem] origin-[var(--radix-tooltip-content-transform-origin)] rounded-[var(--jingle-radius-sm)] border border-border/80 bg-popover px-[var(--jingle-space-2)] py-[var(--jingle-space-1)] [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-popover-foreground shadow-[0_8px_24px_rgba(0,0,0,0.14)]",
          className
        )}
        ref={surfaceRef}
        sideOffset={sideOffset}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
