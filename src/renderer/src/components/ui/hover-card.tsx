import * as React from "react"
import * as HoverCardPrimitive from "@radix-ui/react-hover-card"
import { cn } from "@/lib/utils"
import {
  useFloatingSurfaceRef,
  withoutFloatingSurfaceForceMount,
  type FloatingSurfacePrimitiveProps
} from "./floating-surface"

function HoverCard(props: React.ComponentProps<typeof HoverCardPrimitive.Root>): React.JSX.Element {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger(
  props: React.ComponentProps<typeof HoverCardPrimitive.Trigger>
): React.JSX.Element {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
}

function HoverCardPortal(
  props: FloatingSurfacePrimitiveProps<React.ComponentProps<typeof HoverCardPrimitive.Portal>>
): React.JSX.Element {
  return <HoverCardPrimitive.Portal {...withoutFloatingSurfaceForceMount(props)} />
}

function HoverCardContent(
  allProps: FloatingSurfacePrimitiveProps<React.ComponentProps<typeof HoverCardPrimitive.Content>>
): React.JSX.Element {
  const {
    align = "center",
    className,
    ref,
    sideOffset = 6,
    ...props
  } = withoutFloatingSurfaceForceMount(allProps)
  const surfaceRef = useFloatingSurfaceRef(ref)

  return (
    <HoverCardPortal>
      <HoverCardPrimitive.Content
        align={align}
        className={cn(
          "jingle-floating-surface z-50 origin-[var(--radix-hover-card-content-transform-origin)] rounded-[var(--jingle-radius-dialog)] border border-border bg-popover text-popover-foreground shadow-[0_14px_40px_rgba(0,0,0,0.22)] outline-none",
          className
        )}
        data-slot="hover-card-content"
        ref={surfaceRef}
        sideOffset={sideOffset}
        {...props}
      />
    </HoverCardPortal>
  )
}

export { HoverCard, HoverCardContent, HoverCardTrigger }
