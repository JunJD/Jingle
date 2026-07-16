import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Check, ChevronRight, Circle } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  useFloatingSurfaceRef,
  withoutFloatingSurfaceForceMount,
  type FloatingSurfacePrimitiveProps
} from "./floating-surface"

const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
const DropdownMenuGroup = DropdownMenuPrimitive.Group
const DropdownMenuSub = DropdownMenuPrimitive.Sub
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

function DropdownMenuPortal(
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

function DropdownMenuContent(
  allProps: FloatingSurfacePrimitiveProps<
    React.ComponentProps<typeof DropdownMenuPrimitive.Content>
  >
): React.JSX.Element {
  const {
    align = "start",
    className,
    onPointerDownOutside,
    ref,
    sideOffset = 6,
    ...props
  } = withoutFloatingSurfaceForceMount(allProps)
  const surfaceRef = useFloatingSurfaceRef(ref)

  return (
    <DropdownMenuPortal>
      <DropdownMenuPrimitive.Content
        align={align}
        className={cn(
          "jingle-floating-surface z-70 min-w-[10rem] origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-hidden rounded-[var(--jingle-radius-md)] border border-border bg-popover p-[var(--jingle-space-1)] text-popover-foreground shadow-[0_14px_40px_rgba(0,0,0,0.18)] outline-none",
          className
        )}
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event)
          if (!event.defaultPrevented) {
            preserveTriggerReopen(event)
          }
        }}
        ref={surfaceRef}
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenuPortal>
  )
}

function DropdownMenuSubContent(
  allProps: FloatingSurfacePrimitiveProps<
    React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>
  >
): React.JSX.Element {
  const {
    className,
    onPointerDownOutside,
    ref,
    sideOffset = 4,
    ...props
  } = withoutFloatingSurfaceForceMount(allProps)
  const surfaceRef = useFloatingSurfaceRef(ref)

  return (
    <DropdownMenuPortal>
      <DropdownMenuPrimitive.SubContent
        className={cn(
          "jingle-floating-surface z-70 min-w-[10rem] origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-hidden rounded-[var(--jingle-radius-md)] border border-border bg-popover p-[var(--jingle-space-1)] text-popover-foreground shadow-[0_14px_40px_rgba(0,0,0,0.18)] outline-none",
          className
        )}
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event)
          if (!event.defaultPrevented) {
            preserveTriggerReopen(event)
          }
        }}
        ref={surfaceRef}
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenuPortal>
  )
}

function DropdownMenuItem({
  className,
  destructive = false,
  inset = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  destructive?: boolean
  inset?: boolean
}): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex min-h-[var(--jingle-control-h-compact)] cursor-default select-none items-center gap-[var(--jingle-space-2)] rounded-[var(--jingle-radius-sm)] px-[var(--jingle-space-2)] py-[var(--jingle-space-1)] [font-size:var(--jingle-font-control)] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-background-interactive data-[highlighted]:text-foreground [&_svg]:pointer-events-none [&_svg]:size-[var(--jingle-icon-sm)] [&_svg]:shrink-0",
        destructive &&
          "text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive",
        inset && "pl-[var(--jingle-space-7)]",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSubTrigger({
  children,
  className,
  inset = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        "flex min-h-[var(--jingle-control-h-compact)] cursor-default select-none items-center gap-[var(--jingle-space-2)] rounded-[var(--jingle-radius-sm)] px-[var(--jingle-space-2)] py-[var(--jingle-space-1)] [font-size:var(--jingle-font-control)] outline-none data-[state=open]:bg-background-interactive data-[highlighted]:bg-background-interactive",
        inset && "pl-[var(--jingle-space-7)]",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-[var(--jingle-icon-sm)]" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuCheckboxItem({
  checked,
  children,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        "relative flex min-h-[var(--jingle-control-h-compact)] cursor-default select-none items-center rounded-[var(--jingle-radius-sm)] py-[var(--jingle-space-1)] pl-[var(--jingle-space-7)] pr-[var(--jingle-space-2)] [font-size:var(--jingle-font-control)] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-background-interactive",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-[var(--jingle-space-2)] flex size-[var(--jingle-icon-action)] items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-[var(--jingle-icon-sm)]" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioItem({
  children,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        "relative flex min-h-[var(--jingle-control-h-compact)] cursor-default select-none items-center rounded-[var(--jingle-radius-sm)] py-[var(--jingle-space-1)] pl-[var(--jingle-space-7)] pr-[var(--jingle-space-2)] [font-size:var(--jingle-font-control)] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-background-interactive",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-[var(--jingle-space-2)] flex size-[var(--jingle-icon-action)] items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="size-[6px] fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        "px-[var(--jingle-space-2)] py-[var(--jingle-space-1)] [font-size:var(--jingle-font-meta)] font-semibold text-muted-foreground",
        inset && "pl-[var(--jingle-space-7)]",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn(
        "mx-[var(--jingle-space-1)] my-[var(--jingle-space-1)] h-px bg-border",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span
      className={cn("ml-auto [font-size:var(--jingle-font-meta)] text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
}
