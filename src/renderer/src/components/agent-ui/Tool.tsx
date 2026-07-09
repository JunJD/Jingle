"use client"

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ListTodo,
  Loader2,
  TriangleAlert,
  XCircle
} from "lucide-react"
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
  trailingPlacement?: "edge" | "inline"
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
    trailingPlacement = "edge",
    ...rest
  } = props
  const hasIcon = Boolean(icon)
  const hasTrailing = Boolean(meta || trailing)
  const usesEdgeTrailing = hasTrailing && trailingPlacement === "edge"
  const usesInlineTrailing = hasTrailing && trailingPlacement === "inline"
  const gridClassName = hasIcon
    ? usesEdgeTrailing
      ? "grid-cols-[var(--ow-icon-action)_minmax(0,1fr)_minmax(var(--ow-agent-activity-trailing-min-width),auto)]"
      : "grid-cols-[var(--ow-icon-action)_minmax(0,1fr)]"
    : usesEdgeTrailing
      ? "grid-cols-[minmax(0,1fr)_minmax(var(--ow-agent-activity-trailing-min-width),auto)]"
      : "grid-cols-[minmax(0,1fr)]"

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
      {hasIcon ? (
        <span
          className="inline-flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center"
          data-slot="ow-agent-activity-icon"
        >
          {icon}
        </span>
      ) : null}
      <span
        className="inline-flex w-fit min-w-0 max-w-full justify-self-start items-baseline gap-x-[var(--ow-gap-sm)] overflow-hidden whitespace-nowrap"
        data-slot="ow-agent-activity-body"
      >
        <span
          className={cn(
            "block min-w-0 max-w-full truncate [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]",
            labelClassName
          )}
          data-slot="ow-agent-activity-label"
        >
          {label}
        </span>
        {detail ? (
          <span
            className={cn(
              "block min-w-0 max-w-[min(32rem,60vw)] shrink truncate [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-[var(--ow-agent-timeline-muted)]",
              detailClassName
            )}
            data-slot="ow-agent-activity-detail"
          >
            {detail}
          </span>
        ) : null}
        {usesInlineTrailing ? (
          <span
            className="inline-flex min-w-[var(--ow-agent-activity-trailing-min-width)] shrink-0 items-center justify-start self-center gap-[var(--ow-gap-xs)]"
            data-slot="ow-agent-activity-trailing"
          >
            {meta}
            {trailing}
          </span>
        ) : null}
      </span>
      {usesEdgeTrailing ? (
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
  hasDetail: boolean
  icon?: React.ReactNode
  meta?: React.ReactNode
  onOpenChange?: (open: boolean) => void
  open?: boolean
  state: AgentToolState
  subtitle?: React.ReactNode
  title: React.ReactNode
  triggerDataAttributes?: Record<`data-${string}`, string | undefined>
}

export function AgentTool(props: AgentToolProps): React.JSX.Element {
  const {
    className,
    defaultOpen = false,
    detail,
    hasDetail,
    icon,
    meta,
    onOpenChange,
    open,
    state,
    subtitle,
    title,
    triggerDataAttributes,
    ...rest
  } = props
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isOpen = open ?? internalOpen

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
          "ow-agent-tool overflow-hidden rounded-[var(--ow-radius-sm)] bg-transparent",
          className
        )}
        data-state={state}
        {...rest}
      >
        <CollapsibleTrigger asChild disabled={!hasDetail}>
          <Button
            className={cn(
              "h-auto min-w-0 max-w-full shrink justify-start gap-[var(--ow-gap-xs)] rounded-none bg-transparent px-0 py-[var(--ow-space-0-5)] text-left font-normal text-[var(--ow-agent-timeline-muted)] hover:bg-transparent",
              !hasDetail && "cursor-default opacity-100 hover:bg-transparent disabled:opacity-100"
            )}
            data-tool-trigger
            type="button"
            variant="ghost"
            {...triggerDataAttributes}
          >
            <AgentActivityRow
              active={state === "running"}
              className="w-fit max-w-full"
              detail={subtitle}
              detailClassName="ow-agent-tool-detail"
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
              trailingPlacement="inline"
            />
          </Button>
        </CollapsibleTrigger>
        {hasDetail ? (
          <CollapsibleContent className="ow-agent-tool-content overflow-hidden">
            <div className="min-w-0 max-w-full px-0 pb-[var(--ow-space-2)] pl-[calc(var(--ow-icon-action)+var(--ow-gap-sm))] pt-[var(--ow-space-1)]">
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
  leadingAccessory?: React.ReactNode
  meta?: React.ReactNode
  showLeadingToggle?: boolean
  showTrailingToggle?: boolean
}

export function AgentToolGroupTrigger(props: AgentToolGroupTriggerProps): React.JSX.Element {
  const {
    active,
    children,
    className,
    detail,
    icon = <ListTodo className="size-[var(--ow-icon-action)]" />,
    leadingAccessory,
    meta,
    showLeadingToggle = false,
    showTrailingToggle,
    ...rest
  } = props
  const hasLeadingIcon = icon !== null
  const usesLeadingToggle = !hasLeadingIcon && showLeadingToggle
  const shouldShowTrailingToggle = showTrailingToggle ?? (!hasLeadingIcon && !usesLeadingToggle)
  const leadingToggle = (
    <span className="relative inline-flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center">
      <ChevronRight className="ow-agent-tool-chevron absolute size-[var(--ow-icon-action)] opacity-45 group-hover:opacity-100 group-data-[state=open]:hidden" />
      <ChevronDown className="ow-agent-tool-chevron absolute hidden size-[var(--ow-icon-action)] group-data-[state=open]:block" />
    </span>
  )
  const leadingIcon = hasLeadingIcon ? (
    <span className="relative inline-flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center">
      <span className="transition-opacity group-hover:opacity-0 group-data-[state=open]:opacity-0">
        {icon}
      </span>
      <ChevronRight className="ow-agent-tool-chevron absolute size-[var(--ow-icon-action)] opacity-0 group-hover:opacity-100 group-data-[state=open]:hidden" />
      <ChevronDown className="ow-agent-tool-chevron absolute hidden size-[var(--ow-icon-action)] group-data-[state=open]:block" />
    </span>
  ) : usesLeadingToggle ? (
    leadingToggle
  ) : null
  const label = leadingAccessory ? (
    <span className="inline-flex min-w-0 max-w-full items-center gap-[var(--ow-gap-sm)]">
      {leadingAccessory}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  ) : (
    children
  )

  return (
    <CollapsibleTrigger
      className={cn(
        "ow-agent-tool-group-trigger group inline-flex min-w-0 max-w-full cursor-pointer items-center text-left text-[var(--ow-agent-timeline-muted)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      aria-live={active ? "polite" : undefined}
      data-active={active ? "true" : undefined}
      {...rest}
    >
      <AgentActivityRow
        active={active}
        className="w-fit max-w-full"
        detail={detail}
        detailClassName="ow-agent-tool-group-detail"
        icon={leadingIcon}
        label={label}
        labelClassName="ow-agent-tool-group-title block"
        meta={meta}
        trailing={
          shouldShowTrailingToggle ? (
            <span className="relative inline-flex size-[var(--ow-icon-sm)] shrink-0 items-center justify-center">
              <ChevronRight className="ow-agent-tool-chevron absolute size-[var(--ow-icon-sm)] opacity-45 group-hover:opacity-100 group-data-[state=open]:hidden" />
              <ChevronDown className="ow-agent-tool-chevron absolute hidden size-[var(--ow-icon-sm)] group-data-[state=open]:block" />
            </span>
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
      <div className="mt-[var(--ow-space-2)] min-w-0 max-w-full space-y-[var(--ow-space-2)]">
        {children}
      </div>
    </CollapsibleContent>
  )
}
