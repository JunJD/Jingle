import { basename, extname } from "node:path"
import type { LauncherOpenPathTarget } from "../../shared/launcher-search"

export type ApplicationDisplayNameResolver = (
  applicationPath: string
) => Promise<string | undefined>

function getLauncherPathTitle(target: LauncherOpenPathTarget): string {
  const fileName = basename(target.path)
  if (target.kind === "application") {
    const fileExtension = extname(fileName)
    return fileExtension ? basename(fileName, fileExtension) : fileName
  }

  return fileName
}

export async function getLauncherApplicationHistoryTitle(
  applicationPath: string,
  resolveApplicationDisplayName: ApplicationDisplayNameResolver
): Promise<string> {
  return (
    (await resolveApplicationDisplayName(applicationPath)) ??
    getLauncherPathTitle({
      kind: "application",
      path: applicationPath
    })
  )
}

export async function getLauncherOpenPathHistoryTitle(
  target: LauncherOpenPathTarget,
  resolveApplicationDisplayName: ApplicationDisplayNameResolver
): Promise<string> {
  if (target.kind === "application") {
    return getLauncherApplicationHistoryTitle(target.path, resolveApplicationDisplayName)
  }

  return getLauncherPathTitle(target)
}
