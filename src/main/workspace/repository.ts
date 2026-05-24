import { getThread, updateThread } from "../db"
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

  async getThreadWorkspacePath(threadId: string): Promise<string | null> {
    const thread = await getThread(threadId)
    if (!thread?.metadata) return null

    const metadata = JSON.parse(thread.metadata) as { workspacePath?: string | null }
    return metadata.workspacePath || null
  }

  async setThreadWorkspacePath(threadId: string, workspacePath: string | null): Promise<boolean> {
    const thread = await getThread(threadId)
    if (!thread) return false

    const metadata = thread.metadata ? JSON.parse(thread.metadata) : {}
    metadata.workspacePath = workspacePath
    await updateThread(threadId, { metadata: JSON.stringify(metadata) })

    return true
  }
}
