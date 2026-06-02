"use client"

import { ChevronDown, ListTodo } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

const agentStepGridClassName =
  "grid grid-cols-[var(--ow-icon-action)_minmax(0,1fr)] gap-x-[var(--ow-gap-sm)]"

export interface AgentStepsProps extends React.ComponentProps<typeof Collapsible> {
  active?: boolean
}

export function AgentSteps(props: AgentStepsProps): React.JSX.Element {
  const { active = false, className, defaultOpen = true, ...rest } = props

  return (
    <Collapsible
      className={cn("ow-agent-steps", className)}
      data-active={active ? "true" : "false"}
      defaultOpen={defaultOpen}
      {...rest}
    />
  )
}

export interface AgentStepsTriggerProps extends React.ComponentProps<typeof CollapsibleTrigger> {
  icon?: React.ReactNode
  meta?: React.ReactNode
}

export function AgentStepsTrigger(props: AgentStepsTriggerProps): React.JSX.Element {
  const {
    children,
    className,
    icon = (
      <ListTodo className="size-[var(--ow-icon-action)] transition-opacity group-hover:opacity-0" />
    ),
    meta,
    ...rest
  } = props

  return (
    <CollapsibleTrigger
      className={cn(
        "group w-full cursor-pointer items-center text-left text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        agentStepGridClassName,
        className
      )}
      {...rest}
    >
      <span className="relative inline-flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center">
        <span className="transition-opacity group-hover:opacity-0">{icon}</span>
        <ChevronDown className="absolute size-[var(--ow-icon-action)] opacity-0 transition group-hover:opacity-100 group-data-[state=open]:rotate-180" />
      </span>
      <span className="flex min-w-0 items-center gap-[var(--ow-gap-sm)]">
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]">
          {children}
        </span>
        {meta ? (
          <span className="flex shrink-0 items-center gap-[var(--ow-gap-sm)]">{meta}</span>
        ) : null}
      </span>
    </CollapsibleTrigger>
  )
}

export interface AgentStepsContentProps extends React.ComponentProps<typeof CollapsibleContent> {
  bar?: React.ReactNode | false
}

export function AgentStepsContent(props: AgentStepsContentProps): React.JSX.Element {
  const { bar, children, className, ...rest } = props
  const showCustomBar = Boolean(bar)
  const showDefaultRail = bar === undefined

  return (
    <CollapsibleContent
      className={cn(
        "overflow-hidden text-popover-foreground data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      {...rest}
    >
      <div
        className={cn(
          "relative mt-[var(--ow-space-2)] min-w-0 max-w-full",
          showCustomBar
            ? "grid grid-cols-[min-content_minmax(0,1fr)] items-start gap-x-[var(--ow-gap-md)]"
            : "space-y-[var(--ow-space-2)]",
          showDefaultRail &&
            "before:absolute before:bottom-[var(--ow-space-1)] before:left-[calc(var(--ow-icon-action)/2)] before:top-[var(--ow-space-1)] before:w-px before:-translate-x-1/2 before:bg-border/64"
        )}
      >
        {showCustomBar ? (
          <>
            {bar}
            <div className="min-w-0 space-y-[var(--ow-space-2)]">{children}</div>
          </>
        ) : (
          children
        )}
      </div>
    </CollapsibleContent>
  )
}

export type AgentStepsBarProps = React.HTMLAttributes<HTMLDivElement>

export function AgentStepsBar(props: AgentStepsBarProps): React.JSX.Element {
  const { className, ...rest } = props

  return <div aria-hidden="true" className={cn("h-full w-px bg-border", className)} {...rest} />
}

export interface AgentStepProps extends React.ComponentProps<"div"> {
  icon?: React.ReactNode
}

export function AgentStep(props: AgentStepProps): React.JSX.Element {
  const { children, className, icon, ...rest } = props

  return (
    <div
      className={cn(
        "min-w-0 text-muted-foreground [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]",
        "relative",
        agentStepGridClassName,
        className
      )}
      {...rest}
    >
      <span className="inline-flex size-[var(--ow-icon-action)] items-center justify-center">
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
