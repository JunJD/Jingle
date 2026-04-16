import { Bot, X, FileCode, FileText, FileJson, File, Link2, PackageOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import {
  getArtifactTabId,
  useThreadState,
  type OpenArtifactTab,
  type OpenFile
} from "@/lib/thread-context"

interface TabBarProps {
  className?: string
  threadId?: string
}

export function TabBar({
  className,
  threadId: propThreadId
}: TabBarProps): React.JSX.Element | null {
  const { currentThreadId } = useHistoryShellStore()
  const threadId = propThreadId ?? currentThreadId
  const threadState = useThreadState(threadId)

  if (!threadState) {
    return null
  }

  const { openFiles, openArtifacts, activeTab, setActiveTab, closeFile, closeArtifactTab } =
    threadState

  return (
    <div className={cn("flex h-full items-center overflow-x-auto scrollbar-hide px-4", className)}>
      <button
        onClick={() => setActiveTab("agent")}
        className={cn(
          "relative flex h-full shrink-0 items-center gap-2 px-4 text-sm font-medium transition-colors",
          activeTab === "agent"
            ? "text-foreground after:absolute after:bottom-0 after:left-4 after:right-4 after:h-[2px] after:rounded-full after:bg-primary"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Bot
          className={cn("size-4", activeTab === "agent" ? "text-accent" : "text-muted-foreground")}
        />
        <span>Agent</span>
      </button>

      {openFiles.map((file) => (
        <FileTab
          key={file.path}
          file={file}
          isActive={activeTab === file.path}
          onSelect={() => setActiveTab(file.path)}
          onClose={() => closeFile(file.path)}
        />
      ))}

      {openArtifacts.map((artifact) => (
        <ArtifactTab
          artifact={artifact}
          isActive={activeTab === getArtifactTabId(artifact.artifactId)}
          key={artifact.artifactId}
          onClose={() => closeArtifactTab(artifact.artifactId)}
          onSelect={() => setActiveTab(getArtifactTabId(artifact.artifactId))}
        />
      ))}

      <div className="flex-1 min-w-0" />
    </div>
  )
}

interface FileTabProps {
  file: OpenFile
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}

function FileTab({ file, isActive, onSelect, onClose }: FileTabProps): React.JSX.Element {
  const handleClose = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onClose()
  }

  const handleMouseDown = (e: React.MouseEvent): void => {
    // Middle click to close
    if (e.button === 1) {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <button
      onClick={onSelect}
      onMouseDown={handleMouseDown}
      className={cn(
        "group relative flex h-full max-w-[220px] shrink-0 items-center gap-2 px-3 text-sm transition-colors",
        isActive
          ? "text-foreground after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:rounded-full after:bg-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
      title={file.path}
    >
      <FileIcon name={file.name} />
      <span className="truncate">{file.name}</span>
      <button
        onClick={handleClose}
        className={cn(
          "flex size-4 items-center justify-center rounded-full transition-colors hover:bg-background-secondary",
          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
      >
        <X className="size-3" />
      </button>
    </button>
  )
}

interface ArtifactTabProps {
  artifact: OpenArtifactTab
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}

function ArtifactTab(props: ArtifactTabProps): React.JSX.Element {
  const { artifact, isActive, onClose, onSelect } = props

  const handleClose = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onClose()
  }

  const handleMouseDown = (e: React.MouseEvent): void => {
    if (e.button === 1) {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <button
      onClick={onSelect}
      onMouseDown={handleMouseDown}
      className={cn(
        "group relative flex h-full max-w-[220px] shrink-0 items-center gap-2 px-3 text-sm transition-colors",
        isActive
          ? "text-foreground after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:rounded-full after:bg-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
      title={artifact.title}
    >
      <ArtifactIcon kind={artifact.kind} />
      <span className="truncate">{artifact.title}</span>
      <button
        onClick={handleClose}
        className={cn(
          "flex size-4 items-center justify-center rounded-full transition-colors hover:bg-background-secondary",
          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
      >
        <X className="size-3" />
      </button>
    </button>
  )
}

function FileIcon({ name }: { name: string }): React.JSX.Element {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : ""

  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "py":
    case "css":
    case "scss":
    case "html":
      return <FileCode className="size-3.5 text-blue-400 shrink-0" />
    case "json":
      return <FileJson className="size-3.5 text-yellow-500 shrink-0" />
    case "md":
    case "mdx":
    case "txt":
      return <FileText className="size-3.5 text-muted-foreground shrink-0" />
    default:
      return <File className="size-3.5 text-muted-foreground shrink-0" />
  }
}

function ArtifactIcon(props: { kind: OpenArtifactTab["kind"] }): React.JSX.Element {
  switch (props.kind) {
    case "file":
      return <PackageOpen className="size-3.5 shrink-0 text-blue-400" />
    case "patch":
      return <FileCode className="size-3.5 shrink-0 text-orange-400" />
    case "summary":
      return <FileText className="size-3.5 shrink-0 text-muted-foreground" />
    case "link":
      return <Link2 className="size-3.5 shrink-0 text-emerald-400" />
  }
}
