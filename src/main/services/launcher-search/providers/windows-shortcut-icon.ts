import path from "node:path"

export interface WindowsApplicationIconCandidateInput {
  applicationPath: string
  shortcutIconPath?: string
  shortcutTargetPath?: string
}

function normalizeCandidatePath(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : undefined
}

function isWindowsIconFilePath(filePath: string | undefined): boolean {
  if (!filePath) {
    return false
  }

  return path.win32.extname(filePath).toLowerCase() === ".ico"
}

export function isWindowsShortcutPath(filePath: string): boolean {
  return path.win32.extname(filePath).toLowerCase() === ".lnk"
}

export function resolveWindowsApplicationIconPathCandidates(
  input: WindowsApplicationIconCandidateInput
): string[] {
  const applicationPath = normalizeCandidatePath(input.applicationPath)
  if (!applicationPath) {
    return []
  }

  if (!isWindowsShortcutPath(applicationPath)) {
    return [applicationPath]
  }

  const shortcutIconPath = normalizeCandidatePath(input.shortcutIconPath)
  const shortcutTargetPath = normalizeCandidatePath(input.shortcutTargetPath)
  const orderedCandidates = [
    isWindowsIconFilePath(shortcutIconPath) ? shortcutIconPath : undefined,
    shortcutTargetPath,
    shortcutIconPath,
    applicationPath
  ]

  const seenPaths = new Set<string>()
  const uniqueCandidates: string[] = []

  for (const candidatePath of orderedCandidates) {
    if (!candidatePath || seenPaths.has(candidatePath)) {
      continue
    }

    seenPaths.add(candidatePath)
    uniqueCandidates.push(candidatePath)
  }

  return uniqueCandidates
}
