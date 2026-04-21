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
        "grid min-w-0 max-w-full gap-2.5 text-[13px] leading-5 text-muted-foreground [&>*]:min-w-0",
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
        "min-w-0 max-w-full overflow-x-auto rounded-[12px] bg-background-secondary/60 px-3 py-2.5 whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-foreground/85",
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
    <div className="overflow-hidden rounded-[14px] bg-background-secondary/60">
      <div className="grid gap-0 font-mono text-[12px] leading-5 text-foreground/85">
        {preview.map((line, index) => (
          <div key={`${index}-${line}`} className="grid grid-cols-[40px,minmax(0,1fr)]">
            <span className="px-2 py-1.5 text-right text-[11px] text-muted-foreground/80 tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-all px-3 py-1.5">{line || " "}</span>
          </div>
        ))}
      </div>
      {lines.length > maxLines ? (
        <div className="px-3 py-2 text-[11px] leading-4 text-muted-foreground">
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
    <div className={cn("grid gap-1.5", className)}>
      <div className="text-[11px] font-medium text-muted-foreground/90">{label}</div>
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
    <div className="rounded-[18px] border border-border/70 bg-background-elevated shadow-[0_14px_34px_rgba(32,38,45,0.05)]">
      <div className="grid gap-4 px-4 py-4">
        <div className="grid min-w-0 gap-1">
          <Badge
            className="w-fit rounded-full border-status-warning/25 bg-status-warning/10 px-2.5 py-1 text-[10px] tracking-[0.12em] text-status-warning"
            variant="warning"
          >
            {badgeLabel}
          </Badge>
          <div className="min-w-0 text-[13px] font-medium leading-5 text-foreground">{title}</div>
          {subtitle ? (
            <div className="min-w-0 font-mono text-[11px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
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
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canEdit && onEdit && editLabel ? (
        <Button
          className="rounded-[10px] border-border/70 bg-background text-foreground hover:bg-background-secondary"
          onClick={onEdit}
          size="sm"
          type="button"
          variant="outline"
        >
          {editLabel}
        </Button>
      ) : null}
      <Button
        className="rounded-[10px] border-border/70 bg-background text-foreground hover:bg-background-secondary"
        onClick={onReject}
        size="sm"
        type="button"
        variant="outline"
      >
        {rejectLabel}
      </Button>
      <Button
        className="rounded-[10px]"
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
    <div className="grid gap-1">
      {preview.map((item, index) => {
        const path = typeof item === "string" ? item : item.path
        const isDirectory = typeof item === "object" && Boolean(item.is_dir)
        const label = trimToBaseName ? getBasename(path) : path

        return (
          <div
            key={`${path}-${index}`}
            className="flex min-w-0 items-start gap-2 text-[12px] leading-5"
          >
            {isDirectory ? (
              <Folder className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <File className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 break-all text-foreground/80">{label}</span>
          </div>
        )
      })}
      {items.length > maxItems ? (
        <div className="text-[11px] leading-4 text-muted-foreground">
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
    <div className="grid gap-2">
      {preview.map((item, index) => (
        <div
          key={`${item.changeType}:${item.path}:${index}`}
          className="flex min-w-0 items-start gap-2 rounded-[12px] bg-background-secondary/55 px-3 py-2 text-[12px] leading-5"
        >
          <span
            className={cn(
              "mt-0.5 inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
              getChangeClassName(item.changeType)
            )}
          >
            {getChangeLabel(item.changeType)}
          </span>
          <span className="min-w-0 break-all text-foreground/80">{item.path}</span>
        </div>
      ))}
      {items.length > maxItems ? (
        <div className="text-[11px] leading-4 text-muted-foreground">
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
      <div className="rounded-[14px] bg-background-secondary/45 px-3 py-2.5">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
          <div className="grid min-w-0 gap-0.5">
            <div className="text-[11px] font-medium text-muted-foreground/90">{label}</div>
            {summary ? (
              <div className="min-w-0 text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                {summary}
              </div>
            ) : null}
          </div>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open ? "rotate-180" : "rotate-0"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 data-[state=closed]:animate-out data-[state=open]:animate-in">
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
    <div className="grid gap-1.5">
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
              "flex min-w-0 items-start gap-2 text-[12px] leading-5 text-foreground/80",
              isDone && "opacity-60"
            )}
          >
            <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span className={cn("min-w-0 break-all", isDone && "line-through")}>
              {todo.content}
            </span>
          </div>
        )
      })}
    </div>
  )
}
