"use client"

import { useControllableState } from "@radix-ui/react-use-controllable-state"
import { Badge } from "../ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"
import { BrainIcon, ChevronDownIcon, DotIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { createContext, memo, useContext, useEffect, useMemo, useRef } from "react"

interface ChainOfThoughtContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(null)

const useChainOfThought = () => {
  const context = useContext(ChainOfThoughtContext)
  if (!context) {
    throw new Error("ChainOfThought components must be used within ChainOfThought")
  }
  return context
}

export type ChainOfThoughtProps = ComponentProps<"div"> & {
  active?: boolean
  collapseWhenInactive?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export const ChainOfThought = memo(
  ({
    className,
    active = false,
    collapseWhenInactive = false,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ChainOfThoughtProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      defaultProp: defaultOpen,
      onChange: onOpenChange,
      prop: open
    })
    const wasActiveRef = useRef(active)

    useEffect(() => {
      if (collapseWhenInactive && wasActiveRef.current && !active) {
        setIsOpen(false)
      }

      wasActiveRef.current = active
    }, [active, collapseWhenInactive, setIsOpen])

    const chainOfThoughtContext = useMemo(() => ({ isOpen, setIsOpen }), [isOpen, setIsOpen])

    return (
      <Collapsible onOpenChange={setIsOpen} open={isOpen}>
        <ChainOfThoughtContext.Provider value={chainOfThoughtContext}>
          <div className={cn("not-prose w-full", className)} {...props}>
            {children}
          </div>
        </ChainOfThoughtContext.Provider>
      </Collapsible>
    )
  }
)

export type ChainOfThoughtHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  icon?: LucideIcon
  meta?: ReactNode
}

export const ChainOfThoughtHeader = memo(
  ({ className, children, icon: Icon = BrainIcon, meta, ...props }: ChainOfThoughtHeaderProps) => {
    const { isOpen } = useChainOfThought()

    return (
      <CollapsibleTrigger
        className={cn(
          "inline-flex max-w-full min-w-0 items-center gap-[var(--ow-gap-sm)] py-[var(--ow-space-1)] [font-size:var(--ow-font-body)] text-muted-foreground transition-colors hover:text-foreground",
          className
        )}
        {...props}
      >
        <span className="flex h-[var(--ow-hit-target-xs)] shrink-0 items-center">
          <Icon className="size-[var(--ow-icon-action)] shrink-0" />
        </span>
        <span className="min-w-0 text-left [overflow-wrap:anywhere]">
          {children ?? "Chain of Thought"}
        </span>
        {meta ? (
          <span className="flex h-[var(--ow-icon-md)] shrink-0 items-center [font-size:var(--ow-font-meta)] text-muted-foreground">
            {meta}
          </span>
        ) : null}
        <span className="flex h-[var(--ow-hit-target-xs)] shrink-0 items-center">
          <ChevronDownIcon
            className={cn(
              "size-[var(--ow-icon-action)] shrink-0 transition-transform",
              isOpen ? "rotate-180" : "rotate-0"
            )}
          />
        </span>
      </CollapsibleTrigger>
    )
  }
)

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: LucideIcon
  isLast?: boolean
  label: ReactNode
  description?: ReactNode
  status?: "complete" | "active" | "pending"
}

export type ChainOfThoughtItemProps = ComponentProps<"div"> & {
  icon?: LucideIcon
  isLast?: boolean
}

const stepStatusStyles = {
  active: "text-foreground",
  complete: "text-muted-foreground",
  pending: "text-muted-foreground/50"
}

export const ChainOfThoughtStep = memo(
  ({
    className,
    icon: Icon = DotIcon,
    isLast = false,
    label,
    description,
    status = "complete",
    children,
    ...props
  }: ChainOfThoughtStepProps) => (
    <div
      className={cn(
        "flex gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)]",
        stepStatusStyles[status],
        "fade-in-0 slide-in-from-top-2 animate-in",
        className
      )}
      {...props}
    >
      <div className="flex w-[var(--ow-icon-md)] shrink-0 translate-y-[var(--ow-space-1)] flex-col items-center self-stretch pt-0">
        <Icon className="size-[var(--ow-icon-action)]" />
        {!isLast ? (
          <div className="mt-[var(--ow-space-1)] min-h-[var(--ow-space-3)] w-px flex-1 self-center bg-foreground/15" />
        ) : null}
      </div>
      <div className="flex-1 space-y-[var(--ow-space-2)] overflow-hidden">
        <div>{label}</div>
        {description && (
          <div className="[font-size:var(--ow-font-meta)] text-muted-foreground">{description}</div>
        )}
        {children}
      </div>
    </div>
  )
)

export const ChainOfThoughtItem = memo(
  ({
    className,
    icon: Icon = DotIcon,
    isLast = false,
    children,
    ...props
  }: ChainOfThoughtItemProps) => (
    <div
      className={cn("flex gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)]", className)}
      {...props}
    >
      <div className="flex w-[var(--ow-icon-md)] shrink-0 translate-y-[var(--ow-space-1)] flex-col items-center self-stretch pt-0">
        <Icon className="size-[var(--ow-icon-action)] text-muted-foreground" />
        {!isLast ? (
          <div className="mt-[var(--ow-space-1)] min-h-[var(--ow-space-3)] w-px flex-1 self-center bg-foreground/15" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
)

export type ChainOfThoughtSearchResultsProps = ComponentProps<"div">

export const ChainOfThoughtSearchResults = memo(
  ({ className, ...props }: ChainOfThoughtSearchResultsProps) => (
    <div
      className={cn("flex flex-wrap items-center gap-[var(--ow-gap-sm)]", className)}
      {...props}
    />
  )
)

export type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>

export const ChainOfThoughtSearchResult = memo(
  ({ className, children, ...props }: ChainOfThoughtSearchResultProps) => (
    <Badge
      className={cn(
        "gap-[var(--ow-gap-xs)] px-[var(--ow-space-2)] py-[var(--ow-space-0-5)] [font-size:var(--ow-font-meta)] font-normal",
        className
      )}
      variant="secondary"
      {...props}
    >
      {children}
    </Badge>
  )
)

export type ChainOfThoughtContentProps = ComponentProps<typeof CollapsibleContent> & {
  withRail?: boolean
}

export const ChainOfThoughtContent = memo(
  ({ className, children, withRail = false, ...props }: ChainOfThoughtContentProps) => {
    return (
      <CollapsibleContent
        className={cn(
          "space-y-[var(--ow-space-3)] data-[state=open]:mt-[var(--ow-space-2)]",
          withRail &&
            "relative pl-[var(--ow-space-6)] before:absolute before:bottom-0 before:left-[7px] before:top-0 before:w-px before:bg-foreground/15",
          "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
          className
        )}
        {...props}
      >
        {children}
      </CollapsibleContent>
    )
  }
)

export type ChainOfThoughtImageProps = ComponentProps<"div"> & {
  caption?: string
}

export const ChainOfThoughtImage = memo(
  ({ className, children, caption, ...props }: ChainOfThoughtImageProps) => (
    <div className={cn("mt-[var(--ow-space-2)] space-y-[var(--ow-space-2)]", className)} {...props}>
      <div className="relative flex max-h-[var(--ow-code-preview-max-h)] items-center justify-center overflow-hidden rounded-[var(--ow-radius-lg)] bg-muted p-[var(--ow-space-3)]">
        {children}
      </div>
      {caption && (
        <p className="[font-size:var(--ow-font-meta)] text-muted-foreground">{caption}</p>
      )}
    </div>
  )
)

ChainOfThought.displayName = "ChainOfThought"
ChainOfThoughtHeader.displayName = "ChainOfThoughtHeader"
ChainOfThoughtItem.displayName = "ChainOfThoughtItem"
ChainOfThoughtStep.displayName = "ChainOfThoughtStep"
ChainOfThoughtSearchResults.displayName = "ChainOfThoughtSearchResults"
ChainOfThoughtSearchResult.displayName = "ChainOfThoughtSearchResult"
ChainOfThoughtContent.displayName = "ChainOfThoughtContent"
ChainOfThoughtImage.displayName = "ChainOfThoughtImage"
