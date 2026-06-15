import { getFileMutationReview, isFileMutationToolName } from "@shared/file-mutation-review"
import type { FileMutationResultMetadata } from "@shared/file-mutation-result"
import type { FileMutationToolApprovalItem, ToolApprovalItem } from "@shared/tool-approval"
import type { MutationChangeType, MutationPredictionChange } from "@shared/mutation-prediction"
import { parseCompleteToolCallArgsObject } from "@shared/tool-call-args"
import { formatPatch, parsePatch, type StructuredPatch } from "diff"

export type FileMutationViewModelSource =
  | "streaming_preview"
  | "approval_preview"
  | "completed_result"
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
      kind: "partial_args"
      rawArgs: string
    }
  | {
      kind: "raw_result"
      rawResult: string
    }

interface StreamingFileMutationViewModelInput {
  argsText: string | undefined
  toolCallId: string
  toolName: string
}

interface ToolFileMutationViewModelInput {
  fileMutationResult?: FileMutationResultMetadata | null
  result: unknown
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function readStringAlias(value: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const text = readString(value[key])
    if (text !== null) {
      return text
    }
  }

  return null
}

function readCompletedFiles(value: Record<string, unknown>): unknown[] {
  if (Array.isArray(value.files)) {
    return value.files
  }

  if (Array.isArray(value.changes)) {
    return value.changes
  }

  return []
}

function readChangeType(value: Record<string, unknown>): MutationChangeType | null {
  const rawChangeType = readStringAlias(value, ["changeType", "type"])
  if (
    rawChangeType === "create" ||
    rawChangeType === "delete" ||
    rawChangeType === "modify"
  ) {
    return rawChangeType
  }

  return null
}

function readCompletedFileKey(
  entry: Record<string, unknown>,
  index: number,
  path: string
): string {
  const key = readString(entry.key)
  if (key !== null) {
    return key
  }

  return `${index}:${path}`
}

function getCompletedDiffMode(input: {
  before: string | null
  patch: string | null
}): FileMutationDiffMode {
  if (input.patch) {
    return "diff"
  }

  if (input.before !== null) {
    return "diff"
  }

  return "code"
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

export function buildStreamingFileMutationViewModel(
  input: StreamingFileMutationViewModelInput
): FileMutationProjection | null {
  if (!isFileMutationToolName(input.toolName)) {
    return null
  }

  const argsText = input.argsText === undefined ? "" : input.argsText
  const args = parseCompleteToolCallArgsObject(argsText)
  if (!args) {
    return argsText ? { kind: "partial_args", rawArgs: argsText } : null
  }

  const review = getFileMutationReview(input.toolName, args)
  if (!review) {
    return null
  }

  const file = buildFileFromReview({
    review: {
      ...review,
      changes: []
    },
    source: "streaming_preview",
    toolCallId: input.toolCallId
  })
  const viewModel = createViewModel({
    files: file ? [file] : [],
    source: "streaming_preview",
    status: "pending",
    toolCallId: input.toolCallId
  })

  return viewModel ? { kind: "view", viewModel } : null
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

function parseCompletedFileChanges(value: unknown): FileMutationFileViewModel[] {
  if (!isRecord(value)) {
    return []
  }

  const rawFiles = readCompletedFiles(value)

  return rawFiles.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      return []
    }

    const path = readStringAlias(entry, ["path", "filePath", "file_path"])
    if (!path) {
      return []
    }

    const patch = readStringAlias(entry, ["patch", "patchText", "diff"])
    const after = readStringAlias(entry, ["after", "content", "newText", "new_text"])
    const before = readStringAlias(entry, ["before", "oldText", "old_text"])
    if (patch === null && after === null && before === null) {
      return []
    }

    const changeType = readChangeType(entry)
    const key = readCompletedFileKey(entry, index, path)

    return [
      {
        after,
        before,
        changeType,
        diffMode: getCompletedDiffMode({ before, patch }),
        key,
        patch,
        path
      }
    ]
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

function looksLikeUnifiedPatch(value: string): boolean {
  return value.includes("diff --git ") || (value.includes("\n@@ ") && value.includes("\n--- "))
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
  let files = filesFromMetadata
  if (files.length === 0) {
    files = parseCompletedFileChanges(input.result).map((file) => ({
      ...file,
      key: stableFileKey("completed_result", input.toolCallId, file.key)
    }))
  }
  const viewModel = createViewModel({
    files,
    source: "completed_result",
    status: "completed",
    toolCallId: input.toolCallId
  })

  if (viewModel) {
    return { kind: "view", viewModel }
  }

  if (typeof input.result === "string" && looksLikeUnifiedPatch(input.result)) {
    const patchViewModel = createViewModel({
      files: buildPatchFiles({
        patchText: input.result,
        source: "completed_result",
        toolCallId: input.toolCallId
      }),
      source: "completed_result",
      status: "completed",
      toolCallId: input.toolCallId
    })

    return patchViewModel ? { kind: "view", viewModel: patchViewModel } : null
  }

  if (input.result !== undefined) {
    let rawResult: string
    if (typeof input.result === "string") {
      rawResult = input.result
    } else {
      rawResult = JSON.stringify(input.result, null, 2)
    }
    return rawResult.trim() ? { kind: "raw_result", rawResult } : null
  }

  return null
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
