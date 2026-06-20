import { resolveOpenworkWorkspaceIdentity } from "../workspace/identity"
import { ThreadWorkspaceRepository } from "./repository"
import type { ProjectRecord, ThreadWorkspaceBindingRecord } from "@shared/thread-workspace"

export class ThreadWorkspaceService {
  constructor(private readonly repository: ThreadWorkspaceRepository) {}

  async addProject(workspacePath: string): Promise<ProjectRecord> {
    const identity = await resolveOpenworkWorkspaceIdentity(workspacePath)
    return this.repository.addProject(identity)
  }

  async bindProject(
    threadId: string,
    workspacePath: string
  ): Promise<ThreadWorkspaceBindingRecord> {
    const identity = await resolveOpenworkWorkspaceIdentity(workspacePath)
    return this.repository.bindProject({ identity, threadId })
  }

  async get(threadId: string): Promise<ThreadWorkspaceBindingRecord | null> {
    return this.repository.get(threadId)
  }

  async getThreadWorkspacePath(threadId: string): Promise<string | null> {
    const binding = await this.repository.get(threadId)
    return binding?.workspacePath ?? null
  }

  async markProjectless(
    threadId: string,
    workspacePath?: string | null
  ): Promise<ThreadWorkspaceBindingRecord> {
    return this.repository.markProjectless(threadId, workspacePath)
  }
}
