import {
  applyThreadWorkflowRuntimeTransition,
  addThreadWorkflowLabel,
  createProjectWorkflowLabel,
  createProjectWorkflowStatus,
  createClassifiedThread,
  getThreadWorkflowView,
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
  ThreadWorkflowChangedEvent,
  ThreadWorkflowSummary,
  ThreadWorkflowView
} from "@shared/thread-workflow"

export class ThreadWorkflowService {
  private readonly changedListeners = new Set<(event: ThreadWorkflowChangedEvent) => void>()

  onChanged(listener: (event: ThreadWorkflowChangedEvent) => void): () => void {
    this.changedListeners.add(listener)
    return () => this.changedListeners.delete(listener)
  }

  private publishChanged(event: ThreadWorkflowChangedEvent): void {
    for (const listener of this.changedListeners) {
      try {
        listener(event)
      } catch (error) {
        console.warn("[ThreadWorkflow] Change listener failed after persistence.", {
          error,
          scope: event.scope
        })
      }
    }
  }

  async listProjects(): Promise<ProjectWorkflowDefinition[]> {
    return listProjectWorkflowDefinitions()
  }

  async getView(threadId: string): Promise<ThreadWorkflowView> {
    return getThreadWorkflowView(threadId)
  }

  async listThreadSummaries(threadIds: readonly string[]): Promise<ThreadWorkflowSummary[]> {
    return listThreadWorkflowSummaries(threadIds)
  }

  async createClassifiedThread(input: CreateClassifiedThreadInput): Promise<ThreadRow> {
    const thread = await createClassifiedThread(input)
    this.publishChanged({ scope: "thread", threadId: input.threadId })
    return thread
  }

  async applyRuntimeTransition(input: ApplyThreadWorkflowRuntimeTransitionInput): Promise<boolean> {
    return this.applyRuntimeTransitions([input])
  }

  async applyRuntimeTransitions(
    inputs: readonly ApplyThreadWorkflowRuntimeTransitionInput[]
  ): Promise<boolean> {
    const threadId = inputs[0]?.threadId
    if (!threadId) {
      return false
    }
    if (inputs.some((input) => input.threadId !== threadId)) {
      throw new Error("A workflow runtime transition batch must belong to one thread.")
    }

    let changed = false
    try {
      for (const input of inputs) {
        changed = (await applyThreadWorkflowRuntimeTransition(input)) || changed
      }
    } finally {
      if (changed) {
        this.publishChanged({ scope: "thread", threadId })
      }
    }
    return changed
  }

  async createStatus(input: CreateProjectWorkflowStatusInput): Promise<ProjectWorkflowDefinition> {
    const project = await createProjectWorkflowStatus(input)
    this.publishChanged({ projectId: input.projectId, scope: "project" })
    return project
  }

  async setDefaultStatus(
    input: SetProjectDefaultWorkflowStatusInput
  ): Promise<ProjectWorkflowDefinition> {
    const project = await setProjectDefaultWorkflowStatus(input)
    this.publishChanged({ projectId: input.projectId, scope: "project" })
    return project
  }

  async createLabel(input: CreateProjectWorkflowLabelInput): Promise<ProjectWorkflowDefinition> {
    const project = await createProjectWorkflowLabel(input)
    this.publishChanged({ projectId: input.projectId, scope: "project" })
    return project
  }

  async setStatus(input: SetThreadWorkflowStatusInput): Promise<ThreadWorkflowView> {
    const view = await setThreadWorkflowStatus(input)
    this.publishChanged({ scope: "thread", threadId: input.threadId })
    return view
  }

  async addLabel(input: AddThreadWorkflowLabelInput): Promise<ThreadWorkflowView> {
    const view = await addThreadWorkflowLabel(input)
    this.publishChanged({ scope: "thread", threadId: input.threadId })
    return view
  }

  async removeLabel(input: RemoveThreadWorkflowLabelInput): Promise<ThreadWorkflowView> {
    const view = await removeThreadWorkflowLabel(input)
    this.publishChanged({ scope: "thread", threadId: input.threadId })
    return view
  }
}
