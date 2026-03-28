import {
  FileText,
  FolderOpen,
  Search,
  Edit,
  Terminal,
  ListTodo,
  GitBranch,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  File,
  Folder
} from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ToolCall, Todo } from "@/types"
import { useI18n } from "@/lib/i18n"

interface ToolCallRendererProps {
  toolCall: ToolCall
  result?: string | unknown
  isError?: boolean
  needsApproval?: boolean
  onApprovalDecision?: (decision: "approve" | "reject" | "edit") => void
}

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  read_file: FileText,
  write_file: Edit,
  edit_file: Edit,
  ls: FolderOpen,
  glob: FolderOpen,
  grep: Search,
  execute: Terminal,
  write_todos: ListTodo,
  task: GitBranch
}

// Tools whose results are shown in the UI panels and don't need verbose display
const PANEL_SYNCED_TOOLS = new Set(["write_todos"])

// Helper to get a clean file name from path
function getFileName(path: string): string {
  return path.split("/").pop() || path
}

// Render todos nicely
function TodosDisplay({ todos }: { todos: Todo[] }): React.JSX.Element {
  const statusConfig: Record<string, { icon: typeof Circle; color: string }> = {
    pending: { icon: Circle, color: "text-muted-foreground" },
    in_progress: { icon: Clock, color: "text-status-info" },
    completed: { icon: CheckCircle2, color: "text-status-nominal" },
    cancelled: { icon: XCircle, color: "text-muted-foreground" }
  }

  const defaultConfig = { icon: Circle, color: "text-muted-foreground" }

  return (
    <div className="space-y-1">
      {todos.map((todo, i) => {
        const config = statusConfig[todo.status] || defaultConfig
        const Icon = config.icon
        const isDone = todo.status === "completed" || todo.status === "cancelled"
        return (
          <div
            key={todo.id || i}
            className={cn("flex min-w-0 items-start gap-2 text-xs", isDone && "opacity-50")}
          >
            <Icon className={cn("size-3.5 mt-0.5 shrink-0", config.color)} />
            <span className={cn("min-w-0 [overflow-wrap:anywhere]", isDone && "line-through")}>
              {todo.content}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Render file list nicely
function FileListDisplay({
  files,
  isGlob
}: {
  files: string[] | Array<{ path: string; is_dir?: boolean }>
  isGlob?: boolean
}): React.JSX.Element {
  const { copy } = useI18n()
  const items = files.slice(0, 15) // Limit display
  const hasMore = files.length > 15

  return (
    <div className="space-y-0.5">
      {items.map((file, i) => {
        const path = typeof file === "string" ? file : file.path
        const isDir = typeof file === "object" && file.is_dir
        return (
          <div key={i} className="flex min-w-0 items-center gap-2 text-xs font-mono">
            {isDir ? (
              <Folder className="size-3 text-status-warning shrink-0" />
            ) : (
              <File className="size-3 text-muted-foreground shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{isGlob ? path : getFileName(path)}</span>
          </div>
        )
      })}
      {hasMore && (
        <div className="text-xs text-muted-foreground mt-1">
          {copy.toolCall.moreItems(files.length - 15)}
        </div>
      )}
    </div>
  )
}

// Render grep results nicely
function GrepResultsDisplay({
  matches
}: {
  matches: Array<{ path: string; line?: number; text?: string }>
}): React.JSX.Element {
  const { copy } = useI18n()
  const grouped = matches.reduce(
    (acc, match) => {
      if (!acc[match.path]) acc[match.path] = []
      acc[match.path].push(match)
      return acc
    },
    {} as Record<string, typeof matches>
  )

  const files = Object.keys(grouped).slice(0, 5)
  const hasMore = Object.keys(grouped).length > 5

  return (
    <div className="space-y-2">
      {files.map((path) => (
        <div key={path} className="min-w-0 text-xs">
          <div className="mb-1 flex min-w-0 items-center gap-1.5 font-medium text-status-info">
            <FileText className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{getFileName(path)}</span>
          </div>
          <div className="min-w-0 space-y-0.5 border-l border-border/50 pl-4">
            {grouped[path].slice(0, 3).map((match, i) => (
              <div key={i} className="min-w-0 font-mono text-muted-foreground truncate">
                {match.line && <span className="text-status-warning mr-2">{match.line}:</span>}
                {match.text?.trim()}
              </div>
            ))}
            {grouped[path].length > 3 && (
              <div className="text-muted-foreground">
                {copy.toolCall.moreMatches(grouped[path].length - 3)}
              </div>
            )}
          </div>
        </div>
      ))}
      {hasMore && (
        <div className="text-xs text-muted-foreground">
          {copy.toolCall.moreFiles(Object.keys(grouped).length - 5)}
        </div>
      )}
    </div>
  )
}

// Render file content preview
function FileContentPreview({ content }: { content: string; path?: string }): React.JSX.Element {
  const { copy } = useI18n()
  const lines = content.split("\n")
  const preview = lines.slice(0, 10)
  const hasMore = lines.length > 10

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-sm bg-background text-xs font-mono">
      <pre className="max-h-40 w-full overflow-auto p-2">
        {preview.map((line, i) => (
          <div key={i} className="flex min-w-0">
            <span className="w-8 shrink-0 text-muted-foreground select-none pr-2 text-right">
              {i + 1}
            </span>
            <span className="flex-1 min-w-0 truncate">{line || " "}</span>
          </div>
        ))}
      </pre>
      {hasMore && (
        <div className="px-2 py-1 text-muted-foreground bg-background-elevated border-t border-border">
          {copy.toolCall.moreLines(lines.length - 10)}
        </div>
      )}
    </div>
  )
}

// Render edit/write file summary
function FileEditSummary({ args }: { args: Record<string, unknown> }): React.JSX.Element | null {
  const { copy } = useI18n()
  const path = (args.path || args.file_path) as string
  const content = args.content as string | undefined
  const oldStr = args.old_str as string | undefined
  const newStr = args.new_str as string | undefined

  if (oldStr !== undefined && newStr !== undefined) {
    // Edit operation
    return (
      <div className="text-xs space-y-2">
        <div className="flex items-center gap-1.5 text-status-critical">
          <span className="font-mono bg-status-critical/10 px-1.5 py-0.5 rounded">
            - {oldStr.split("\n").length} lines
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-status-nominal">
          <span className="font-mono bg-status-nominal/10 px-1.5 py-0.5 rounded">
            + {newStr.split("\n").length} lines
          </span>
        </div>
      </div>
    )
  }

  if (content) {
    const lines = content.split("\n").length
    return (
      <div className="text-xs text-muted-foreground">
        {copy.toolCall.writeLinesToFile(lines, getFileName(path))}
      </div>
    )
  }

  return null
}

// Command display
function CommandDisplay({
  command,
  output
}: {
  command: string
  output?: string
}): React.JSX.Element {
  return (
    <div className="w-full min-w-0 space-y-2 overflow-hidden text-xs">
      <div className="grid min-w-0 w-full grid-cols-[auto,minmax(0,1fr)] items-start gap-2 rounded-sm bg-background p-2 font-mono">
        <span className="text-status-info shrink-0">$</span>
        <span className="block min-w-0 whitespace-pre-wrap break-all [overflow-wrap:anywhere]">
          {command}
        </span>
      </div>
      {output && (
        <pre className="max-h-32 w-full overflow-auto rounded-sm bg-background p-2 font-mono text-muted-foreground whitespace-pre-wrap break-all">
          {output.slice(0, 500)}
          {output.length > 500 && "..."}
        </pre>
      )}
    </div>
  )
}

// Subagent task display
function TaskDisplay({
  args,
  isExpanded
}: {
  args: Record<string, unknown>
  isExpanded?: boolean
}): React.JSX.Element {
  const name = args.name as string | undefined
  const description = args.description as string | undefined

  return (
    <div className="min-w-0 space-y-1 text-xs">
      {name && (
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="size-3 shrink-0 text-status-info" />
          <span className="min-w-0 truncate font-medium">{name}</span>
        </div>
      )}
      {description && (
        <p
          className={cn(
            "pl-5 text-muted-foreground [overflow-wrap:anywhere]",
            !isExpanded && "line-clamp-2"
          )}
        >
          {description}
        </p>
      )}
    </div>
  )
}

export function ToolCallRenderer({
  toolCall,
  result,
  isError,
  needsApproval,
  onApprovalDecision
}: ToolCallRendererProps): React.JSX.Element | null {
  const { copy } = useI18n()
  // Defensive: ensure args is always an object
  const args = toolCall?.args || {}

  const [isExpanded, setIsExpanded] = useState(false)

  // Bail out if no toolCall
  if (!toolCall) {
    return null
  }

  const Icon = TOOL_ICONS[toolCall.name] || Terminal
  const label = copy.toolCall.labels[toolCall.name] || toolCall.name
  const isPanelSynced = PANEL_SYNCED_TOOLS.has(toolCall.name)

  const handleApprove = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onApprovalDecision?.("approve")
  }

  const handleReject = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onApprovalDecision?.("reject")
  }

  // Format the main argument for display
  const getDisplayArg = (): string | null => {
    if (!args) return null
    if (args.path) return args.path as string
    if (args.file_path) return args.file_path as string
    if (args.command) return (args.command as string).slice(0, 50)
    if (args.pattern) return args.pattern as string
    if (args.query) return args.query as string
    if (args.glob) return args.glob as string
    return null
  }

  const displayArg = getDisplayArg()

  // Render formatted content based on tool type
  const renderFormattedContent = (): React.ReactNode => {
    if (!args) return null

    switch (toolCall.name) {
      case "write_todos": {
        const todos = args.todos as Todo[] | undefined
        if (todos && todos.length > 0) {
          return <TodosDisplay todos={todos} />
        }
        return null
      }

      case "task": {
        return <TaskDisplay args={args} isExpanded={isExpanded} />
      }

      case "edit_file":
      case "write_file": {
        return <FileEditSummary args={args} />
      }

      case "execute": {
        const command = args.command as string
        const output = typeof result === "string" ? result : undefined
        return <CommandDisplay command={command} output={isExpanded ? output : undefined} />
      }

      default:
        return null
    }
  }

  // Render result based on tool type
  const renderFormattedResult = (): React.ReactNode => {
    if (result === undefined) return null

    // Handle errors
    if (isError) {
      return (
        <div className="flex min-w-0 items-start gap-1.5 text-xs text-status-critical">
          <XCircle className="size-3 mt-0.5 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {typeof result === "string" ? result : JSON.stringify(result)}
          </span>
        </div>
      )
    }

    switch (toolCall.name) {
      case "read_file": {
        const content = typeof result === "string" ? result : JSON.stringify(result)
        const lines = content.split("\n").length
        return (
          <div className="space-y-2">
            <div className="text-xs text-status-nominal flex items-center gap-1.5">
              <CheckCircle2 className="size-3" />
              <span>{copy.toolCall.readLines(lines)}</span>
            </div>
            <FileContentPreview content={content} />
          </div>
        )
      }

      case "ls": {
        if (Array.isArray(result)) {
          const dirs = result.filter(
            (f: { is_dir?: boolean } | string) => typeof f === "object" && f.is_dir
          ).length
          const files = result.length - dirs
          return (
            <div className="space-y-2">
              <div className="text-xs text-status-nominal flex items-center gap-1.5">
                <CheckCircle2 className="size-3" />
                <span>{copy.toolCall.filesAndFolders(files, dirs)}</span>
              </div>
              <FileListDisplay files={result} />
            </div>
          )
        }
        return null
      }

      case "glob": {
        if (Array.isArray(result)) {
          return (
            <div className="space-y-2">
              <div className="text-xs text-status-nominal flex items-center gap-1.5">
                <CheckCircle2 className="size-3" />
                <span>{copy.toolCall.foundMatches(result.length)}</span>
              </div>
              <FileListDisplay files={result} isGlob />
            </div>
          )
        }
        return null
      }

      case "grep": {
        if (Array.isArray(result)) {
          const fileCount = new Set(result.map((m: { path: string }) => m.path)).size
          return (
            <div className="space-y-2">
              <div className="text-xs text-status-nominal flex items-center gap-1.5">
                <CheckCircle2 className="size-3" />
                <span>{copy.toolCall.matchesInFiles(result.length, fileCount)}</span>
              </div>
              <GrepResultsDisplay matches={result} />
            </div>
          )
        }
        return null
      }

      case "execute": {
        // When expanded, output is shown in CommandDisplay - just show status
        // When collapsed, show the output preview
        const output = typeof result === "string" ? result : JSON.stringify(result)
        if (isExpanded) {
          return (
            <div className="text-xs text-status-nominal flex items-center gap-1.5">
              <CheckCircle2 className="size-3" />
              <span>{copy.toolCall.commandCompleted}</span>
            </div>
          )
        }
        // Collapsed view - show output preview
        if (output.trim()) {
          return (
            <div className="space-y-2">
              <div className="text-xs text-status-nominal flex items-center gap-1.5">
                <CheckCircle2 className="size-3" />
                <span>{copy.toolCall.commandCompleted}</span>
              </div>
              <pre className="text-xs font-mono bg-background rounded-sm p-2 overflow-auto max-h-32 text-muted-foreground whitespace-pre-wrap break-all">
                {output.slice(0, 500)}
                {output.length > 500 && "..."}
              </pre>
            </div>
          )
        }
        return (
          <div className="text-xs text-status-nominal flex items-center gap-1.5">
            <CheckCircle2 className="size-3" />
            <span>{copy.toolCall.commandCompletedNoOutput}</span>
          </div>
        )
      }

      case "write_todos":
        // Already shown in Tasks panel
        return null

      case "write_file":
      case "edit_file": {
        // Show confirmation message for file operations
        if (typeof result === "string" && result.trim()) {
          return (
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-status-nominal">
              <CheckCircle2 className="size-3 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{result}</span>
            </div>
          )
        }
        return (
          <div className="text-xs text-status-nominal flex items-center gap-1.5">
            <CheckCircle2 className="size-3" />
            <span>{copy.toolCall.fileSaved}</span>
          </div>
        )
      }

      case "task": {
        // Subagent task completion
        if (typeof result === "string" && result.trim()) {
          return (
            <div className="space-y-2">
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-status-nominal">
                <CheckCircle2 className="size-3 shrink-0" />
                <span>{copy.toolCall.taskCompleted}</span>
              </div>
              <div className="pl-5 text-xs text-muted-foreground line-clamp-3 [overflow-wrap:anywhere]">
                {result.slice(0, 500)}
                {result.length > 500 && "..."}
              </div>
            </div>
          )
        }
        return (
          <div className="text-xs text-status-nominal flex items-center gap-1.5">
            <CheckCircle2 className="size-3" />
            <span>{copy.toolCall.taskCompleted}</span>
          </div>
        )
      }

      default: {
        // Generic success for unknown tools
        if (typeof result === "string" && result.trim()) {
          return (
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-status-nominal">
              <CheckCircle2 className="size-3 shrink-0" />
              <span className="min-w-0 truncate">
                {result.slice(0, 100)}
                {result.length > 100 ? "..." : ""}
              </span>
            </div>
          )
        }
        return (
          <div className="text-xs text-status-nominal flex items-center gap-1.5">
            <CheckCircle2 className="size-3" />
            <span>{copy.toolCall.completed}</span>
          </div>
        )
      }
    }
  }

  const formattedContent = renderFormattedContent()
  const formattedResult = renderFormattedResult()
  const hasFormattedDisplay = formattedContent || formattedResult

  return (
    <div
      className={cn(
        "w-full min-w-0 max-w-full overflow-hidden rounded-sm border",
        needsApproval
          ? "border-amber-500/50 bg-amber-500/5"
          : "border-border bg-background-elevated"
      )}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full min-w-0 items-center gap-2 overflow-hidden px-3 py-2 transition-colors hover:bg-background-interactive"
      >
        {isExpanded ? (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        )}

        <Icon
          className={cn("size-4 shrink-0", needsApproval ? "text-amber-500" : "text-status-info")}
        />

        <span className="shrink-0 text-xs font-medium">{label}</span>

        {displayArg && (
          <span className="block min-w-0 flex-1 truncate text-left text-xs font-mono text-muted-foreground">
            {displayArg}
          </span>
        )}

        {needsApproval && (
          <Badge variant="warning" className="ml-auto shrink-0">
            {copy.common.approval}
          </Badge>
        )}

        {!needsApproval && result === undefined && (
          <Badge variant="outline" className="ml-auto shrink-0 animate-pulse">
            {copy.common.running}
          </Badge>
        )}

        {result !== undefined && !needsApproval && (
          <Badge variant={isError ? "critical" : "nominal"} className="ml-auto shrink-0">
            {isError ? copy.common.error : copy.common.ok}
          </Badge>
        )}

        {isPanelSynced && !needsApproval && (
          <Badge variant="outline" className="shrink-0 text-[9px]">
            {copy.common.synced}
          </Badge>
        )}
      </button>

      {/* Approval UI */}
      {needsApproval ? (
        <div className="min-w-0 space-y-3 border-t border-amber-500/20 px-3 py-3">
          {/* Show formatted content (e.g., command preview) */}
          {formattedContent}

          {/* Arguments */}
          <div>
            <div className="text-section-header text-[10px] mb-1">{copy.common.arguments}</div>
            <pre className="max-h-24 w-full max-w-full overflow-auto rounded-sm bg-background p-2 text-xs font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2">
            <button
              className="px-3 py-1.5 text-xs border border-border rounded-sm hover:bg-background-interactive transition-colors"
              onClick={handleReject}
            >
              {copy.toolCall.reject}
            </button>
            <button
              className="px-3 py-1.5 text-xs bg-status-nominal text-background rounded-sm hover:bg-status-nominal/90 transition-colors"
              onClick={handleApprove}
            >
              {copy.toolCall.approveAndRun}
            </button>
          </div>
        </div>
      ) : null}

      {/* Formatted content (only visible when collapsed AND has result) */}
      {hasFormattedDisplay && !isExpanded && !needsApproval && result !== undefined && (
        <div className="min-w-0 space-y-2 overflow-hidden border-t border-border px-3 py-2">
          {formattedContent}
          {formattedResult}
        </div>
      )}

      {/* Expanded content - raw details */}
      {isExpanded && !needsApproval && (
        <div className="min-w-0 space-y-2 overflow-hidden border-t border-border px-3 py-2">
          {/* Formatted display first */}
          {formattedContent}
          {formattedResult}

          {/* Raw Arguments */}
          <div className="overflow-hidden w-full">
            <div className="text-section-header mb-1">{copy.common.rawArguments}</div>
            <pre className="max-h-48 w-full max-w-full overflow-auto rounded-sm bg-background p-2 text-xs font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>

          {/* Raw Result */}
          {result !== undefined && (
            <div className="overflow-hidden w-full">
              <div className="text-section-header mb-1">{copy.common.rawResult}</div>
              <pre
                className={cn(
                  "max-h-48 w-full max-w-full overflow-auto rounded-sm p-2 text-xs font-mono whitespace-pre-wrap break-all",
                  isError ? "bg-status-critical/10 text-status-critical" : "bg-background"
                )}
              >
                {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
