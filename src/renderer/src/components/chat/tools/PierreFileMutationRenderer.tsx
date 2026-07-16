import { useEffect, useMemo, useRef } from "react"
import {
  MultiFileDiff,
  PatchDiff,
  type FileDiffProps,
  type FileContents
} from "@pierre/diffs/react"
import { FileTree as PierreFileTree, useFileTree, useFileTreeSelection } from "@pierre/trees/react"
import type { FileTree as PierreFileTreeModel, GitStatusEntry } from "@pierre/trees"
import { useOpenTargetContext } from "@/lib/open-target-context"
import { cn } from "@/lib/utils"
import type { FileMutationFileViewModel, FileMutationViewModel } from "./file-mutation-view-model"
import {
  getCompactFileMutationPath,
  getFileMutationBasename,
  getFileMutationLineStats
} from "./file-mutation-display"
import { ContentCardFrame } from "../ContentCardFrame"
import { useContentAnnotations } from "../ContentAnnotationsContext"
import { createContentCardId } from "@shared/content-card"

interface PierreFileMutationRendererProps {
  className?: string
  compact?: boolean
  viewModel: FileMutationViewModel
}

type DiffOptions = NonNullable<FileDiffProps<undefined>["options"]>

const DIFF_OPTIONS: DiffOptions = {
  collapsedContextThreshold: 8,
  disableFileHeader: true,
  diffIndicators: "bars",
  diffStyle: "unified",
  hunkSeparators: "line-info-basic",
  lineDiffType: "word",
  overflow: "wrap",
  stickyHeader: true
}

const TREE_KEY_SEPARATOR = "\u001f"
const TREE_STATUS_SEPARATOR = "\u001e"
const CODE_PREVIEW_MAX_LINES = 80

function getGitStatus(file: FileMutationFileViewModel): GitStatusEntry["status"] | null {
  switch (file.changeType) {
    case "create":
      return "added"
    case "delete":
      return "deleted"
    case "modify":
      return "modified"
    case null:
      return null
  }
}

function getDirectoryPaths(path: string): string[] {
  const segments = path.split("/").filter(Boolean)
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"))
}

function encodePathStatus(file: FileMutationFileViewModel): string | null {
  const status = getGitStatus(file)
  return status ? `${file.path}${TREE_STATUS_SEPARATOR}${status}` : null
}

function decodePathStatus(value: string): GitStatusEntry {
  const separatorIndex = value.lastIndexOf(TREE_STATUS_SEPARATOR)
  const path = value.slice(0, separatorIndex)
  const status = value.slice(separatorIndex + TREE_STATUS_SEPARATOR.length)
  return {
    path,
    status: status as GitStatusEntry["status"]
  }
}

function buildFileContents(path: string, contents: string, key: string): FileContents {
  return {
    cacheKey: key,
    contents,
    name: getFileMutationBasename(path)
  }
}

function getSelectedFilePath(
  selectedPaths: readonly string[],
  paths: readonly string[]
): string | null {
  const selectedFilePath = selectedPaths.find((path) => paths.includes(path))
  if (selectedFilePath) {
    return selectedFilePath
  }

  if (paths.length === 1) {
    return paths[0]
  }

  return null
}

function getTextForDiffSide(value: string | null): string {
  if (value !== null) {
    return value
  }

  return ""
}

function getWorkspacePath(
  openTargetContext: ReturnType<typeof useOpenTargetContext>
): string | null {
  if (openTargetContext) {
    return openTargetContext.folderPath
  }

  return null
}

function PierreFileTreePanel(props: {
  compact: boolean
  model: PierreFileTreeModel
  pathCount: number
  treeKey: string
}): React.JSX.Element | null {
  const { compact, model, pathCount, treeKey } = props

  if (pathCount === 0) {
    return null
  }

  const rows = Math.min(12, Math.max(2, pathCount))

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-[var(--jingle-radius-md)] border border-border/70 bg-background-secondary/30",
        compact ? "max-h-[180px]" : "h-full min-h-[96px]"
      )}
      data-file-mutation-tree={treeKey}
    >
      <PierreFileTree
        className="block min-w-0"
        model={model}
        style={{
          height: compact ? Math.min(180, rows * 24 + 8) : "100%",
          minHeight: compact ? 56 : 96
        }}
      />
    </div>
  )
}

function FileContentsPreview(props: { contents: string; fileKey: string }): React.JSX.Element {
  const { contents, fileKey } = props
  const lines = contents.split("\n")
  const visibleLines = lines.slice(0, CODE_PREVIEW_MAX_LINES)
  const hiddenLineCount = Math.max(0, lines.length - visibleLines.length)

  return (
    <div className="max-h-[360px] min-w-0 overflow-auto bg-background text-foreground/86">
      <div className="grid min-w-0 font-mono leading-[var(--jingle-line-code)]">
        {visibleLines.map((line, index) => (
          <div
            className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] border-b border-border/35 last:border-b-0"
            key={`${fileKey}:${index}`}
          >
            <span className="select-none border-r border-border/45 px-[var(--jingle-space-2)] py-[var(--jingle-space-1)] text-right tabular-nums text-muted-foreground/70">
              {index + 1}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words px-[var(--jingle-space-3)] py-[var(--jingle-space-1)]">
              {line || " "}
            </span>
          </div>
        ))}
      </div>
      {hiddenLineCount > 0 ? (
        <div className="border-t border-border/45 px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] font-mono leading-[var(--jingle-line-code)] text-muted-foreground">
          +{hiddenLineCount}
        </div>
      ) : null}
    </div>
  )
}

function PierreFileBlock(props: { file: FileMutationFileViewModel }): React.JSX.Element | null {
  const { file } = props

  if (file.diffMode === "tree") {
    return null
  }

  if (file.patch) {
    return <PatchDiff className="min-w-0" patch={file.patch} options={DIFF_OPTIONS} />
  }

  if (file.diffMode === "code" && file.after !== null) {
    return <FileContentsPreview contents={file.after} fileKey={file.key} />
  }

  if (file.before !== null || file.after !== null) {
    return (
      <MultiFileDiff
        className="min-w-0"
        newFile={buildFileContents(file.path, getTextForDiffSide(file.after), `${file.key}:after`)}
        oldFile={buildFileContents(
          file.path,
          getTextForDiffSide(file.before),
          `${file.key}:before`
        )}
        options={DIFF_OPTIONS}
      />
    )
  }

  return null
}

function FileMutationDiffHeader(props: {
  file: FileMutationFileViewModel
  workspacePath?: string | null
}): React.JSX.Element {
  const { file, workspacePath } = props
  const openTargetContext = useOpenTargetContext()
  const displayPath = getCompactFileMutationPath(file.path, workspacePath)
  const stats = getFileMutationLineStats(file)
  const canOpenFile = Boolean(openTargetContext?.folderPath && openTargetContext.selectedTargetId)

  return (
    <div className="flex min-h-8 min-w-0 items-center gap-[var(--jingle-gap-sm)] border-b border-border/70 bg-background-secondary/38 px-[var(--jingle-space-3)] py-[var(--jingle-space-1)] [font-size:var(--jingle-font-meta)]">
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left font-medium text-muted-foreground transition hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
        disabled={!canOpenFile}
        title={file.path}
        onClick={() => {
          openTargetContext?.openFile(file.path)
        }}
      >
        {displayPath}
      </button>
      {stats.additions > 0 ? (
        <span className="shrink-0 font-medium text-status-nominal">+{stats.additions}</span>
      ) : null}
      {stats.deletions > 0 ? (
        <span className="shrink-0 font-medium text-destructive">-{stats.deletions}</span>
      ) : null}
    </div>
  )
}

export function PierreFileMutationRenderer(
  props: PierreFileMutationRendererProps
): React.JSX.Element | null {
  const { className, compact = false, viewModel } = props
  const annotations = useContentAnnotations()
  const openTargetContext = useOpenTargetContext()
  const workspacePath = getWorkspacePath(openTargetContext)
  const filesWithDiff = useMemo(
    () => viewModel.files.filter((file) => file.diffMode !== "tree"),
    [viewModel.files]
  )
  const pathsKey = useMemo(
    () => viewModel.files.map((file) => file.path).join(TREE_KEY_SEPARATOR),
    [viewModel.files]
  )
  const paths = useMemo(() => (pathsKey ? pathsKey.split(TREE_KEY_SEPARATOR) : []), [pathsKey])
  const treeKey = useMemo(() => `${viewModel.key}:${pathsKey}`, [pathsKey, viewModel.key])
  const gitStatusKey = useMemo(
    () =>
      viewModel.files
        .flatMap((file) => {
          const encoded = encodePathStatus(file)
          return encoded ? [encoded] : []
        })
        .join(TREE_KEY_SEPARATOR),
    [viewModel.files]
  )
  const gitStatus = useMemo<GitStatusEntry[]>(
    () => (gitStatusKey ? gitStatusKey.split(TREE_KEY_SEPARATOR).map(decodePathStatus) : []),
    [gitStatusKey]
  )
  const expandedPaths = useMemo(
    () => Array.from(new Set(paths.flatMap(getDirectoryPaths))),
    [paths]
  )
  const diffRefs = useRef(new Map<string, HTMLDivElement>())
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    gitStatus,
    icons: "minimal",
    initialExpandedPaths: expandedPaths,
    initialExpansion: "open",
    initialSelectedPaths: paths.slice(0, 1),
    itemHeight: 24,
    overscan: 8,
    paths
  })
  const selectedPaths = useFileTreeSelection(model)
  const selectedPath = getSelectedFilePath(selectedPaths, paths)
  const shouldRenderTree = paths.length > 1 || filesWithDiff.length === 0

  useEffect(() => {
    model.resetPaths(paths, { initialExpandedPaths: expandedPaths })
    model.setGitStatus(gitStatus)
    const currentSelection = model.getSelectedPaths().find((path) => paths.includes(path))
    if (!currentSelection && paths[0]) {
      model.getItem(paths[0])?.select()
    }
  }, [expandedPaths, gitStatus, model, paths])

  useEffect(() => {
    if (selectedPath) {
      model.scrollToPath(selectedPath, { focus: false, offset: "nearest" })
    }
  }, [model, selectedPath])

  useEffect(() => {
    const target = selectedPath ? diffRefs.current.get(selectedPath) : null
    target?.scrollIntoView({ block: "nearest" })
  }, [selectedPath])

  if (viewModel.files.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        "grid min-w-0 gap-[var(--jingle-space-2-5)]",
        !compact &&
          shouldRenderTree &&
          paths.length > 1 &&
          "md:grid-cols-[minmax(180px,0.32fr)_minmax(0,1fr)]",
        className
      )}
      data-file-mutation-source={viewModel.source}
      data-file-mutation-status={viewModel.status}
    >
      {shouldRenderTree ? (
        <PierreFileTreePanel
          compact={compact || paths.length <= 1}
          model={model}
          pathCount={paths.length}
          treeKey={treeKey}
        />
      ) : null}
      {filesWithDiff.length > 0 ? (
        <div className="grid min-w-0 gap-[var(--jingle-space-2-5)]">
          {filesWithDiff.map((file) => (
            <PierreDiffContentCard
              file={file}
              key={file.key}
              onRegisterNode={(node) => {
                if (node) {
                  diffRefs.current.set(file.path, node)
                  return
                }
                diffRefs.current.delete(file.path)
              }}
              threadId={annotations.threadId}
              toolKey={viewModel.key}
              workspacePath={workspacePath}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function hashDiffRevision(file: FileMutationFileViewModel): string {
  const value = `${file.before ?? ""}\u0000${file.after ?? ""}\u0000${file.patch ?? ""}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function PierreDiffContentCard({
  file,
  onRegisterNode,
  threadId,
  toolKey,
  workspacePath
}: {
  file: FileMutationFileViewModel
  onRegisterNode: (node: HTMLDivElement | null) => void
  threadId: string
  toolKey: string
  workspacePath: string | null
}): React.JSX.Element {
  const toolCallId = toolKey.slice(toolKey.indexOf(":") + 1)
  const source = {
    kind: "diff" as const,
    slot: `diff:${encodeURIComponent(file.path)}`,
    sourceId: toolCallId,
    sourceType: "tool-call" as const
  }
  const identity = {
    ...source,
    cardId: createContentCardId(source),
    revision: hashDiffRevision(file),
    threadId
  }
  return (
    <div ref={onRegisterNode}>
      <ContentCardFrame
        annotationEnabled={false}
        className="overflow-hidden"
        identity={identity}
        selection={{
          anchor: { kind: "whole-card" },
          anchorResolution: "resolved",
          card: identity,
          contextHash: identity.revision,
          quote: file.path
        }}
        title={file.path}
      >
        <div data-assistant-selection-source="true" data-file-mutation-path={file.path}>
          <FileMutationDiffHeader file={file} workspacePath={workspacePath} />
          <PierreFileBlock file={file} />
        </div>
      </ContentCardFrame>
    </div>
  )
}
