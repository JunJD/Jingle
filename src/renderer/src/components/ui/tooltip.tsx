import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"
import {
  useFloatingSurfaceRef,
  withoutFloatingSurfaceForceMount,
  type FloatingSurfacePrimitiveProps
} from "./floating-surface"

const Tooltip = TooltipPrimitive.Root
const TooltipProvider = TooltipPrimitive.Provider
const TooltipTrigger = TooltipPrimitive.Trigger

function TooltipContent(
  allProps: FloatingSurfacePrimitiveProps<React.ComponentProps<typeof TooltipPrimitive.Content>>
): React.JSX.Element {
  const { className, ref, ...props } = withoutFloatingSurfaceForceMount(allProps)
  const surfaceRef = useFloatingSurfaceRef(ref)

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        className={cn(
          "jingle-floating-surface origin-[var(--radix-tooltip-content-transform-origin)]",
          className
        )}
        ref={surfaceRef}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
