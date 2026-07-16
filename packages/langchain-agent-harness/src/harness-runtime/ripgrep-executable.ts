import { isAbsolute, join, relative, sep } from "node:path"
import { rgPath } from "@vscode/ripgrep"

export interface ResolveRipgrepExecutablePathInput {
  candidatePath: string
  resourcesPath?: string
}

export function resolveRipgrepExecutablePath({
  candidatePath,
  resourcesPath
}: ResolveRipgrepExecutablePathInput): string {
  if (!resourcesPath) {
    return candidatePath
  }

  const appAsarPath = join(resourcesPath, "app.asar")
  const relativePath = relative(appAsarPath, candidatePath)
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return candidatePath
  }

  return join(resourcesPath, "app.asar.unpacked", relativePath)
}

const electronResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath

export const ripgrepExecutablePath = resolveRipgrepExecutablePath({
  candidatePath: rgPath,
  resourcesPath: electronResourcesPath
})
