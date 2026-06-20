import {
  mapProjectRecord,
  getThreadWorkspaceBinding,
  mapThreadWorkspaceBindingRecord,
  upsertProject,
  upsertThreadWorkspaceBinding
} from "../db"
import type { ProjectRecord, ThreadWorkspaceBindingRecord } from "@shared/thread-workspace"
import type { OpenworkWorkspaceIdentity } from "@shared/openwork-memory"

export class ThreadWorkspaceRepository {
  async addProject(identity: OpenworkWorkspaceIdentity): Promise<ProjectRecord> {
    const project = await upsertProject({
      canonicalWorkspacePath: identity.canonicalWorkspacePath,
      displayName: identity.displayName,
      projectId: identity.workspaceKey,
      workspaceKey: identity.workspaceKey
    })

    return mapProjectRecord(project)
  }

  async bindProject(input: {
    identity: OpenworkWorkspaceIdentity
    threadId: string
  }): Promise<ThreadWorkspaceBindingRecord> {
    const project = await this.addProject(input.identity)
    const binding = await upsertThreadWorkspaceBinding({
      projectId: project.projectId,
      threadId: input.threadId,
      workspaceKey: project.workspaceKey,
      workspaceKind: "project",
      workspacePath: project.canonicalWorkspacePath
    })

    return mapThreadWorkspaceBindingRecord(binding)
  }

  async get(threadId: string): Promise<ThreadWorkspaceBindingRecord | null> {
    const binding = await getThreadWorkspaceBinding(threadId)
    return binding ? mapThreadWorkspaceBindingRecord(binding) : null
  }

  async markProjectless(
    threadId: string,
    workspacePath?: string | null
  ): Promise<ThreadWorkspaceBindingRecord> {
    const binding = await upsertThreadWorkspaceBinding({
      projectId: null,
      threadId,
      workspaceKey: null,
      workspaceKind: "projectless",
      workspacePath: workspacePath ?? null
    })

    return mapThreadWorkspaceBindingRecord(binding)
  }
}
