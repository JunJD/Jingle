import { Children, useState } from "react"
import { CheckCircle2, ChevronDown, Circle, Clock3, File, Folder, XCircle } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { Todo } from "@/types"
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
        "grid min-w-0 max-w-full gap-[var(--jingle-space-2-5)] [font-size:var(--jingle-font-control)] leading-[var(--jingle-line-chat)] text-muted-foreground [&>*]:min-w-0",
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
        "min-w-0 max-w-full overflow-x-auto rounded-[var(--jingle-radius-panel)] bg-background-secondary/60 px-[var(--jingle-space-3)] py-[var(--jingle-space-2-5)] whitespace-pre-wrap break-all font-mono [font-size:var(--jingle-font-code)] leading-[var(--jingle-line-code)] text-foreground/85",
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
    <div className="overflow-hidden rounded-[var(--jingle-radius-dialog)] bg-background-secondary/60">
      <div className="grid gap-0 font-mono [font-size:var(--jingle-font-code)] leading-[var(--jingle-line-code)] text-foreground/85">
        {preview.map((line, index) => (
          <div key={`${index}-${line}`} className="grid grid-cols-[40px,minmax(0,1fr)]">
            <span className="px-[var(--jingle-space-2)] py-[var(--jingle-space-1-5)] text-right [font-size:var(--jingle-font-meta)] text-muted-foreground/80 tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-all px-[var(--jingle-space-3)] py-[var(--jingle-space-1-5)]">
              {line || " "}
            </span>
          </div>
        ))}
      </div>
      {lines.length > maxLines ? (
        <div className="px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-muted-foreground">
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
    <div className={cn("grid gap-[var(--jingle-space-1-5)]", className)}>
      <div className="[font-size:var(--jingle-font-meta)] font-medium text-muted-foreground/90">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
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
    <div className="grid gap-[var(--jingle-gap-xs)]">
      {preview.map((item, index) => {
        const path = typeof item === "string" ? item : item.path
        const isDirectory = typeof item === "object" && Boolean(item.is_dir)
        const label = trimToBaseName ? getBasename(path) : path

        return (
          <div
            key={`${path}-${index}`}
            className="flex min-w-0 items-start gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)]"
          >
            {isDirectory ? (
              <Folder className="mt-[var(--jingle-leading-nudge)] size-[var(--jingle-icon-sm)] shrink-0 text-muted-foreground" />
            ) : (
              <File className="mt-[var(--jingle-leading-nudge)] size-[var(--jingle-icon-sm)] shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 break-all text-foreground/80">{label}</span>
          </div>
        )
      })}
      {items.length > maxItems ? (
        <div className="[font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-muted-foreground">
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
      <div className="rounded-[var(--jingle-radius-dialog)] bg-background-secondary/45 px-[var(--jingle-space-3)] py-[var(--jingle-space-2-5)]">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-[var(--jingle-gap-md)] text-left">
          <div className="grid min-w-0 gap-[var(--jingle-space-0-5)]">
            <div className="[font-size:var(--jingle-font-meta)] font-medium text-muted-foreground/90">
              {label}
            </div>
            {summary ? (
              <div className="min-w-0 [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)] text-muted-foreground [overflow-wrap:anywhere]">
                {summary}
              </div>
            ) : null}
          </div>
          <ChevronDown
            className={cn(
              "size-[var(--jingle-icon-action)] shrink-0 text-muted-foreground transition-transform",
              open ? "rotate-180" : "rotate-0"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-[var(--jingle-space-3)] data-[state=closed]:animate-out data-[state=open]:animate-in">
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
    <div className="grid gap-[var(--jingle-space-1-5)]">
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
              "flex min-w-0 items-start gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)] text-foreground/80",
              isDone && "opacity-60"
            )}
          >
            <Icon className="mt-[var(--jingle-leading-nudge)] size-[var(--jingle-icon-sm)] shrink-0 text-muted-foreground" />
            <span className={cn("min-w-0 break-all", isDone && "line-through")}>
              {todo.content}
            </span>
          </div>
        )
      })}
    </div>
  )
}
