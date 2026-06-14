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

export interface AgentActivityRowProps extends Omit<
  React.ComponentProps<"span">,
  "children" | "title"
> {
  active?: boolean
  detail?: React.ReactNode
  detailClassName?: string
  icon?: React.ReactNode | null
  label: React.ReactNode
  labelClassName?: string
  meta?: React.ReactNode
  trailing?: React.ReactNode
}

export function AgentActivityRow(props: AgentActivityRowProps): React.JSX.Element {
  const {
    active = false,
    className,
    detail,
    detailClassName,
    icon,
    label,
    labelClassName,
    meta,
    trailing,
    ...rest
  } = props
  const hasTrailing = Boolean(meta || trailing)
  const gridClassName =
    hasTrailing
      ? "grid-cols-[var(--ow-icon-action)_minmax(0,1fr)_minmax(var(--ow-agent-activity-trailing-min-width),auto)]"
      : "grid-cols-[var(--ow-icon-action)_minmax(0,1fr)]"

  return (
    <span
      className={cn(
        "ow-agent-activity-row relative isolate grid min-h-[var(--ow-agent-activity-row-height)] max-w-full min-w-0 items-center gap-x-[var(--ow-gap-sm)] overflow-hidden rounded-[var(--ow-radius-sm)] px-0 py-[var(--ow-space-0-5)]",
        gridClassName,
        active && "text-[var(--ow-agent-timeline-active)]",
        className
      )}
      data-active={active ? "true" : undefined}
      {...rest}
    >
      <span
        className="inline-flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center"
        data-slot="ow-agent-activity-icon"
      >
        {icon}
      </span>
      <span
        className="inline-flex min-w-0 max-w-full items-baseline gap-x-[var(--ow-gap-sm)] overflow-hidden whitespace-nowrap"
        data-slot="ow-agent-activity-body"
      >
        <span
          className={cn(
            "block min-w-0 max-w-full truncate [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]",
            labelClassName
          )}
        >
          {label}
        </span>
        {detail ? (
          <span
            className={cn(
              "block min-w-0 max-w-[min(32rem,60vw)] shrink truncate [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-[var(--ow-agent-timeline-muted)]",
              detailClassName
            )}
          >
            {detail}
          </span>
        ) : null}
      </span>
      {hasTrailing ? (
        <span
          className="flex min-w-[var(--ow-agent-activity-trailing-min-width)] shrink-0 items-center justify-end gap-[var(--ow-gap-xs)]"
          data-slot="ow-agent-activity-trailing"
        >
          {meta}
          {trailing}
        </span>
      ) : null}
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
  subtitle?: React.ReactNode
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
    subtitle,
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
          state === "running" && "rounded-[var(--ow-radius-sm)] bg-transparent",
          state !== "complete" &&
            state !== "running" &&
            "rounded-[var(--ow-radius-lg)] border border-border/64 bg-background-elevated/38",
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
              "h-auto w-full justify-between rounded-none bg-transparent px-[var(--ow-space-3)] py-[var(--ow-space-2)] text-left font-normal text-[var(--ow-agent-timeline-muted)] hover:bg-background-secondary/46 hover:text-foreground",
              (state === "complete" || state === "running") &&
                "justify-start gap-[var(--ow-gap-xs)] px-0 py-[var(--ow-space-0-5)] hover:bg-transparent",
              !hasDetail && "cursor-default opacity-100 hover:bg-transparent disabled:opacity-100"
            )}
            data-tool-trigger
            type="button"
            variant="ghost"
          >
            <AgentActivityRow
              active={state === "running"}
              className="w-full"
              detail={subtitle}
              detailClassName="ow-agent-tool-detail flex-1"
              icon={
                icon ?? <AgentToolStatusIcon className="size-[var(--ow-icon-sm)]" state={state} />
              }
              label={title}
              labelClassName="ow-agent-tool-title"
              meta={meta}
              trailing={
                hasDetail ? (
                  <ChevronRight
                    className="ow-agent-tool-chevron size-[var(--ow-icon-sm)] text-[var(--ow-agent-timeline-muted)]"
                    data-open={isOpen ? "true" : "false"}
                  />
                ) : null
              }
            />
          </Button>
        </CollapsibleTrigger>
        {hasDetail ? (
          <CollapsibleContent
            className={cn(
              "ow-agent-tool-content overflow-hidden",
              state !== "complete" && state !== "running" && "border-t border-border/48"
            )}
          >
            <div
              className={cn(
                "min-w-0 max-w-full px-[var(--ow-space-3)] py-[var(--ow-space-3)]",
                (state === "complete" || state === "running") &&
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
  active?: boolean
  detail?: React.ReactNode
  icon?: React.ReactNode
  meta?: React.ReactNode
  showTrailingToggle?: boolean
}

export function AgentToolGroupTrigger(props: AgentToolGroupTriggerProps): React.JSX.Element {
  const {
    active,
    children,
    className,
    detail,
    icon = <ListTodo className="size-[var(--ow-icon-action)]" />,
    meta,
    showTrailingToggle,
    ...rest
  } = props
  const hasLeadingIcon = icon !== null
  const shouldShowTrailingToggle = showTrailingToggle ?? !hasLeadingIcon
  const leadingIcon = hasLeadingIcon ? (
    <span className="relative inline-flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center">
      <span className="transition-opacity group-hover:opacity-0 group-data-[state=open]:opacity-0">
        {icon}
      </span>
      <ChevronRight className="ow-agent-tool-chevron absolute size-[var(--ow-icon-action)] opacity-0 group-hover:opacity-100 group-data-[state=open]:rotate-90 group-data-[state=open]:opacity-100" />
    </span>
  ) : null

  return (
    <CollapsibleTrigger
      className={cn(
        "ow-agent-tool-group-trigger group w-full cursor-pointer items-center text-left text-[var(--ow-agent-timeline-muted)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      aria-live={active ? "polite" : undefined}
      data-active={active ? "true" : undefined}
      {...rest}
    >
      <AgentActivityRow
        active={active}
        className="w-full"
        detail={detail}
        detailClassName="ow-agent-tool-group-detail flex-1"
        icon={leadingIcon}
        label={children}
        labelClassName="ow-agent-tool-group-title block"
        meta={meta}
        trailing={
          shouldShowTrailingToggle ? (
            <ChevronRight className="ow-agent-tool-chevron size-[var(--ow-icon-sm)] shrink-0 opacity-0 group-hover:opacity-100 group-data-[state=open]:rotate-90 group-data-[state=open]:opacity-100" />
          ) : null
        }
      />
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
