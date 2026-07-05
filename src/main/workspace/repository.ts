import {
  getGlobalWorkspacePath,
  getWorkspaceDialogPath,
  setGlobalWorkspacePath,
  setWorkspaceDialogPath
} from "../preferences"

export class WorkspaceRepository {
  getGlobalWorkspacePath(): string | null {
    return getGlobalWorkspacePath()
  }

  setGlobalWorkspacePath(workspacePath: string | null): void {
    setGlobalWorkspacePath(workspacePath)
  }

  getWorkspaceDialogPath(): string | null {
    return getWorkspaceDialogPath()
  }

  setWorkspaceDialogPath(workspacePath: string | null): void {
    setWorkspaceDialogPath(workspacePath)
  }
}
