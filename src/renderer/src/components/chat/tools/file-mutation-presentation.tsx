import type { AppCopy } from "@/lib/i18n/messages"
import { getFileMutationReview, type FileMutationToolName } from "@shared/file-mutation-review"
import { AnimatePresence } from "motion/react"
import { span as MotionSpan } from "motion/react-m"
import type { ReactNode } from "react"
import { countLines } from "./shared"
import { PierreFileMutationView } from "./PierreFileMutationView"
import type { FileMutationProjection } from "./file-mutation-view-model"
import {
  formatFileMutationLineStatsValue,
  getFileMutationBasename,
  getFileMutationLineStats,
  type FileMutationLineStats
} from "./file-mutation-display"
import { ToolDetailStack } from "./shared-components"
import type { ToolComponentProps, ToolDisplay } from "./types"

function getSingleFileProjection(fileMutation: FileMutationProjection | null | undefined) {
  if (fileMutation?.kind !== "view" || fileMutation.viewModel.files.length !== 1) {
    return null
  }

  return fileMutation.viewModel.files[0]
}

function getPendingFileMutationPath(
  fileMutation: FileMutationProjection | null | undefined
): string | null {
  return fileMutation?.kind === "pending_args" ? fileMutation.path : null
}

function getSummaryPath(props: {
  pendingPath: string | null
  reviewPath: string | null
  singleFile: ReturnType<typeof getSingleFileProjection>
}): string | null {
  if (props.singleFile) {
    return props.singleFile.path
  }

  if (props.pendingPath) {
    return props.pendingPath
  }

  return props.reviewPath
}

function getResultMeta(props: {
  content: string | null
  copy: AppCopy
  mode: FileMutationToolName
  mutationLineStats: FileMutationLineStats | null
  target: string | null
}): ReactNode | null {
  const mutationStats =
    props.mutationLineStats === null ? null : formatFileMutationLineStatsValue(props.mutationLineStats)

  if (props.mutationLineStats && mutationStats) {
    return <FileMutationLineStatsMeta stats={props.mutationLineStats} />
  }

  if (props.mode === "write_file" && props.content !== null && props.target) {
    return props.copy.toolCall.writeLinesToFile(countLines(props.content), props.target)
  }

  return null
}

function FileMutationStatValue(props: {
  className: string
  label: string
  value: number
}): React.JSX.Element | null {
  const { className, label, value } = props
  if (value <= 0) {
    return null
  }

  return (
    <span className="inline-flex min-w-[2ch] justify-start overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <MotionSpan
          key={`${label}:${value}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className={className}
        >
          {label}
          {value}
        </MotionSpan>
      </AnimatePresence>
    </span>
  )
}

function FileMutationLineStatsMeta(props: {
  stats: FileMutationLineStats
}): React.JSX.Element | null {
  const { stats } = props
  if (stats.additions <= 0 && stats.deletions <= 0) {
    return null
  }

  return (
    <span
      aria-label={formatFileMutationLineStatsValue(stats) ?? undefined}
      className="inline-flex shrink-0 items-center gap-[var(--jingle-gap-xs)] font-medium tabular-nums"
    >
      <FileMutationStatValue
        className="text-status-nominal"
        label="+"
        value={stats.additions}
      />
      <FileMutationStatValue className="text-destructive" label="-" value={stats.deletions} />
    </span>
  )
}

export function buildFileMutationSummary(
  props: ToolComponentProps,
  mode: FileMutationToolName
): ToolDisplay {
  const { copy, args, fileMutation } = props
  const review = getFileMutationReview(mode, args)
  const singleFile = getSingleFileProjection(fileMutation)
  const pendingPath = getPendingFileMutationPath(fileMutation)
  const path = getSummaryPath({
    pendingPath,
    reviewPath: review ? review.path : null,
    singleFile
  })
  const content = singleFile ? review?.content ?? null : null
  const target = path ? getFileMutationBasename(path) : null
  const mutationLineStats = singleFile ? getFileMutationLineStats(singleFile) : null

  return {
    detail: target,
    resultMeta: getResultMeta({
      content,
      copy,
      mode,
      mutationLineStats,
      target
    }),
    title: copy.toolCall.labels[mode]
  }
}

export function renderFileMutationDetail(
  fileMutation?: FileMutationProjection | null
): React.JSX.Element | null {
  if (fileMutation?.kind !== "view") {
    return null
  }

  return (
    <ToolDetailStack>
      <PierreFileMutationView viewModel={fileMutation.viewModel} />
    </ToolDetailStack>
  )
}
