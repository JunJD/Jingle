export type ThreadWorkspaceKind = "project" | "projectless"

export interface ProjectRecord {
  archivedAt: Date | null
  canonicalWorkspacePath: string
  createdAt: Date
  displayName: string
  projectId: string
  updatedAt: Date
  workspaceKey: string
}

export interface ThreadWorkspaceBindingRecord {
  createdAt: Date
  project: ProjectRecord | null
  projectId: string | null
  threadId: string
  updatedAt: Date
  workspaceKey: string | null
  workspaceKind: ThreadWorkspaceKind
  workspacePath: string | null
}

export interface BindThreadProjectParams {
  threadId: string
  workspacePath: string
}

export interface AddProjectParams {
  workspacePath: string
}
