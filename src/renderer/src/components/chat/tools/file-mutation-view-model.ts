import {
  getFileMutationReview,
  isFileMutationToolName,
  type FileMutationToolName
} from "@shared/file-mutation-review"
import type { FileMutationResultMetadata } from "@shared/file-mutation-result"
import type { FileMutationToolApprovalItem, ToolApprovalItem } from "@shared/tool-approval"
import type { MutationChangeType, MutationPredictionChange } from "@shared/mutation-prediction"
import { parseCompleteToolCallArgsObject } from "@shared/tool-call-args"
import { formatPatch, parsePatch, type StructuredPatch } from "diff"
import { parse as parsePartialJson } from "partial-json"

export type FileMutationViewModelSource =
  | "streaming_preview"
  | "approval_preview"
  | "completed_result"
  | "tool_args_preview"
  | "artifact"

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

interface StreamingFileMutationViewModelInput {
  argsText: string | undefined
  toolCallId: string
  toolName: string
}

interface ToolFileMutationViewModelInput {
  args: Record<string, unknown>
  fileMutationResult?: FileMutationResultMetadata | null
  hasResult: boolean
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

function stableFileKey(source: FileMutationViewModelSource, toolCallId: string, path: string): string {
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
  if (!review.path) {
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

function buildCompletedFilesFromResultMetadata(
  metadata: FileMutationResultMetadata | null | undefined,
  input: Pick<ToolFileMutationViewModelInput, "toolCallId" | "toolName">
): FileMutationFileViewModel[] {
  if (
    !metadata ||
    metadata.status !== "completed" ||
    metadata.toolCallId !== input.toolCallId ||
    metadata.toolName !== input.toolName
  ) {
    return []
  }

  return metadata.files.map((file) => ({
    after: file.after,
    before: file.before,
    changeType: file.changeType,
    diffMode: file.before !== null ? ("diff" as const) : ("code" as const),
    key: stableFileKey("completed_result", input.toolCallId, file.path),
    patch: null,
    path: file.path
  }))
}

function stripPatchPathPrefix(path: string): string {
  if (path === "/dev/null") {
    return path
  }

  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path
}

function getPatchPath(patch: StructuredPatch, index: number): string {
  if (patch.newFileName && patch.newFileName !== "/dev/null") {
    return stripPatchPathPrefix(patch.newFileName)
  }

  if (patch.oldFileName && patch.oldFileName !== "/dev/null") {
    return stripPatchPathPrefix(patch.oldFileName)
  }

  return `patch-${index + 1}`
}

function getPatchChangeType(patch: StructuredPatch): MutationChangeType {
  if (patch.isCreate) {
    return "create"
  }

  if (patch.isDelete) {
    return "delete"
  }

  return "modify"
}

function buildPatchFiles(input: {
  patchText: string
  source: FileMutationViewModelSource
  toolCallId: string
}): FileMutationFileViewModel[] {
  const parsed = parsePatch(input.patchText)

  if (parsed.length === 0) {
    return [
      {
        after: null,
        before: null,
        changeType: null,
        diffMode: "diff",
        key: stableFileKey(input.source, input.toolCallId, "patch"),
        patch: input.patchText,
        path: "Patch"
      }
    ]
  }

  return parsed.map((patch, index) => {
    const path = getPatchPath(patch, index)
    return {
      after: null,
      before: null,
      changeType: getPatchChangeType(patch),
      diffMode: "diff" as const,
      key: stableFileKey(input.source, input.toolCallId, path),
      patch: formatPatch(patch),
      path
    }
  })
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

  const filesFromMetadata = buildCompletedFilesFromResultMetadata(input.fileMutationResult, input)
  const viewModel = createViewModel({
    files: filesFromMetadata,
    source: "completed_result",
    status: "completed",
    toolCallId: input.toolCallId
  })

  if (viewModel) {
    return { kind: "view", viewModel }
  }

  if (!input.hasResult) {
    return null
  }

  const argsPreviewViewModel = buildFileFromToolArgs({
    args: input.args,
    source: "tool_args_preview",
    status: "completed",
    toolCallId: input.toolCallId,
    toolName: input.toolName
  })

  return argsPreviewViewModel ? { kind: "view", viewModel: argsPreviewViewModel } : null
}

export function buildPatchArtifactFileMutationViewModel(input: {
  patchText: string
  title?: string | null
}): FileMutationViewModel {
  const toolCallId = input.title === undefined || input.title === null ? "patch" : input.title
  return {
    files: buildPatchFiles({
      patchText: input.patchText,
      source: "artifact",
      toolCallId
    }),
    key: `artifact:${toolCallId}`,
    source: "artifact",
    status: "completed",
    title: input.title === undefined ? null : input.title
  }
}
