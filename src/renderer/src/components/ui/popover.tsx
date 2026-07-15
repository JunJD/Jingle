import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"
import {
  useFloatingSurfaceRef,
  withoutFloatingSurfaceForceMount,
  type FloatingSurfacePrimitiveProps
} from "./floating-surface"

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent(
  allProps: FloatingSurfacePrimitiveProps<React.ComponentProps<typeof PopoverPrimitive.Content>>
) {
  const {
    className,
    align = "center",
    ref,
    sideOffset = 4,
    ...props
  } = withoutFloatingSurfaceForceMount(allProps)
  const surfaceRef = useFloatingSurfaceRef(ref)

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "jingle-floating-surface z-50 origin-[var(--radix-popover-content-transform-origin)] rounded-[var(--jingle-radius-dialog)] border border-border bg-popover p-3 text-popover-foreground shadow-[0_14px_40px_rgba(0,0,0,0.22)] outline-none",
          className
        )}
        ref={surfaceRef}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
