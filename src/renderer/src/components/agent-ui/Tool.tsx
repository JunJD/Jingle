"use client"

import { CheckCircle2, ChevronRight, ListTodo, Loader2, TriangleAlert, XCircle } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

export type AgentToolState = "running" | "approval" | "complete" | "error"

const stateClassNames: Record<AgentToolState, string> = {
  approval: "text-status-warning",
  complete: "text-status-nominal",
  error: "text-status-critical",
  running: "text-status-info"
}

export function AgentToolStatusIcon(props: {
  className?: string
  state: AgentToolState
}): React.JSX.Element {
  const { className, state } = props

  if (state === "running") {
    return <Loader2 className={cn("animate-spin", stateClassNames[state], className)} />
  }

  if (state === "approval") {
    return <TriangleAlert className={cn(stateClassNames[state], className)} />
  }

  if (state === "error") {
    return <XCircle className={cn(stateClassNames[state], className)} />
  }

  return <CheckCircle2 className={cn(stateClassNames[state], className)} />
}

export function AgentToolStatusBadge(props: {
  children?: React.ReactNode
  className?: string
  state: AgentToolState
}): React.JSX.Element | null {
  const { children, className, state } = props

  if (!children) {
    return null
  }

  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-full border px-[var(--ow-space-2)] [font-size:var(--ow-font-caption)] font-medium uppercase tracking-[0.08em]",
        state === "running" && "border-status-info/20 bg-status-info/8 text-status-info",
        state === "approval" && "border-status-warning/24 bg-status-warning/10 text-status-warning",
        state === "complete" && "border-status-nominal/20 bg-status-nominal/8 text-status-nominal",
        state === "error" && "border-status-critical/24 bg-status-critical/10 text-status-critical",
        className
      )}
    >
      {children}
    </span>
  )
}

export interface AgentToolProps extends Omit<React.ComponentProps<"div">, "title"> {
  defaultOpen?: boolean
  detail?: React.ReactNode
  icon?: React.ReactNode
  meta?: React.ReactNode
  onOpenChange?: (open: boolean) => void
  open?: boolean
  state: AgentToolState
  title: React.ReactNode
}

export function AgentTool(props: AgentToolProps): React.JSX.Element {
  const {
    className,
    defaultOpen = false,
    detail,
    icon,
    meta,
    onOpenChange,
    open,
    state,
    title,
    ...rest
  } = props
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isOpen = open ?? internalOpen
  const hasDetail = Boolean(detail)

  return (
    <Collapsible
      onOpenChange={(nextOpen) => {
        if (open === undefined) {
          setInternalOpen(nextOpen)
        }

        onOpenChange?.(nextOpen)
      }}
      open={isOpen}
    >
      <div
        className={cn(
          "ow-agent-tool overflow-hidden",
          state === "complete" && "rounded-[var(--ow-radius-sm)] bg-transparent",
          state !== "complete" &&
            "rounded-[var(--ow-radius-lg)] border border-border/64 bg-background-elevated/38",
          state === "running" && "border-status-info/18 bg-status-info/4",
          state === "approval" && "border-status-warning/28 bg-status-warning/6",
          state === "error" && "border-status-critical/24 bg-status-critical/6",
          className
        )}
        data-state={state}
        {...rest}
      >
        <CollapsibleTrigger asChild disabled={!hasDetail}>
          <Button
            className={cn(
              "h-auto w-full justify-between rounded-none bg-transparent px-[var(--ow-space-3)] py-[var(--ow-space-2)] text-left font-normal hover:bg-background-secondary/46",
              state === "complete" &&
                "justify-start gap-[var(--ow-gap-xs)] px-0 py-[var(--ow-space-0-5)] hover:bg-transparent",
              !hasDetail && "cursor-default hover:bg-transparent"
            )}
            data-tool-trigger
            type="button"
            variant="ghost"
          >
            <span className="flex min-w-0 items-center gap-[var(--ow-gap-sm)]">
              <span className="inline-flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center">
                {icon ?? <AgentToolStatusIcon className="size-[var(--ow-icon-sm)]" state={state} />}
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-[var(--ow-agent-timeline-muted)]">
                {title}
              </span>
            </span>
            <span
              className={cn(
                "ml-[var(--ow-space-2)] flex shrink-0 items-center gap-[var(--ow-gap-sm)]",
                state === "complete" && "ml-0 gap-[var(--ow-gap-xs)]"
              )}
            >
              {meta}
              {hasDetail ? (
                <ChevronRight
                  className="ow-agent-tool-chevron size-[var(--ow-icon-sm)] text-[var(--ow-agent-timeline-muted)]"
                  data-open={isOpen ? "true" : "false"}
                />
              ) : null}
            </span>
          </Button>
        </CollapsibleTrigger>
        {hasDetail ? (
          <CollapsibleContent
            className={cn(
              "ow-agent-tool-content overflow-hidden",
              state !== "complete" && "border-t border-border/48"
            )}
          >
            <div
              className={cn(
                "px-[var(--ow-space-3)] py-[var(--ow-space-3)]",
                state === "complete" &&
                  "px-0 pb-[var(--ow-space-2)] pt-[var(--ow-space-1)] pl-[calc(var(--ow-icon-action)+var(--ow-gap-sm))]"
              )}
            >
              {detail}
            </div>
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  )
}

export interface AgentToolInlineProps extends Omit<React.ComponentProps<"button">, "title"> {
  icon?: React.ReactNode
  meta?: React.ReactNode
  title: React.ReactNode
}

export function AgentToolInline(props: AgentToolInlineProps): React.JSX.Element {
  const { className, icon, meta, title, type = "button", ...rest } = props

  return (
    <button
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-sm)] px-0 py-[var(--ow-space-0-5)] text-left text-[var(--ow-agent-timeline-muted)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      type={type}
      {...rest}
    >
      {icon ? (
        <span className="inline-flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 [overflow-wrap:anywhere] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]">
        {title}
      </span>
      {meta ? (
        <span className="ml-[var(--ow-space-1)] flex shrink-0 items-center gap-[var(--ow-gap-xs)]">
          {meta}
        </span>
      ) : null}
    </button>
  )
}

const agentToolGroupGridClassName =
  "grid grid-cols-[var(--ow-icon-action)_minmax(0,1fr)] gap-x-[var(--ow-gap-sm)]"

export interface AgentToolGroupProps extends React.ComponentProps<typeof Collapsible> {
  active?: boolean
}

export function AgentToolGroup(props: AgentToolGroupProps): React.JSX.Element {
  const { active = false, className, defaultOpen = true, ...rest } = props

  return (
    <Collapsible
      className={cn("ow-agent-tool-group", className)}
      data-active={active ? "true" : "false"}
      defaultOpen={defaultOpen}
      {...rest}
    />
  )
}

export interface AgentToolGroupTriggerProps extends React.ComponentProps<
  typeof CollapsibleTrigger
> {
  icon?: React.ReactNode
  meta?: React.ReactNode
}

export function AgentToolGroupTrigger(props: AgentToolGroupTriggerProps): React.JSX.Element {
  const {
    children,
    className,
    icon = <ListTodo className="size-[var(--ow-icon-action)]" />,
    meta,
    ...rest
  } = props

  return (
    <CollapsibleTrigger
      className={cn(
        "group w-full cursor-pointer items-center text-left text-[var(--ow-agent-timeline-muted)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        agentToolGroupGridClassName,
        className
      )}
      {...rest}
    >
      <span className="relative inline-flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center">
        <span className="transition-opacity group-hover:opacity-0 group-data-[state=open]:opacity-0">
          {icon}
        </span>
        <ChevronRight className="ow-agent-tool-chevron absolute size-[var(--ow-icon-action)] opacity-0 group-hover:opacity-100 group-data-[state=open]:rotate-90 group-data-[state=open]:opacity-100" />
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

export type AgentToolGroupContentProps = React.ComponentProps<typeof CollapsibleContent>

export function AgentToolGroupContent(props: AgentToolGroupContentProps): React.JSX.Element {
  const { children, className, ...rest } = props

  return (
    <CollapsibleContent
      className={cn("ow-agent-tool-content overflow-hidden text-popover-foreground", className)}
      {...rest}
    >
      <div className="relative mt-[var(--ow-space-2)] min-w-0 max-w-full space-y-[var(--ow-space-2)] before:absolute before:bottom-[var(--ow-space-1)] before:left-[calc(var(--ow-icon-action)/2)] before:top-[var(--ow-space-1)] before:w-px before:-translate-x-1/2 before:bg-border/64">
        {children}
      </div>
    </CollapsibleContent>
  )
}

export interface AgentToolGroupItemProps extends React.ComponentProps<"div"> {
  icon: React.ReactNode
}

export function AgentToolGroupItem(props: AgentToolGroupItemProps): React.JSX.Element {
  const { children, className, icon, ...rest } = props

  return (
    <div
      className={cn(
        "relative min-w-0 text-[var(--ow-agent-timeline-muted)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]",
        agentToolGroupGridClassName,
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
