import path from "node:path"

export interface ExecuteCommandSessionEnv {
  cwd: string
  isInsideWorkspacePath(candidatePath: string): boolean
  resolveCwd(cwd?: string | null): string
  toMountCwd(params: {
    cwd?: string | null
    mountPoint: string
  }): string
}

function isInsideWorkspace(workspacePath: string, candidatePath: string): boolean {
  const relativePath = path.relative(workspacePath, candidatePath)
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  )
}

export function createExecuteCommandSessionEnv(workspacePath: string): ExecuteCommandSessionEnv {
  const workspaceRoot = path.resolve(workspacePath)

  const isInsideWorkspacePath = (candidatePath: string): boolean =>
    isInsideWorkspace(workspaceRoot, path.resolve(candidatePath))

  const resolveCwd = (cwd: string | null | undefined): string => {
    const trimmedCwd = cwd?.trim()
    if (!trimmedCwd) {
      return workspaceRoot
    }

    const candidatePath = path.resolve(
      path.isAbsolute(trimmedCwd) ? trimmedCwd : path.join(workspaceRoot, trimmedCwd)
    )
    return candidatePath
  }

  return {
    cwd: workspaceRoot,
    isInsideWorkspacePath,
    resolveCwd,
    toMountCwd(params): string {
      const resolvedCwd = resolveCwd(params.cwd)
      if (!isInsideWorkspacePath(resolvedCwd)) {
        throw new Error(`Mutation prediction cwd must stay inside the workspace: ${resolvedCwd}`)
      }

      const relativePath = path.relative(workspaceRoot, resolvedCwd)
      if (!relativePath) {
        return params.mountPoint
      }

      return path.posix.join(params.mountPoint, relativePath.split(path.sep).join("/"))
    }
  }
}

export function resolveExecuteCommandCwd(
  workspacePath: string,
  cwd: string | null | undefined
): string {
  return createExecuteCommandSessionEnv(workspacePath).resolveCwd(cwd)
}
