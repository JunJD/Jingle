import { Children, useState } from "react"
import { CheckCircle2, ChevronDown, Circle, Clock3, File, Folder, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { AppCopy } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import type { Todo } from "@/types"
import type { ToolApprovalChange } from "@shared/tool-approval"
import { getBasename, type ToolFileEntry } from "./shared"

export function ToolDetailStack(props: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element | null {
  const { children, className } = props

  if (Children.toArray(children).length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        "grid min-w-0 max-w-full gap-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] leading-[var(--ow-line-chat)] text-muted-foreground [&>*]:min-w-0",
        className
      )}
    >
      {children}
    </div>
  )
}

export function ToolCodeBlock(props: {
  children: string
  className?: string
}): React.JSX.Element | null {
  const { children, className } = props

  if (!children.trim()) {
    return null
  }

  return (
    <pre
      className={cn(
        "min-w-0 max-w-full overflow-x-auto rounded-[var(--ow-radius-panel)] bg-background-secondary/60 px-[var(--ow-space-3)] py-[var(--ow-space-2-5)] whitespace-pre-wrap break-all font-mono [font-size:var(--ow-font-code)] leading-[var(--ow-line-code)] text-foreground/85",
        className
      )}
    >
      {children}
    </pre>
  )
}

export function ToolPreviewLines(props: {
  text: string
  maxLines?: number
}): React.JSX.Element | null {
  const { text, maxLines = 12 } = props
  const lines = text.split("\n")
  const preview = lines.slice(0, maxLines)

  if (preview.length === 0) {
    return null
  }

  return (
    <div className="overflow-hidden rounded-[var(--ow-radius-dialog)] bg-background-secondary/60">
      <div className="grid gap-0 font-mono [font-size:var(--ow-font-code)] leading-[var(--ow-line-code)] text-foreground/85">
        {preview.map((line, index) => (
          <div key={`${index}-${line}`} className="grid grid-cols-[40px,minmax(0,1fr)]">
            <span className="px-[var(--ow-space-2)] py-[var(--ow-space-1-5)] text-right [font-size:var(--ow-font-meta)] text-muted-foreground/80 tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-all px-[var(--ow-space-3)] py-[var(--ow-space-1-5)]">
              {line || " "}
            </span>
          </div>
        ))}
      </div>
      {lines.length > maxLines ? (
        <div className="px-[var(--ow-space-3)] py-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
          +{lines.length - maxLines}
        </div>
      ) : null}
    </div>
  )
}

export function ToolDetailSection(props: {
  children: React.ReactNode
  className?: string
  label: string
}): React.JSX.Element | null {
  const { children, className, label } = props

  if (Children.toArray(children).length === 0) {
    return null
  }

  return (
    <div className={cn("grid gap-[var(--ow-space-1-5)]", className)}>
      <div className="[font-size:var(--ow-font-meta)] font-medium text-muted-foreground/90">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function ToolApprovalCard(props: {
  actions: React.ReactNode
  badgeLabel: string
  children: React.ReactNode
  subtitle?: string | null
  title: string
}): React.JSX.Element {
  const { actions, badgeLabel, children, subtitle, title } = props

  return (
    <div className="rounded-[var(--ow-radius-dialog)] border border-border/70 bg-background-elevated shadow-[0_14px_34px_rgba(32,38,45,0.05)]">
      <div className="grid gap-[var(--ow-gap-lg)] px-[var(--ow-space-4)] py-[var(--ow-space-4)]">
        <div className="grid min-w-0 gap-[var(--ow-gap-xs)]">
          <Badge
            className="w-fit rounded-full border-status-warning/25 bg-status-warning/10 px-[var(--ow-space-2-5)] py-[var(--ow-space-1)] [font-size:var(--ow-font-caption)] tracking-[0.12em] text-status-warning"
            variant="warning"
          >
            {badgeLabel}
          </Badge>
          <div className="min-w-0 [font-size:var(--ow-font-control)] font-medium leading-[var(--ow-line-chat)] text-foreground">
            {title}
          </div>
          {subtitle ? (
            <div className="min-w-0 font-mono [font-size:var(--ow-font-meta)] leading-[var(--ow-line-chat)] text-muted-foreground [overflow-wrap:anywhere]">
              {subtitle}
            </div>
          ) : null}
        </div>
        {children ? <div>{children}</div> : null}
        <div>{actions}</div>
      </div>
    </div>
  )
}

export function ToolApprovalActions(props: {
  approveLabel: string
  canEdit?: boolean
  editLabel?: string
  onApprove: () => void
  onEdit?: () => void
  onReject: () => void
  rejectLabel: string
}): React.JSX.Element {
  const {
    approveLabel,
    canEdit = false,
    editLabel,
    onApprove,
    onEdit,
    onReject,
    rejectLabel
  } = props

  return (
    <div className="flex flex-wrap items-center justify-end gap-[var(--ow-gap-sm)]">
      {canEdit && onEdit && editLabel ? (
        <Button
          className="rounded-[var(--ow-radius-lg)] border-border/70 bg-background text-foreground hover:bg-background-secondary"
          onClick={onEdit}
          size="sm"
          type="button"
          variant="outline"
        >
          {editLabel}
        </Button>
      ) : null}
      <Button
        className="rounded-[var(--ow-radius-lg)] border-border/70 bg-background text-foreground hover:bg-background-secondary"
        onClick={onReject}
        size="sm"
        type="button"
        variant="outline"
      >
        {rejectLabel}
      </Button>
      <Button
        className="rounded-[var(--ow-radius-lg)]"
        onClick={onApprove}
        size="sm"
        type="button"
        variant="default"
      >
        {approveLabel}
      </Button>
    </div>
  )
}

export function ToolFileList(props: {
  items: ToolFileEntry[]
  trimToBaseName?: boolean
  maxItems?: number
}): React.JSX.Element | null {
  const { items, maxItems = 12, trimToBaseName = false } = props
  const preview = items.slice(0, maxItems)

  if (preview.length === 0) {
    return null
  }

  return (
    <div className="grid gap-[var(--ow-gap-xs)]">
      {preview.map((item, index) => {
        const path = typeof item === "string" ? item : item.path
        const isDirectory = typeof item === "object" && Boolean(item.is_dir)
        const label = trimToBaseName ? getBasename(path) : path

        return (
          <div
            key={`${path}-${index}`}
            className="flex min-w-0 items-start gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
          >
            {isDirectory ? (
              <Folder className="mt-[var(--ow-leading-nudge)] size-[var(--ow-icon-sm)] shrink-0 text-muted-foreground" />
            ) : (
              <File className="mt-[var(--ow-leading-nudge)] size-[var(--ow-icon-sm)] shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 break-all text-foreground/80">{label}</span>
          </div>
        )
      })}
      {items.length > maxItems ? (
        <div className="[font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
          +{items.length - maxItems}
        </div>
      ) : null}
    </div>
  )
}

export function ToolChangeList(props: {
  copy: AppCopy
  items: ToolApprovalChange[]
  maxItems?: number
}): React.JSX.Element | null {
  const { copy, items, maxItems = 12 } = props
  const preview = items.slice(0, maxItems)

  if (preview.length === 0) {
    return null
  }

  const getChangeLabel = (changeType: ToolApprovalChange["changeType"]): string => {
    switch (changeType) {
      case "create":
        return copy.toolCall.changeCreate
      case "delete":
        return copy.toolCall.changeDelete
      case "modify":
        return copy.toolCall.changeModify
    }
  }

  const getChangeClassName = (changeType: ToolApprovalChange["changeType"]): string => {
    switch (changeType) {
      case "create":
        return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      case "delete":
        return "border-destructive/20 bg-destructive/10 text-destructive"
      case "modify":
        return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    }
  }

  return (
    <div className="grid gap-[var(--ow-gap-sm)]">
      {preview.map((item, index) => (
        <div
          key={`${item.changeType}:${item.path}:${index}`}
          className="flex min-w-0 items-start gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-panel)] bg-background-secondary/55 px-[var(--ow-space-3)] py-[var(--ow-space-2)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
        >
          <span
            className={cn(
              "mt-[var(--ow-leading-nudge)] inline-flex shrink-0 rounded-full px-[var(--ow-space-2)] py-[var(--ow-space-0-5)] [font-size:var(--ow-font-caption)] font-medium",
              getChangeClassName(item.changeType)
            )}
          >
            {getChangeLabel(item.changeType)}
          </span>
          <span className="min-w-0 break-all text-foreground/80">{item.path}</span>
        </div>
      ))}
      {items.length > maxItems ? (
        <div className="[font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
          +{items.length - maxItems}
        </div>
      ) : null}
    </div>
  )
}

export function ToolCollapsibleSection(props: {
  children: React.ReactNode
  defaultOpen?: boolean
  label: string
  summary?: string | null
}): React.JSX.Element | null {
  const { children, defaultOpen = false, label, summary } = props
  const [open, setOpen] = useState(defaultOpen)

  if (Children.toArray(children).length === 0) {
    return null
  }

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <div className="rounded-[var(--ow-radius-dialog)] bg-background-secondary/45 px-[var(--ow-space-3)] py-[var(--ow-space-2-5)]">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-[var(--ow-gap-md)] text-left">
          <div className="grid min-w-0 gap-[var(--ow-space-0-5)]">
            <div className="[font-size:var(--ow-font-meta)] font-medium text-muted-foreground/90">
              {label}
            </div>
            {summary ? (
              <div className="min-w-0 [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground [overflow-wrap:anywhere]">
                {summary}
              </div>
            ) : null}
          </div>
          <ChevronDown
            className={cn(
              "size-[var(--ow-icon-action)] shrink-0 text-muted-foreground transition-transform",
              open ? "rotate-180" : "rotate-0"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-[var(--ow-space-3)] data-[state=closed]:animate-out data-[state=open]:animate-in">
          {children}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export function ToolTodoList(props: { todos: Todo[] }): React.JSX.Element | null {
  const { todos } = props

  if (todos.length === 0) {
    return null
  }

  return (
    <div className="grid gap-[var(--ow-space-1-5)]">
      {todos.map((todo) => {
        const isDone = todo.status === "completed" || todo.status === "cancelled"
        const Icon =
          todo.status === "completed"
            ? CheckCircle2
            : todo.status === "in_progress"
              ? Clock3
              : todo.status === "cancelled"
                ? XCircle
                : Circle

        return (
          <div
            key={todo.id}
            className={cn(
              "flex min-w-0 items-start gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-foreground/80",
              isDone && "opacity-60"
            )}
          >
            <Icon className="mt-[var(--ow-leading-nudge)] size-[var(--ow-icon-sm)] shrink-0 text-muted-foreground" />
            <span className={cn("min-w-0 break-all", isDone && "line-through")}>
              {todo.content}
            </span>
          </div>
        )
      })}
    </div>
  )
}
