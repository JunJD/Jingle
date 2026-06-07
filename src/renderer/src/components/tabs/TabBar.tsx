import { Bot, X, File, FileCode, FileText, Link2, PackageOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { WorkspaceFileIcon } from "@/components/workspace-file-icon"
import type { ArtifactRecord } from "@shared/artifacts"
import {
  getArtifactTabId,
  getFileTabId,
  useThreadActions,
  useThreadSelector,
  type OpenArtifactTab,
  type OpenFile
} from "@/lib/thread-context"

interface TabBarProps {
  className?: string
  threadId?: string
}

const EMPTY_OPEN_FILES: readonly OpenFile[] = []
const EMPTY_OPEN_ARTIFACTS: readonly OpenArtifactTab[] = []
const EMPTY_ARTIFACTS: readonly ArtifactRecord[] = []

export function TabBar({
  className,
  threadId: propThreadId
}: TabBarProps): React.JSX.Element | null {
  const currentThreadId = useHistoryShellStore((state) => state.currentThreadId)
  const threadId = propThreadId ?? currentThreadId
  const threadActions = useThreadActions(threadId)
  const activeTab = useThreadSelector(threadId, (state) => state?.ui.activeTab ?? "agent")
  const openFiles = useThreadSelector(threadId, (state) => state?.ui.openFiles ?? EMPTY_OPEN_FILES)
  const openArtifacts = useThreadSelector(
    threadId,
    (state) => state?.ui.openArtifacts ?? EMPTY_OPEN_ARTIFACTS
  )
  const artifacts = useThreadSelector(
    threadId,
    (state) => state?.agent.artifacts ?? EMPTY_ARTIFACTS
  )

  if (!threadActions) {
    return null
  }

  const { closeArtifactTab, closeFile, setActiveTab } = threadActions

  return (
    <div className={cn("flex h-full items-center overflow-x-auto scrollbar-hide px-4", className)}>
      <button
        data-thread-tab="agent"
        data-thread-tab-active={activeTab === "agent" ? "true" : "false"}
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
          isActive={activeTab === getFileTabId(file.path)}
          onSelect={() => setActiveTab(getFileTabId(file.path))}
          onClose={() => closeFile(file.path)}
        />
      ))}

      {openArtifacts.map((openArtifact) => (
        <ArtifactTab
          artifact={artifacts.find((artifact) => artifact.id === openArtifact.artifactId) ?? null}
          artifactId={openArtifact.artifactId}
          isActive={activeTab === getArtifactTabId(openArtifact.artifactId)}
          key={openArtifact.artifactId}
          onClose={() => closeArtifactTab(openArtifact.artifactId)}
          onSelect={() => setActiveTab(getArtifactTabId(openArtifact.artifactId))}
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
      data-thread-tab="file"
      data-thread-tab-active={isActive ? "true" : "false"}
      data-thread-tab-id={file.path}
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
      <WorkspaceFileIcon className="size-3.5" name={file.name} />
      <span className="truncate">{file.name}</span>
      <button
        data-thread-tab-close="file"
        data-thread-tab-id={file.path}
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
  artifact: ArtifactRecord | null
  artifactId: string
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}

function ArtifactTab(props: ArtifactTabProps): React.JSX.Element {
  const { artifact, artifactId, isActive, onClose, onSelect } = props
  const title = artifact?.title ?? artifactId

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
      data-thread-tab="artifact"
      data-thread-tab-active={isActive ? "true" : "false"}
      data-thread-tab-id={artifactId}
      data-thread-tab-title={title}
      onClick={onSelect}
      onMouseDown={handleMouseDown}
      className={cn(
        "group relative flex h-full max-w-[220px] shrink-0 items-center gap-2 px-3 text-sm transition-colors",
        isActive
          ? "text-foreground after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:rounded-full after:bg-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
      title={title}
    >
      <ArtifactIcon kind={artifact?.kind ?? null} />
      <span className="truncate">{title}</span>
      <button
        data-thread-tab-close="artifact"
        data-thread-tab-id={artifactId}
        data-thread-tab-title={title}
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

function ArtifactIcon(props: { kind: ArtifactRecord["kind"] | null }): React.JSX.Element {
  switch (props.kind) {
    case "file":
      return <PackageOpen className="size-3.5 shrink-0 text-blue-400" />
    case "patch":
      return <FileCode className="size-3.5 shrink-0 text-orange-400" />
    case "summary":
      return <FileText className="size-3.5 shrink-0 text-muted-foreground" />
    case "link":
      return <Link2 className="size-3.5 shrink-0 text-emerald-400" />
    default:
      return <File className="size-3.5 shrink-0 text-muted-foreground" />
  }
}
