import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { cn } from "@/lib/utils"
import {
  useFloatingSurfaceRef,
  withoutFloatingSurfaceForceMount,
  type FloatingSurfacePrimitiveProps
} from "./floating-surface"

const CheckboxItem = DropdownMenuPrimitive.CheckboxItem
const Group = DropdownMenuPrimitive.Group
const Item = DropdownMenuPrimitive.Item
const Label = DropdownMenuPrimitive.Label
const RadioGroup = DropdownMenuPrimitive.RadioGroup
const RadioItem = DropdownMenuPrimitive.RadioItem
const Root = DropdownMenuPrimitive.Root
const Separator = DropdownMenuPrimitive.Separator
const Sub = DropdownMenuPrimitive.Sub
const SubTrigger = DropdownMenuPrimitive.SubTrigger
const Trigger = DropdownMenuPrimitive.Trigger

function Portal(
  props: FloatingSurfacePrimitiveProps<React.ComponentProps<typeof DropdownMenuPrimitive.Portal>>
): React.JSX.Element {
  return <DropdownMenuPrimitive.Portal {...withoutFloatingSurfaceForceMount(props)} />
}

function preserveTriggerReopen(event: Event): void {
  const originalTarget = (
    event as CustomEvent<{
      originalEvent: PointerEvent
    }>
  ).detail.originalEvent.target

  if (!(originalTarget instanceof Element)) {
    return
  }

  const trigger = originalTarget.closest('[aria-haspopup="menu"]')
  if (!(trigger instanceof HTMLElement) || !trigger.id) {
    return
  }

  const isExitingTrigger = Array.from(
    trigger.ownerDocument.querySelectorAll(
      ".jingle-floating-surface[data-jingle-floating-exiting][aria-labelledby]"
    )
  ).some((content) => content.getAttribute("aria-labelledby")?.split(/\s+/).includes(trigger.id))

  if (isExitingTrigger) {
    event.preventDefault()
  }
}

function Content({
  className,
  onPointerDownOutside,
  ref,
  ...props
}: FloatingSurfacePrimitiveProps<
  React.ComponentProps<typeof DropdownMenuPrimitive.Content>
>): React.JSX.Element {
  const surfaceRef = useFloatingSurfaceRef(ref)
  const contentProps = withoutFloatingSurfaceForceMount(props)

  return (
    <DropdownMenuPrimitive.Content
      className={cn(
        "jingle-floating-surface origin-[var(--radix-dropdown-menu-content-transform-origin)]",
        className
      )}
      onPointerDownOutside={(event) => {
        onPointerDownOutside?.(event)
        if (!event.defaultPrevented) {
          preserveTriggerReopen(event)
        }
      }}
      ref={surfaceRef}
      {...contentProps}
    />
  )
}

function SubContent({
  className,
  onPointerDownOutside,
  ref,
  ...props
}: FloatingSurfacePrimitiveProps<
  React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>
>): React.JSX.Element {
  const surfaceRef = useFloatingSurfaceRef(ref)
  const contentProps = withoutFloatingSurfaceForceMount(props)

  return (
    <DropdownMenuPrimitive.SubContent
      className={cn(
        "jingle-floating-surface origin-[var(--radix-dropdown-menu-content-transform-origin)]",
        className
      )}
      onPointerDownOutside={(event) => {
        onPointerDownOutside?.(event)
        if (!event.defaultPrevented) {
          preserveTriggerReopen(event)
        }
      }}
      ref={surfaceRef}
      {...contentProps}
    />
  )
}

export {
  CheckboxItem,
  Content,
  Group,
  Item,
  Label,
  Portal,
  RadioGroup,
  RadioItem,
  Root,
  Separator,
  Sub,
  SubContent,
  SubTrigger,
  Trigger
}
