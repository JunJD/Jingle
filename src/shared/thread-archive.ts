import type { ProjectRecord, ThreadWorkspaceKind } from "./thread-workspace"

export interface ArchivedThreadItem {
  archivedAt: Date
  createdAt: Date
  projectId: string | null
  threadId: string
  title: string
  updatedAt: Date
  workspaceKind: ThreadWorkspaceKind
  workspacePath: string | null
}

export interface ArchivedThreadsView {
  projects: ProjectRecord[]
  threads: ArchivedThreadItem[]
}
