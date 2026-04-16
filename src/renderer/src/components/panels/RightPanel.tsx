import { useState, useRef, useCallback, useEffect } from "react"
import {
  ListTodo,
  PackageOpen,
  GitBranch,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  GripHorizontal,
  ExternalLink,
  FileText,
  Link2,
  FileCode2
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useThreadState } from "@/lib/thread-context"
import { Badge } from "@/components/ui/badge"
import { CodeBlock } from "@/components/ui/code-block"
import type { Todo } from "@/types"
import {
  getArtifactCapabilities,
  supportsArtifactAction,
  type ArtifactActionId,
  type ArtifactRecord
} from "@shared/artifacts"

const HEADER_HEIGHT = 40 // px
const HANDLE_HEIGHT = 6 // px
const MIN_CONTENT_HEIGHT = 60 // px
const COLLAPSE_THRESHOLD = 55 // px - auto-collapse when below this
const EMPTY_ARTIFACTS: ArtifactRecord[] = []

interface SectionHeaderProps {
  title: string
  icon: React.ElementType
  badge?: number
  isOpen: boolean
  onToggle: () => void
}

function SectionHeader({
  title,
  icon: Icon,
  badge,
  isOpen,
  onToggle
}: SectionHeaderProps): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 px-3 py-2.5 text-section-header hover:bg-background-interactive transition-colors shrink-0 w-full"
      style={{ height: HEADER_HEIGHT }}
    >
      <ChevronRight
        className={cn(
          "size-3.5 text-muted-foreground transition-transform duration-200",
          isOpen && "rotate-90"
        )}
      />
      <Icon className="size-4" />
      <span className="flex-1 text-left">{title}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-[10px] text-muted-foreground tabular-nums">{badge}</span>
      )}
    </button>
  )
}

interface ResizeHandleProps {
  onDrag: (delta: number) => void
}

function ResizeHandle({ onDrag }: ResizeHandleProps): React.JSX.Element {
  const startYRef = useRef<number>(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startYRef.current = e.clientY

      const handleMouseMove = (e: MouseEvent): void => {
        // Calculate total delta from drag start
        const totalDelta = e.clientY - startYRef.current
        onDrag(totalDelta)
      }

      const handleMouseUp = (): void => {
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = "row-resize"
      document.body.style.userSelect = "none"
    },
    [onDrag]
  )

  return (
    <div
      onMouseDown={handleMouseDown}
      className="group bg-border/50 hover:bg-primary/30 active:bg-primary/50 transition-colors cursor-row-resize flex items-center justify-center shrink-0 select-none"
      style={{ height: HANDLE_HEIGHT }}
    >
      <GripHorizontal className="size-4 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
    </div>
  )
}

export function RightPanel(): React.JSX.Element {
  const { currentThreadId } = useHistoryShellStore()
  const threadState = useThreadState(currentThreadId)
  const todos = threadState?.todos ?? []
  const artifactCount = threadState?.artifacts.length ?? 0
  const subagents = threadState?.subagents ?? []
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(0)

  const [tasksOpen, setTasksOpen] = useState(true)
  const [artifactsOpen, setArtifactsOpen] = useState(true)
  const [agentsOpen, setAgentsOpen] = useState(true)

  // Store content heights in pixels (null = auto/equal distribution)
  const [tasksHeight, setTasksHeight] = useState<number | null>(null)
  const [artifactsHeight, setArtifactsHeight] = useState<number | null>(null)
  const [agentsHeight, setAgentsHeight] = useState<number | null>(null)

  const resetContentHeights = useCallback(() => {
    setTasksHeight(null)
    setArtifactsHeight(null)
    setAgentsHeight(null)
  }, [])

  const toggleTasksOpen = useCallback(() => {
    resetContentHeights()
    setTasksOpen((prev) => !prev)
  }, [resetContentHeights])

  const toggleArtifactsOpen = useCallback(() => {
    resetContentHeights()
    setArtifactsOpen((prev) => !prev)
  }, [resetContentHeights])

  const toggleAgentsOpen = useCallback(() => {
    resetContentHeights()
    setAgentsOpen((prev) => !prev)
  }, [resetContentHeights])

  // Track drag start heights
  const dragStartHeights = useRef<{ tasks: number; artifacts: number; agents: number } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setContainerHeight(entry.contentRect.height)
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Calculate available content height
  const getAvailableContentHeight = useCallback(() => {
    // Subtract headers (always visible)
    let used = HEADER_HEIGHT * 3

    // Subtract handles (only between open panels)
    if (tasksOpen && (artifactsOpen || agentsOpen)) used += HANDLE_HEIGHT
    if (artifactsOpen && agentsOpen) used += HANDLE_HEIGHT

    return Math.max(0, containerHeight - used)
  }, [containerHeight, tasksOpen, artifactsOpen, agentsOpen])

  // Get current heights for each panel's content area
  const getContentHeights = useCallback(() => {
    const available = getAvailableContentHeight()
    const openCount = [tasksOpen, artifactsOpen, agentsOpen].filter(Boolean).length

    if (openCount === 0) {
      return { tasks: 0, artifacts: 0, agents: 0 }
    }

    const defaultHeight = available / openCount

    return {
      tasks: tasksOpen ? (tasksHeight ?? defaultHeight) : 0,
      artifacts: artifactsOpen ? (artifactsHeight ?? defaultHeight) : 0,
      agents: agentsOpen ? (agentsHeight ?? defaultHeight) : 0
    }
  }, [
    getAvailableContentHeight,
    tasksOpen,
    artifactsOpen,
    agentsOpen,
    tasksHeight,
    artifactsHeight,
    agentsHeight
  ])

  // Handle resize between tasks and the next open section
  const handleTasksResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartHeights.current) {
        const heights = getContentHeights()
        dragStartHeights.current = { ...heights }
      }

      const start = dragStartHeights.current
      const available = getAvailableContentHeight()

      // Determine which panel is being resized against
      const otherStart = artifactsOpen ? start.artifacts : start.agents

      // Calculate new heights with proper clamping
      let newTasksHeight = start.tasks + totalDelta
      let newOtherHeight = otherStart - totalDelta

      // Clamp both to min height
      if (newTasksHeight < MIN_CONTENT_HEIGHT) {
        newTasksHeight = MIN_CONTENT_HEIGHT
        newOtherHeight = otherStart + (start.tasks - MIN_CONTENT_HEIGHT)
      }
      if (newOtherHeight < MIN_CONTENT_HEIGHT) {
        newOtherHeight = MIN_CONTENT_HEIGHT
        newTasksHeight = start.tasks + (otherStart - MIN_CONTENT_HEIGHT)
      }

      // Ensure total doesn't exceed available (accounting for third panel if open)
      const thirdPanelHeight = artifactsOpen && agentsOpen ? (agentsHeight ?? available / 3) : 0
      const maxForTwo = available - thirdPanelHeight
      if (newTasksHeight + newOtherHeight > maxForTwo) {
        const excess = newTasksHeight + newOtherHeight - maxForTwo
        if (totalDelta > 0) {
          newOtherHeight = Math.max(MIN_CONTENT_HEIGHT, newOtherHeight - excess)
        } else {
          newTasksHeight = Math.max(MIN_CONTENT_HEIGHT, newTasksHeight - excess)
        }
      }

      setTasksHeight(newTasksHeight)
      if (artifactsOpen) {
        setArtifactsHeight(newOtherHeight)
      } else if (agentsOpen) {
        setAgentsHeight(newOtherHeight)
      }

      // Auto-collapse if below threshold
      if (newTasksHeight < COLLAPSE_THRESHOLD) {
        setTasksOpen(false)
      }
      if (newOtherHeight < COLLAPSE_THRESHOLD) {
        if (artifactsOpen) setArtifactsOpen(false)
        else if (agentsOpen) setAgentsOpen(false)
      }
    },
    [getContentHeights, getAvailableContentHeight, artifactsOpen, agentsOpen, agentsHeight]
  )

  // Handle resize between artifacts and agents
  const handleArtifactsResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartHeights.current) {
        const heights = getContentHeights()
        dragStartHeights.current = { ...heights }
      }

      const start = dragStartHeights.current
      const available = getAvailableContentHeight()
      const tasksH = tasksOpen ? (tasksHeight ?? available / 3) : 0
      const maxForArtifactsAndAgents = available - tasksH

      // Calculate new heights with proper clamping
      let newArtifactsHeight = start.artifacts + totalDelta
      let newAgentsHeight = start.agents - totalDelta

      // Clamp both to min height
      if (newArtifactsHeight < MIN_CONTENT_HEIGHT) {
        newArtifactsHeight = MIN_CONTENT_HEIGHT
        newAgentsHeight = start.agents + (start.artifacts - MIN_CONTENT_HEIGHT)
      }
      if (newAgentsHeight < MIN_CONTENT_HEIGHT) {
        newAgentsHeight = MIN_CONTENT_HEIGHT
        newArtifactsHeight = start.artifacts + (start.agents - MIN_CONTENT_HEIGHT)
      }

      // Ensure total doesn't exceed available
      if (newArtifactsHeight + newAgentsHeight > maxForArtifactsAndAgents) {
        const excess = newArtifactsHeight + newAgentsHeight - maxForArtifactsAndAgents
        if (totalDelta > 0) {
          newAgentsHeight = Math.max(MIN_CONTENT_HEIGHT, newAgentsHeight - excess)
        } else {
          newArtifactsHeight = Math.max(MIN_CONTENT_HEIGHT, newArtifactsHeight - excess)
        }
      }

      setArtifactsHeight(newArtifactsHeight)
      setAgentsHeight(newAgentsHeight)

      // Auto-collapse if below threshold
      if (newArtifactsHeight < COLLAPSE_THRESHOLD) {
        setArtifactsOpen(false)
      }
      if (newAgentsHeight < COLLAPSE_THRESHOLD) {
        setAgentsOpen(false)
      }
    },
    [getContentHeights, getAvailableContentHeight, tasksOpen, tasksHeight]
  )

  // Reset drag start on mouse up
  useEffect(() => {
    const handleMouseUp = (): void => {
      dragStartHeights.current = null
    }
    document.addEventListener("mouseup", handleMouseUp)
    return () => document.removeEventListener("mouseup", handleMouseUp)
  }, [])

  const heights = getContentHeights()

  return (
    <aside
      ref={containerRef}
      className="flex h-full w-full flex-col border-l border-border bg-sidebar overflow-hidden"
    >
      {/* TASKS */}
      <div className="flex flex-col shrink-0 border-b border-border">
        <SectionHeader
          title="TASKS"
          icon={ListTodo}
          badge={todos.length}
          isOpen={tasksOpen}
          onToggle={toggleTasksOpen}
        />
        {tasksOpen && (
          <div className="overflow-auto" style={{ height: heights.tasks }}>
            <TasksContent />
          </div>
        )}
      </div>

      {/* Resize handle after TASKS */}
      {tasksOpen && (artifactsOpen || agentsOpen) && <ResizeHandle onDrag={handleTasksResize} />}

      {/* ARTIFACTS */}
      <div className="flex flex-col shrink-0 border-b border-border">
        <SectionHeader
          title="ARTIFACTS"
          icon={PackageOpen}
          badge={artifactCount}
          isOpen={artifactsOpen}
          onToggle={toggleArtifactsOpen}
        />
        {artifactsOpen && (
          <div className="overflow-auto" style={{ height: heights.artifacts }}>
            <ArtifactsContent />
          </div>
        )}
      </div>

      {/* Resize handle after ARTIFACTS */}
      {artifactsOpen && agentsOpen && <ResizeHandle onDrag={handleArtifactsResize} />}

      {/* AGENTS */}
      <div className="flex flex-col shrink-0">
        <SectionHeader
          title="AGENTS"
          icon={GitBranch}
          badge={subagents.length}
          isOpen={agentsOpen}
          onToggle={toggleAgentsOpen}
        />
        {agentsOpen && (
          <div className="overflow-auto" style={{ height: heights.agents }}>
            <AgentsContent />
          </div>
        )}
      </div>
    </aside>
  )
}

// ============ Content Components ============

const STATUS_CONFIG = {
  pending: {
    icon: Circle,
    badge: "outline" as const,
    label: "PENDING",
    color: "text-muted-foreground"
  },
  in_progress: {
    icon: Clock,
    badge: "info" as const,
    label: "IN PROGRESS",
    color: "text-status-info"
  },
  completed: {
    icon: CheckCircle2,
    badge: "nominal" as const,
    label: "DONE",
    color: "text-status-nominal"
  },
  cancelled: {
    icon: XCircle,
    badge: "critical" as const,
    label: "CANCELLED",
    color: "text-muted-foreground"
  }
}

function TasksContent(): React.JSX.Element {
  const { currentThreadId } = useHistoryShellStore()
  const threadState = useThreadState(currentThreadId)
  const todos = threadState?.todos ?? []
  const [completedExpanded, setCompletedExpanded] = useState(false)

  if (todos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-8 px-4">
        <ListTodo className="size-8 mb-2 opacity-50" />
        <span>No tasks yet</span>
        <span className="text-xs mt-1">Tasks appear when the agent creates them</span>
      </div>
    )
  }

  const inProgress = todos.filter((t) => t.status === "in_progress")
  const pending = todos.filter((t) => t.status === "pending")
  const completed = todos.filter((t) => t.status === "completed")
  const cancelled = todos.filter((t) => t.status === "cancelled")

  // Completed section includes both completed and cancelled
  const doneItems = [...completed, ...cancelled]

  const done = completed.length
  const total = todos.length
  const progress = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div>
      {/* Progress bar */}
      <div className="p-3 border-b border-border/50">
        <div className="flex items-center justify-between mb-1.5 text-xs">
          <span className="text-muted-foreground">PROGRESS</span>
          <span className="font-mono">
            {done}/{total}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-background overflow-hidden">
          <div
            className="h-full bg-status-nominal transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Todo list */}
      <div className="p-3 space-y-2">
        {/* Completed/Cancelled Section (Collapsible) */}
        {doneItems.length > 0 && (
          <div className="mb-1">
            <button
              onClick={() => setCompletedExpanded(!completedExpanded)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2 w-full"
            >
              {completedExpanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              <span className="uppercase tracking-wider font-medium">
                Completed ({doneItems.length})
              </span>
            </button>
            {completedExpanded && (
              <div className="space-y-2 pl-5 mb-3">
                {doneItems.map((todo) => (
                  <TaskItem key={todo.id} todo={todo} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* In Progress Section */}
        {inProgress.map((todo) => (
          <TaskItem key={todo.id} todo={todo} />
        ))}

        {/* Pending Section */}
        {pending.map((todo) => (
          <TaskItem key={todo.id} todo={todo} />
        ))}
      </div>
    </div>
  )
}

function TaskItem({ todo }: { todo: Todo }): React.JSX.Element {
  const config = STATUS_CONFIG[todo.status]
  const Icon = config.icon
  const isDone = todo.status === "completed" || todo.status === "cancelled"

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-sm border border-border p-3",
        isDone && "opacity-50"
      )}
    >
      <Icon className={cn("size-4 shrink-0 mt-0.5", config.color)} />
      <span className={cn("flex-1 text-sm", isDone && "line-through")}>{todo.content}</span>
      <Badge variant={config.badge} className="shrink-0 text-[10px]">
        {config.label}
      </Badge>
    </div>
  )
}

function ArtifactsContent(): React.JSX.Element {
  const { currentThreadId } = useHistoryShellStore()
  const threadState = useThreadState(currentThreadId)
  const artifacts = threadState?.artifacts ?? EMPTY_ARTIFACTS
  const [manuallySelectedArtifactId, setManuallySelectedArtifactId] = useState<string | null>(null)
  const activeArtifactId =
    manuallySelectedArtifactId &&
    artifacts.some((artifact) => artifact.id === manuallySelectedArtifactId)
      ? manuallySelectedArtifactId
      : (artifacts[0]?.id ?? null)

  const handleArtifactAction = useCallback(
    async (artifact: ArtifactRecord, action?: ArtifactActionId) => {
      const resolution = await window.api.artifacts.open(artifact.id, action)

      switch (resolution.type) {
        case "detail":
          setManuallySelectedArtifactId(artifact.id)
          return
        case "copy-link":
          await navigator.clipboard.writeText(resolution.value)
          return
        case "download":
        case "external-browser":
        case "reveal-source":
        case "system-default":
          return
      }
    },
    []
  )

  const handleArtifactPreview = useCallback(
    (artifact: ArtifactRecord) => {
      threadState?.openArtifactTab({
        artifactId: artifact.id,
        kind: artifact.kind,
        title: artifact.title
      })
    },
    [threadState]
  )

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-border/50 bg-background/30">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Thread outputs
          </div>
        </div>

        <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-8 px-4 flex-1 gap-3">
          <PackageOpen className="size-8 opacity-50" />
          <div className="space-y-1">
            <div>No artifacts yet</div>
            <div className="text-xs">Presented outputs will appear here</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 py-2 border-b border-border/50 bg-background/30">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Thread outputs
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="space-y-2">
          {artifacts.map((artifact) => (
            <ArtifactCard
              artifact={artifact}
              isSelected={artifact.id === activeArtifactId}
              key={artifact.id}
              onAction={handleArtifactAction}
              onSelect={() => {
                setManuallySelectedArtifactId(artifact.id)
                handleArtifactPreview(artifact)
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function ArtifactCard(props: {
  artifact: ArtifactRecord
  isSelected: boolean
  onAction: (artifact: ArtifactRecord, action?: ArtifactActionId) => Promise<void>
  onSelect: () => void
}): React.JSX.Element {
  const { artifact, isSelected, onAction, onSelect } = props
  const descriptor = getArtifactDescriptor(artifact)
  const primaryActionLabel = getArtifactPrimaryActionLabel(artifact)
  const canRevealSource = supportsArtifactAction(artifact, "reveal-source")
  const canCopyLink = supportsArtifactAction(artifact, "copy-link")

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-background/35 transition-colors",
        isSelected ? "border-primary/45 bg-primary/5" : "border-border hover:border-border-emphasis"
      )}
    >
      <div className="flex items-stretch">
        <button
          aria-expanded={isSelected}
          className="min-h-[72px] min-w-0 flex-1 px-3 py-3 text-left"
          onClick={onSelect}
          type="button"
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
              <descriptor.icon className="size-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <div className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-5 text-foreground">
                  {artifact.title}
                </div>
                <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {descriptor.label}
                </span>
              </div>
              <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                {descriptor.location}
              </div>
              {descriptor.preview && (
                <div className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {descriptor.preview}
                </div>
              )}
            </div>
          </div>
        </button>

        <div className="flex shrink-0 flex-col items-end justify-between py-2 pr-2">
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-200",
              !isSelected && "-rotate-90"
            )}
          />
          {primaryActionLabel && (
            <button
              className="min-h-8 rounded-sm border border-border bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-background-interactive"
              onClick={() => void onAction(artifact)}
              type="button"
            >
              {primaryActionLabel}
            </button>
          )}
        </div>
      </div>

      {isSelected && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          {(canRevealSource || canCopyLink) && (
            <div className="flex flex-wrap gap-2">
              {canRevealSource && (
                <button
                  className="min-h-8 rounded-sm border border-border px-2.5 text-xs text-foreground transition-colors hover:bg-background-interactive"
                  onClick={() => void onAction(artifact, "reveal-source")}
                  type="button"
                >
                  Reveal
                </button>
              )}
              {canCopyLink && (
                <button
                  className="min-h-8 rounded-sm border border-border px-2.5 text-xs text-foreground transition-colors hover:bg-background-interactive"
                  onClick={() => void onAction(artifact, "copy-link")}
                  type="button"
                >
                  Copy link
                </button>
              )}
            </div>
          )}

          <div>{getArtifactDetailBody(artifact)}</div>
        </div>
      )}
    </div>
  )
}

function getArtifactPrimaryActionLabel(artifact: ArtifactRecord): string | null {
  switch (getArtifactCapabilities(artifact).primaryAction) {
    case "open":
      return "Open"
    case "preview":
    case "download":
    case "reveal-source":
    case "copy-link":
    case null:
      return null
  }
}

function getArtifactUriLabel(uri: string): string {
  try {
    return new URL(uri).hostname
  } catch {
    return uri.split(/[\\/]/).filter(Boolean).at(-1) ?? uri
  }
}

function formatArtifactSize(sizeBytes: number | null): string | null {
  if (sizeBytes === null) {
    return null
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 102.4) / 10} KB`
  }

  return `${Math.round(sizeBytes / 1024 / 102.4) / 10} MB`
}

function getArtifactDescriptor(artifact: ArtifactRecord): {
  icon: typeof FileText
  label: string
  location: string
  preview: string | null
} {
  switch (artifact.kind) {
    case "summary":
      return {
        icon: FileText,
        label: "Summary",
        location: "Inline result",
        preview: artifact.previewText ?? artifact.payload!.text
      }
    case "link":
      return {
        icon: Link2,
        label: "Link",
        location: getArtifactUriLabel(artifact.source.uri),
        preview: artifact.previewText ?? artifact.source.uri
      }
    case "patch":
      return {
        icon: FileCode2,
        label: "Patch",
        location:
          artifact.source.type === "inline-text"
            ? "Inline diff"
            : getArtifactUriLabel(artifact.source.uri),
        preview:
          artifact.source.type === "inline-text"
            ? (artifact.previewText ?? artifact.payload!.text)
            : artifact.previewText
      }
    case "file":
      return {
        icon: PackageOpen,
        label: "File",
        location: getArtifactUriLabel(artifact.source.uri),
        preview: artifact.previewText
      }
  }
}

function getArtifactDetailBody(artifact: ArtifactRecord): React.JSX.Element {
  switch (artifact.kind) {
    case "summary":
      return (
        <div className="whitespace-pre-wrap break-words rounded-sm border border-border bg-background p-3 text-sm leading-6 text-foreground">
          {artifact.payload!.text}
        </div>
      )
    case "patch":
      if (artifact.source.type === "inline-text") {
        return (
          <CodeBlock
            className="max-h-72 overflow-auto"
            code={artifact.payload!.text}
            filename={artifact.title}
            language="diff"
          />
        )
      }
      return (
        <ArtifactMetaList
          entries={[
            ["File", getArtifactUriLabel(artifact.source.uri)],
            ["Path", artifact.source.uri],
            ["Mime", artifact.mimeType],
            ["Size", formatArtifactSize(artifact.sizeBytes)]
          ]}
        />
      )
    case "file":
      return (
        <ArtifactMetaList
          entries={[
            ["File", getArtifactUriLabel(artifact.source.uri)],
            ["Path", artifact.source.uri],
            ["Mime", artifact.mimeType],
            ["Size", formatArtifactSize(artifact.sizeBytes)],
            ["Preview", artifact.previewText]
          ]}
        />
      )
    case "link":
      return (
        <div className="space-y-2 rounded-sm border border-border bg-background p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
            <ExternalLink className="size-3.5" />
            External link
          </div>
          <div className="break-all text-sm leading-5 text-foreground">{artifact.source.uri}</div>
        </div>
      )
  }
}

function ArtifactMetaList(props: { entries: Array<[string, string | null]> }): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-sm border border-border bg-background p-3">
      {props.entries
        .filter(([, value]) => Boolean(value))
        .map(([label, value]) => (
          <div key={label} className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {label}
            </div>
            <div className="break-all text-sm leading-5 text-foreground">{value}</div>
          </div>
        ))}
    </div>
  )
}

function AgentsContent(): React.JSX.Element {
  const { currentThreadId } = useHistoryShellStore()
  const threadState = useThreadState(currentThreadId)
  const subagents = threadState?.subagents ?? []

  if (subagents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-8 px-4">
        <GitBranch className="size-8 mb-2 opacity-50" />
        <span>No subagent tasks</span>
        <span className="text-xs mt-1">Subagents appear when spawned</span>
      </div>
    )
  }

  return (
    <div className="p-3 space-y-2">
      {subagents.map((agent) => (
        <div key={agent.id} className="p-3 rounded-sm border border-border">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranch className="size-3.5 text-status-info" />
            <span className="flex-1">{agent.name}</span>
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded",
                agent.status === "pending" && "bg-muted text-muted-foreground",
                agent.status === "running" && "bg-status-info/20 text-status-info",
                agent.status === "completed" && "bg-status-nominal/20 text-status-nominal",
                agent.status === "failed" && "bg-status-critical/20 text-status-critical"
              )}
            >
              {agent.status.toUpperCase()}
            </span>
          </div>
          {agent.description && (
            <p className="text-xs text-muted-foreground mt-1">{agent.description}</p>
          )}
        </div>
      ))}
    </div>
  )
}
