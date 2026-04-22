import type { AppCopy } from "@/lib/i18n/messages"
import {
  getFileMutationReview,
  type FileMutationToolName
} from "@shared/file-mutation-review"
import type { FileMutationToolApprovalItem } from "@shared/tool-approval"
import { countLines, getBasename, joinSummaryParts } from "./shared"
import {
  ToolCodeBlock,
  ToolCollapsibleSection,
  ToolDetailSection,
  ToolDetailStack,
  ToolPreviewLines
} from "./shared-components"
import { renderToolApprovalOverview } from "./tool-approval-presentation"
import type { ToolComponentProps } from "./types"

export function buildFileMutationSummary(
  props: ToolComponentProps,
  mode: FileMutationToolName
): string {
  const { copy, args } = props
  const review = getFileMutationReview(mode, args)
  const path = review?.path
  const content = review ? review.content : null
  const target = path ? getBasename(path) : copy.toolCall.labels[mode]

  return joinSummaryParts(
    copy.toolCall.labels[mode],
    target,
    mode === "write_file" && content !== null
      ? copy.toolCall.writeLinesToFile(countLines(content), target)
      : null
  )
}

export function renderFileMutationDetail(
  copy: AppCopy,
  args: Record<string, unknown>,
  mode: FileMutationToolName,
  options?: {
    rawResult?: string
  }
): React.JSX.Element | null {
  const review = getFileMutationReview(mode, args)
  const rawResult = options?.rawResult ?? ""

  if (!review && !rawResult) {
    return null
  }

  return (
    <ToolDetailStack>
      {renderToolApprovalOverview(
        copy,
        review?.path
          ? {
              kind: "file_mutation",
              toolName: review.toolName,
              path: review.path,
              content: review.content,
              oldText: review.oldText,
              newText: review.newText,
              changes: [
                {
                  changeType: "modify",
                  path: review.path
                }
              ]
            }
          : null
      )}
      {review && (review.oldText !== null || review.newText !== null || review.content !== null) ? (
        <ToolCollapsibleSection
          label={copy.toolCall.fileReviewDetails}
          summary={joinSummaryParts(
            review.oldText !== null ? copy.toolCall.fileReviewOriginal : null,
            review.newText !== null ? copy.toolCall.fileReviewUpdated : null,
            review.content !== null ? copy.toolCall.fileReviewContent : null
          )}
        >
          <ToolDetailStack className="gap-3">
            {review.oldText !== null ? (
              <ToolDetailSection label={copy.toolCall.fileReviewOriginal}>
                <ToolPreviewLines text={review.oldText} maxLines={10} />
              </ToolDetailSection>
            ) : null}
            {review.newText !== null ? (
              <ToolDetailSection label={copy.toolCall.fileReviewUpdated}>
                <ToolPreviewLines text={review.newText} maxLines={10} />
              </ToolDetailSection>
            ) : null}
            {review.content !== null ? (
              <ToolDetailSection label={copy.toolCall.fileReviewContent}>
                <ToolPreviewLines text={review.content} maxLines={10} />
              </ToolDetailSection>
            ) : null}
          </ToolDetailStack>
        </ToolCollapsibleSection>
      ) : null}
      {rawResult ? (
        <ToolDetailSection label={copy.common.rawResult}>
          <ToolCodeBlock>{rawResult}</ToolCodeBlock>
        </ToolDetailSection>
      ) : null}
    </ToolDetailStack>
  )
}

export function renderFileMutationApprovalDetail(
  copy: AppCopy,
  review: FileMutationToolApprovalItem,
  options?: {
    rawArgs?: string
  }
): React.JSX.Element | null {
  const rawArgs = options?.rawArgs ?? ""

  return (
    <ToolDetailStack>
      {renderToolApprovalOverview(copy, review, { rawArgs })}
      {review.oldText !== null || review.newText !== null || review.content !== null ? (
        <ToolCollapsibleSection
          label={copy.toolCall.fileReviewDetails}
          summary={joinSummaryParts(
            review.oldText !== null ? copy.toolCall.fileReviewOriginal : null,
            review.newText !== null ? copy.toolCall.fileReviewUpdated : null,
            review.content !== null ? copy.toolCall.fileReviewContent : null
          )}
        >
          <ToolDetailStack className="gap-3">
            {review.oldText !== null ? (
              <ToolDetailSection label={copy.toolCall.fileReviewOriginal}>
                <ToolPreviewLines text={review.oldText} maxLines={10} />
              </ToolDetailSection>
            ) : null}
            {review.newText !== null ? (
              <ToolDetailSection label={copy.toolCall.fileReviewUpdated}>
                <ToolPreviewLines text={review.newText} maxLines={10} />
              </ToolDetailSection>
            ) : null}
            {review.content !== null ? (
              <ToolDetailSection label={copy.toolCall.fileReviewContent}>
                <ToolPreviewLines text={review.content} maxLines={10} />
              </ToolDetailSection>
            ) : null}
          </ToolDetailStack>
        </ToolCollapsibleSection>
      ) : null}
    </ToolDetailStack>
  )
}
