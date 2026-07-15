import * as React from "react"
import * as HoverCardPrimitive from "@radix-ui/react-hover-card"
import { cn } from "@/lib/utils"
import {
  useFloatingSurfaceRef,
  withoutFloatingSurfaceForceMount,
  type FloatingSurfacePrimitiveProps
} from "./floating-surface"

const HoverCard = HoverCardPrimitive.Root
const HoverCardTrigger = HoverCardPrimitive.Trigger

function HoverCardPortal(
  props: FloatingSurfacePrimitiveProps<React.ComponentProps<typeof HoverCardPrimitive.Portal>>
): React.JSX.Element {
  return <HoverCardPrimitive.Portal {...withoutFloatingSurfaceForceMount(props)} />
}

function HoverCardContent(
  allProps: FloatingSurfacePrimitiveProps<React.ComponentProps<typeof HoverCardPrimitive.Content>>
): React.JSX.Element {
  const { className, ref, ...props } = withoutFloatingSurfaceForceMount(allProps)
  const surfaceRef = useFloatingSurfaceRef(ref)

  return (
    <HoverCardPrimitive.Content
      className={cn(
        "jingle-floating-surface origin-[var(--radix-hover-card-content-transform-origin)]",
        className
      )}
      ref={surfaceRef}
      {...props}
    />
  )
}

export { HoverCard, HoverCardContent, HoverCardPortal, HoverCardTrigger }
