import {
  getFileMutationReview,
  isFileMutationToolName,
  type FileMutationToolName
} from "@shared/file-mutation-review"
import type { FileMutationResultMetadata } from "@shared/file-mutation-result"
import type { FileMutationToolApprovalItem, ToolApprovalItem } from "@shared/tool-approval"
import type { MutationChangeType, MutationPredictionChange } from "@shared/mutation-prediction"
import { parseCompleteToolCallArgsObject } from "@shared/tool-call-args"
import { parse as parsePartialJson } from "partial-json"

export type FileMutationViewModelSource =
  | "streaming_preview"
  | "approval_preview"
  | "completed_result"

export type FileMutationDiffMode = "diff" | "code" | "tree"

export interface FileMutationFileViewModel {
  after: string | null
  before: string | null
  changeType: MutationChangeType | null
  diffMode: FileMutationDiffMode
  key: string
  patch: string | null
  path: string
}

export interface FileMutationViewModel {
  files: FileMutationFileViewModel[]
  key: string
  source: FileMutationViewModelSource
  status: "pending" | "completed"
  title: string | null
}

export type FileMutationProjection =
  | {
      kind: "view"
      viewModel: FileMutationViewModel
    }
  | {
      kind: "pending_args"
      path: string | null
      toolName: FileMutationToolName
    }
  | {
      kind: "partial_args"
      rawArgs: string
    }
  | {
      field: string
      kind: "invalid"
      reason: "invalid_args"
    }
  | {
      kind: "invalid"
      reason: "empty_metadata" | "metadata_mismatch" | "missing_metadata"
    }

interface StreamingFileMutationViewModelInput {
  argsText: string | undefined
  toolCallId: string
  toolName: string
}

interface ToolFileMutationViewModelInput {
  args: Record<string, unknown>
  fileMutationResult?: FileMutationResultMetadata | null
  status: string
  toolCallId: string
  toolName: string
}

interface ChangeListFileMutationViewModelInput {
  changes: MutationPredictionChange[]
  source: FileMutationViewModelSource
  status: FileMutationViewModel["status"]
  title?: string | null
  toolCallId: string
}

function stableFileKey(
  source: FileMutationViewModelSource,
  toolCallId: string,
  path: string
): string {
  return `${source}:${toolCallId}:${path}`
}

function changeTypeFromReview(
  review: Pick<FileMutationToolApprovalItem, "changes" | "path" | "toolName">
): MutationChangeType | null {
  const path = review.path
  const matchingChange = path ? review.changes.find((change) => change.path === path) : undefined
  if (matchingChange) {
    return matchingChange.changeType
  }

  const firstChange = review.changes[0]
  if (firstChange) {
    return firstChange.changeType
  }

  return review.toolName === "edit_file" ? "modify" : null
}

function createViewModel(input: {
  files: FileMutationFileViewModel[]
  source: FileMutationViewModelSource
  status: FileMutationViewModel["status"]
  title?: string | null
  toolCallId: string
}): FileMutationViewModel | null {
  if (input.files.length === 0) {
    return null
  }

  return {
    files: input.files,
    key: `${input.source}:${input.toolCallId}`,
    source: input.source,
    status: input.status,
    title: input.title === undefined ? null : input.title
  }
}

function parsePartialToolCallArgsObject(argsText: string): Record<string, unknown> | null {
  if (!argsText.trim()) {
    return null
  }

  let parsed: unknown
  try {
    parsed = parsePartialJson(argsText) as unknown
  } catch {
    return null
  }

  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null
}

function buildFileFromReview(input: {
  review: Pick<
    FileMutationToolApprovalItem,
    "changes" | "content" | "newText" | "oldText" | "path" | "toolName"
  >
  source: FileMutationViewModelSource
  toolCallId: string
}): FileMutationFileViewModel | null {
  const { review, source, toolCallId } = input
  if (!review.path?.trim()) {
    return null
  }

  if (review.toolName === "write_file" && review.content !== null) {
    return {
      after: review.content,
      before: null,
      changeType: changeTypeFromReview(review),
      diffMode: "code",
      key: stableFileKey(source, toolCallId, review.path),
      patch: null,
      path: review.path
    }
  }

  if (review.toolName === "edit_file" && (review.oldText !== null || review.newText !== null)) {
    return {
      after: review.newText,
      before: review.oldText,
      changeType: changeTypeFromReview(review),
      diffMode: "diff",
      key: stableFileKey(source, toolCallId, review.path),
      patch: null,
      path: review.path
    }
  }

  return null
}

function getInvalidFileMutationArgsField(
  toolName: FileMutationToolName,
  args: Record<string, unknown>
): string | null {
  const invalidFields: string[] = []
  if (typeof args.file_path !== "string" || args.file_path.trim().length === 0) {
    invalidFields.push("file_path")
  }

  if (toolName === "write_file") {
    if (typeof args.content !== "string") {
      invalidFields.push("content")
    }
  } else {
    if (typeof args.old_string !== "string") {
      invalidFields.push("old_string")
    }
    if (typeof args.new_string !== "string") {
      invalidFields.push("new_string")
    }
  }

  return invalidFields.length > 0 ? invalidFields.join("|") : null
}

export function buildRequiredFileMutationArgsProjection(input: {
  args: Record<string, unknown>
  toolName: string
}): FileMutationProjection | null {
  if (!isFileMutationToolName(input.toolName)) {
    return null
  }

  const invalidField = getInvalidFileMutationArgsField(input.toolName, input.args)
  if (invalidField) {
    return {
      field: invalidField,
      kind: "invalid",
      reason: "invalid_args"
    }
  }

  return {
    kind: "pending_args",
    path: input.args.file_path as string,
    toolName: input.toolName
  }
}

function buildFileFromToolArgs(input: {
  args: Record<string, unknown>
  source: FileMutationViewModelSource
  status: FileMutationViewModel["status"]
  toolCallId: string
  toolName: string
}): FileMutationViewModel | null {
  const review = getFileMutationReview(input.toolName, input.args)
  if (!review) {
    return null
  }

  const file = buildFileFromReview({
    review: {
      ...review,
      changes: []
    },
    source: input.source,
    toolCallId: input.toolCallId
  })

  return createViewModel({
    files: file ? [file] : [],
    source: input.source,
    status: input.status,
    toolCallId: input.toolCallId
  })
}

function buildStreamingFileMutationProjection(input: {
  args: Record<string, unknown>
  toolCallId: string
  toolName: string
}): FileMutationProjection | null {
  const viewModel = buildFileFromToolArgs({
    args: input.args,
    source: "streaming_preview",
    status: "pending",
    toolCallId: input.toolCallId,
    toolName: input.toolName
  })

  if (viewModel) {
    return { kind: "view", viewModel }
  }

  const review = getFileMutationReview(input.toolName, input.args)
  if (!review) {
    return null
  }

  return {
    kind: "pending_args",
    path: review.path,
    toolName: review.toolName
  }
}

export function buildStreamingFileMutationViewModel(
  input: StreamingFileMutationViewModelInput
): FileMutationProjection | null {
  if (!isFileMutationToolName(input.toolName)) {
    return null
  }

  const argsText = input.argsText === undefined ? "" : input.argsText
  const args = parseCompleteToolCallArgsObject(argsText) ?? parsePartialToolCallArgsObject(argsText)
  if (!args) {
    return argsText ? { kind: "partial_args", rawArgs: argsText } : null
  }

  return (
    buildStreamingFileMutationProjection({
      args,
      toolCallId: input.toolCallId,
      toolName: input.toolName
    }) ?? (argsText ? { kind: "partial_args", rawArgs: argsText } : null)
  )
}

export function buildApprovalFileMutationViewModel(
  approvalItem: ToolApprovalItem | null,
  toolCallId: string
): FileMutationViewModel | null {
  if (!approvalItem || approvalItem.kind !== "file_mutation") {
    return null
  }

  const file = buildFileFromReview({
    review: approvalItem,
    source: "approval_preview",
    toolCallId
  })

  return createViewModel({
    files: file ? [file] : [],
    source: "approval_preview",
    status: "pending",
    toolCallId
  })
}

type CompletedFileMutationMetadataProjection =
  | {
      files: FileMutationFileViewModel[]
      kind: "ready"
    }
  | Extract<FileMutationProjection, { kind: "invalid" }>

function projectCompletedFilesFromResultMetadata(
  metadata: FileMutationResultMetadata | null | undefined,
  input: Pick<ToolFileMutationViewModelInput, "toolCallId" | "toolName">
): CompletedFileMutationMetadataProjection {
  if (!metadata) {
    return { kind: "invalid", reason: "missing_metadata" }
  }

  if (
    metadata.status !== "completed" ||
    metadata.toolCallId !== input.toolCallId ||
    metadata.toolName !== input.toolName
  ) {
    return { kind: "invalid", reason: "metadata_mismatch" }
  }

  const files = metadata.files.map((file) => ({
    after: file.after,
    before: file.before,
    changeType: file.changeType,
    diffMode: file.before !== null ? ("diff" as const) : ("code" as const),
    key: stableFileKey("completed_result", input.toolCallId, file.path),
    patch: null,
    path: file.path
  }))

  return files.length > 0 ? { files, kind: "ready" } : { kind: "invalid", reason: "empty_metadata" }
}

export function buildChangeListFileMutationViewModel(
  input: ChangeListFileMutationViewModelInput
): FileMutationViewModel | null {
  const files = input.changes.map((change) => ({
    after: null,
    before: null,
    changeType: change.changeType,
    diffMode: "tree" as const,
    key: stableFileKey(input.source, input.toolCallId, change.path),
    patch: null,
    path: change.path
  }))

  return createViewModel({
    files,
    source: input.source,
    status: input.status,
    title: input.title,
    toolCallId: input.toolCallId
  })
}

export function buildCompletedFileMutationViewModel(
  input: ToolFileMutationViewModelInput
): FileMutationProjection | null {
  if (!isFileMutationToolName(input.toolName) || input.status !== "complete") {
    return null
  }

  const argsProjection = buildRequiredFileMutationArgsProjection(input)
  if (argsProjection?.kind === "invalid") {
    return argsProjection
  }

  const metadataProjection = projectCompletedFilesFromResultMetadata(
    input.fileMutationResult,
    input
  )
  if (metadataProjection.kind === "invalid") {
    return metadataProjection
  }

  const viewModel = createViewModel({
    files: metadataProjection.files,
    source: "completed_result",
    status: "completed",
    toolCallId: input.toolCallId
  })

  return viewModel ? { kind: "view", viewModel } : { kind: "invalid", reason: "empty_metadata" }
}
