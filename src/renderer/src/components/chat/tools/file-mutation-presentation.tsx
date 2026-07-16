import type { AppCopy } from "@/lib/i18n/messages"
import type { FileMutationToolName } from "@shared/file-mutation-review"
import type { ReactNode } from "react"
import { InlineNotice } from "@/components/ui/inline-notice"
import { countLines } from "./shared"
import { PierreFileMutationView } from "./PierreFileMutationView"
import type { FileMutationProjection } from "./file-mutation-view-model"
import {
  formatFileMutationLineStatsValue,
  getFileMutationBasename,
  getFileMutationLineStats,
  type FileMutationLineStats
} from "./file-mutation-display"
import { ToolContractNotice, ToolDetailStack } from "./shared-components"
import type { ToolDisplay, ToolProjectionInput } from "./types"

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
  singleFile: ReturnType<typeof getSingleFileProjection>
}): string | null {
  if (props.singleFile) {
    return props.singleFile.path
  }

  if (props.pendingPath) {
    return props.pendingPath
  }

  return null
}

function getResultMeta(props: {
  contentLineCount: number | null
  copy: AppCopy
  mode: FileMutationToolName
  mutationLineStats: FileMutationLineStats | null
  target: string | null
}): ReactNode | null {
  const mutationStats =
    props.mutationLineStats === null
      ? null
      : formatFileMutationLineStatsValue(props.mutationLineStats)

  if (props.mutationLineStats && mutationStats) {
    return <FileMutationLineStatsMeta stats={props.mutationLineStats} />
  }

  if (props.mode === "write_file" && props.contentLineCount !== null && props.target) {
    return props.copy.toolCall.writeLinesToFile(props.contentLineCount, props.target)
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
    <span className={`inline-flex min-w-[2ch] justify-start overflow-hidden ${className}`}>
      {label}
      {value}
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
      <FileMutationStatValue className="text-status-nominal" label="+" value={stats.additions} />
      <FileMutationStatValue className="text-destructive" label="-" value={stats.deletions} />
    </span>
  )
}

export interface FileMutationToolViewModel {
  contentLineCount: number | null
  fileMutation: FileMutationProjection | null
  mutationLineStats: FileMutationLineStats | null
  target: string | null
}

export function projectFileMutationTool(
  input: ToolProjectionInput,
  mode: FileMutationToolName
): FileMutationToolViewModel {
  const singleFile = getSingleFileProjection(input.fileMutation)
  const pendingPath = getPendingFileMutationPath(input.fileMutation)
  const path = getSummaryPath({
    pendingPath,
    singleFile
  })
  const completedContent =
    mode === "write_file" &&
    input.fileMutation?.kind === "view" &&
    input.fileMutation.viewModel.source === "completed_result" &&
    typeof singleFile?.after === "string"
      ? singleFile.after
      : null
  const target = path ? getFileMutationBasename(path) : null
  const mutationLineStats = singleFile ? getFileMutationLineStats(singleFile) : null

  return {
    contentLineCount: completedContent === null ? null : countLines(completedContent),
    fileMutation: input.fileMutation,
    mutationLineStats,
    target
  }
}

export function buildFileMutationSummary(
  copy: AppCopy,
  viewModel: FileMutationToolViewModel,
  mode: FileMutationToolName
): ToolDisplay {
  return {
    detail:
      viewModel.fileMutation?.kind === "invalid"
        ? copy.chat.messageContentUnavailable
        : viewModel.target,
    resultMeta: getResultMeta({
      contentLineCount: viewModel.contentLineCount,
      copy,
      mode,
      mutationLineStats: viewModel.mutationLineStats,
      target: viewModel.target
    }),
    title: copy.toolCall.labels[mode]
  }
}

export function renderFileMutationDetail(
  copy: AppCopy,
  fileMutation?: FileMutationProjection | null
): React.JSX.Element | null {
  if (fileMutation?.kind === "invalid") {
    if (fileMutation.reason === "invalid_args") {
      return <ToolContractNotice copy={copy} field={fileMutation.field} />
    }

    return (
      <InlineNotice data-file-mutation-contract-error={fileMutation.reason} tone="warning">
        {copy.chat.messageContentUnavailable}
      </InlineNotice>
    )
  }

  if (fileMutation?.kind !== "view") {
    return null
  }

  return (
    <ToolDetailStack>
      <PierreFileMutationView viewModel={fileMutation.viewModel} />
    </ToolDetailStack>
  )
}
