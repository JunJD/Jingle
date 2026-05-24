export type FileMutationToolName = "edit_file" | "write_file"

export interface FileMutationReview {
  content: string | null
  newText: string | null
  oldText: string | null
  path: string | null
  toolName: FileMutationToolName
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

export function isFileMutationToolName(value: string): value is FileMutationToolName {
  return value === "edit_file" || value === "write_file"
}

export function getFileMutationReview(toolName: string, args: unknown): FileMutationReview | null {
  if (!isFileMutationToolName(toolName) || !isRecord(args)) {
    return null
  }

  return {
    content: readOptionalString(args.content),
    newText: readOptionalString(args.new_str),
    oldText: readOptionalString(args.old_str),
    path: readOptionalString(args.path ?? args.file_path),
    toolName
  }
}
