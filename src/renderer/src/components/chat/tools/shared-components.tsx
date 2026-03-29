import { Children } from "react"
import { CheckCircle2, Circle, Clock3, File, Folder, XCircle } from "lucide-react"
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
    <div className={cn("grid gap-2.5 text-[13px] leading-5 text-muted-foreground", className)}>
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
        "overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-foreground/80",
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
    <div className="grid gap-0.5 font-mono text-[12px] leading-5 text-foreground/80">
      {preview.map((line, index) => (
        <div key={`${index}-${line}`} className="grid grid-cols-[auto,minmax(0,1fr)] gap-3">
          <span className="min-w-[1.75rem] text-right text-muted-foreground">{index + 1}</span>
          <span className="min-w-0 whitespace-pre-wrap break-all">{line || " "}</span>
        </div>
      ))}
      {lines.length > maxLines ? (
        <div className="pt-1 text-[11px] leading-4 text-muted-foreground">
          +{lines.length - maxLines}
        </div>
      ) : null}
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
