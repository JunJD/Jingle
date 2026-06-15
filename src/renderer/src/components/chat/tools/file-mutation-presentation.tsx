import type { AppCopy } from "@/lib/i18n/messages"
import { getFileMutationReview, type FileMutationToolName } from "@shared/file-mutation-review"
import { countLines } from "./shared"
import { PierreFileMutationView } from "./PierreFileMutationView"
import type { FileMutationProjection } from "./file-mutation-view-model"
import { formatFileMutationLineStats, getFileMutationBasename } from "./file-mutation-display"
import { ToolCodeBlock, ToolDetailSection, ToolDetailStack } from "./shared-components"
import type { ToolComponentProps, ToolDisplay } from "./types"

function getSingleFileProjection(fileMutation: FileMutationProjection | null | undefined) {
  if (fileMutation?.kind !== "view" || fileMutation.viewModel.files.length !== 1) {
    return null
  }

  return fileMutation.viewModel.files[0]
}

function getSummaryPath(props: {
  reviewPath: string | null
  singleFile: ReturnType<typeof getSingleFileProjection>
}): string | null {
  if (props.singleFile) {
    return props.singleFile.path
  }

  return props.reviewPath
}

function getResultMeta(props: {
  content: string | null
  copy: AppCopy
  mode: FileMutationToolName
  mutationStats: string | null
  target: string | null
}): string | null {
  if (props.mutationStats) {
    return props.mutationStats
  }

  if (props.mode === "write_file" && props.content !== null && props.target) {
    return props.copy.toolCall.writeLinesToFile(countLines(props.content), props.target)
  }

  return null
}

function getRawResultToRender(
  fileMutation: FileMutationProjection | null,
  rawResult: string
): string {
  if (fileMutation?.kind === "raw_result") {
    return fileMutation.rawResult
  }

  if (fileMutation?.kind === "view") {
    return ""
  }

  return rawResult
}

export function buildFileMutationSummary(
  props: ToolComponentProps,
  mode: FileMutationToolName
): ToolDisplay {
  const { copy, args, fileMutation } = props
  const review = getFileMutationReview(mode, args)
  const singleFile = getSingleFileProjection(fileMutation)
  const path = getSummaryPath({
    reviewPath: review ? review.path : null,
    singleFile
  })
  const content = review ? review.content : null
  const target = path ? getFileMutationBasename(path) : null
  const mutationStats = singleFile ? formatFileMutationLineStats(singleFile) : null

  return {
    detail: target,
    resultMeta: getResultMeta({
      content,
      copy,
      mode,
      mutationStats,
      target
    }),
    title: copy.toolCall.labels[mode]
  }
}

export function renderFileMutationDetail(
  copy: AppCopy,
  options?: {
    fileMutation?: FileMutationProjection | null
    rawArgs?: string
    rawResult?: string
  }
): React.JSX.Element | null {
  const fileMutation = options?.fileMutation ?? null
  const rawArgs = options?.rawArgs ?? ""
  const rawResult = getRawResultToRender(fileMutation, options?.rawResult ?? "")

  if (!fileMutation && !rawArgs && !rawResult) {
    return null
  }

  return (
    <ToolDetailStack>
      {fileMutation?.kind === "view" ? (
        <PierreFileMutationView viewModel={fileMutation.viewModel} />
      ) : null}
      {fileMutation?.kind === "partial_args" || rawArgs ? (
        <ToolDetailSection label={copy.common.rawArguments}>
          <ToolCodeBlock>
            {fileMutation?.kind === "partial_args" ? fileMutation.rawArgs : rawArgs}
          </ToolCodeBlock>
        </ToolDetailSection>
      ) : null}
      {rawResult ? (
        <ToolDetailSection label={copy.common.rawResult}>
          <ToolCodeBlock>{rawResult}</ToolCodeBlock>
        </ToolDetailSection>
      ) : null}
    </ToolDetailStack>
  )
}
