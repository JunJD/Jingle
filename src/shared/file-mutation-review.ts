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

function readOptionalStringFromAliases(
  args: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = readOptionalString(args[key])
    if (value !== null) {
      return value
    }
  }

  return null
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
    newText: readOptionalStringFromAliases(args, ["new_string", "new_str"]),
    oldText: readOptionalStringFromAliases(args, ["old_string", "old_str"]),
    path: readOptionalStringFromAliases(args, ["file_path", "path"]),
    toolName
  }
}
