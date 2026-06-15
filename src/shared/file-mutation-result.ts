import type { Message } from "./app-types"
import type { FileMutationToolName } from "./file-mutation-review"
import type { MutationChangeType } from "./mutation-prediction"

export const FILE_MUTATION_RESULT_METADATA_KEY = "openworkFileMutation"

export interface FileMutationResultFile {
  after: string | null
  before: string | null
  changeType: MutationChangeType | null
  path: string
}

export interface FileMutationResultMetadata {
  files: FileMutationResultFile[]
  status: "completed"
  toolCallId: string
  toolName: FileMutationToolName
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFileMutationToolName(value: unknown): value is FileMutationToolName {
  return value === "edit_file" || value === "write_file"
}

function isMutationChangeType(value: unknown): value is MutationChangeType {
  return value === "create" || value === "delete" || value === "modify"
}

function readNullableString(value: unknown): string | null | undefined {
  if (typeof value === "string" || value === null) {
    return value
  }

  return undefined
}

function readNullableMutationChangeType(value: unknown): MutationChangeType | null | undefined {
  if (isMutationChangeType(value) || value === null) {
    return value
  }

  return undefined
}

function readFile(value: unknown): FileMutationResultFile | null {
  if (!isRecord(value)) {
    return null
  }

  const path = typeof value.path === "string" ? value.path : null
  const before = readNullableString(value.before)
  const after = readNullableString(value.after)
  const changeType = readNullableMutationChangeType(value.changeType)
  if (!path || changeType === undefined || before === undefined || after === undefined) {
    return null
  }

  if (before === null && after === null) {
    return null
  }

  return {
    after,
    before,
    changeType,
    path
  }
}

export function readFileMutationResultMetadata(
  message: Pick<Message, "metadata">
): FileMutationResultMetadata | null {
  const value = message.metadata?.[FILE_MUTATION_RESULT_METADATA_KEY]
  if (!isRecord(value)) {
    return null
  }

  const toolCallId = typeof value.toolCallId === "string" ? value.toolCallId : null
  const toolName = isFileMutationToolName(value.toolName) ? value.toolName : null
  const status = value.status === "completed" ? value.status : null
  const rawFiles = Array.isArray(value.files) ? value.files : null
  if (!toolCallId || !toolName || !status || !rawFiles) {
    return null
  }

  const files: FileMutationResultFile[] = []
  for (const file of rawFiles) {
    const parsed = readFile(file)
    if (!parsed) {
      return null
    }

    files.push(parsed)
  }

  if (files.length === 0) {
    return null
  }

  return {
    files,
    status,
    toolCallId,
    toolName
  }
}
