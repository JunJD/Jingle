import { lazy, Suspense } from "react"
import type React from "react"
import type { FileMutationFileViewModel, FileMutationViewModel } from "./file-mutation-view-model"
import {
  formatFileMutationLineStats,
  getCompactFileMutationPath
} from "./file-mutation-display"

interface PierreFileMutationViewProps {
  className?: string
  compact?: boolean
  viewModel: FileMutationViewModel
}

const PierreFileMutationRenderer = lazy(() =>
  import("./PierreFileMutationRenderer").then((module) => ({
    default: module.PierreFileMutationRenderer
  }))
)

function PierreFileMutationFallbackFile(props: {
  file: FileMutationFileViewModel
}): React.JSX.Element {
  const { file } = props
  const stats = formatFileMutationLineStats(file)

  return (
    <div className="flex min-w-0 items-center gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-radius-md)] border border-border/70 bg-background-secondary/35 px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] leading-[var(--jingle-line-body)]">
      <span className="min-w-0 flex-1 truncate font-medium text-muted-foreground" title={file.path}>
        {getCompactFileMutationPath(file.path, null)}
      </span>
      {stats ? <span className="shrink-0 font-medium tabular-nums text-foreground/70">{stats}</span> : null}
    </div>
  )
}

function PierreFileMutationFallback(props: {
  viewModel: FileMutationViewModel
}): React.JSX.Element | null {
  const { viewModel } = props
  if (viewModel.files.length === 0) {
    return null
  }

  return (
    <div className="grid min-w-0 gap-[var(--jingle-gap-xs)]">
      {viewModel.files.map((file) => (
        <PierreFileMutationFallbackFile file={file} key={file.key} />
      ))}
    </div>
  )
}

export function PierreFileMutationView(
  props: PierreFileMutationViewProps
): React.JSX.Element {
  return (
    <Suspense fallback={<PierreFileMutationFallback viewModel={props.viewModel} />}>
      <PierreFileMutationRenderer {...props} />
    </Suspense>
  )
}
