import {
  applyThreadWorkflowRuntimeTransition,
  addThreadWorkflowLabel,
  createProjectWorkflowLabel,
  createProjectWorkflowStatus,
  createClassifiedThread,
  getThreadWorkflowSummary,
  listProjectWorkflowDefinitions,
  listThreadWorkflowSummaries,
  removeThreadWorkflowLabel,
  setProjectDefaultWorkflowStatus,
  setThreadWorkflowStatus,
  type CreateClassifiedThreadInput
} from "../db/thread-workflow"
import type { ApplyThreadWorkflowRuntimeTransitionInput } from "../db/thread-workflow"
import type { ThreadRow } from "../db/threads"
import type {
  AddThreadWorkflowLabelInput,
  CreateProjectWorkflowLabelInput,
  CreateProjectWorkflowStatusInput,
  ProjectWorkflowDefinition,
  RemoveThreadWorkflowLabelInput,
  SetThreadWorkflowStatusInput,
  SetProjectDefaultWorkflowStatusInput,
  ThreadWorkflowSummary
} from "@shared/thread-workflow"

export class ThreadWorkflowService {
  async listProjects(): Promise<ProjectWorkflowDefinition[]> {
    return listProjectWorkflowDefinitions()
  }

  async get(threadId: string): Promise<ThreadWorkflowSummary | null> {
    return getThreadWorkflowSummary(threadId)
  }

  async listThreadSummaries(threadIds: readonly string[]): Promise<ThreadWorkflowSummary[]> {
    return listThreadWorkflowSummaries(threadIds)
  }

  async createClassifiedThread(input: CreateClassifiedThreadInput): Promise<ThreadRow> {
    return createClassifiedThread(input)
  }

  async applyRuntimeTransition(input: ApplyThreadWorkflowRuntimeTransitionInput): Promise<boolean> {
    return applyThreadWorkflowRuntimeTransition(input)
  }

  async createStatus(input: CreateProjectWorkflowStatusInput): Promise<ProjectWorkflowDefinition> {
    return createProjectWorkflowStatus(input)
  }

  async setDefaultStatus(
    input: SetProjectDefaultWorkflowStatusInput
  ): Promise<ProjectWorkflowDefinition> {
    return setProjectDefaultWorkflowStatus(input)
  }

  async createLabel(input: CreateProjectWorkflowLabelInput): Promise<ProjectWorkflowDefinition> {
    return createProjectWorkflowLabel(input)
  }

  async setStatus(input: SetThreadWorkflowStatusInput): Promise<ThreadWorkflowSummary> {
    return setThreadWorkflowStatus(input)
  }

  async addLabel(input: AddThreadWorkflowLabelInput): Promise<ThreadWorkflowSummary> {
    return addThreadWorkflowLabel(input)
  }

  async removeLabel(input: RemoveThreadWorkflowLabelInput): Promise<ThreadWorkflowSummary> {
    return removeThreadWorkflowLabel(input)
  }
}
