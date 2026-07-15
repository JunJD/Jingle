import type {
  AddThreadWorkflowLabelInput,
  CreateProjectWorkflowLabelInput,
  CreateProjectWorkflowStatusInput,
  ProjectWorkflowDefinition,
  RemoveThreadWorkflowLabelInput,
  SetThreadWorkflowStatusInput,
  SetProjectDefaultWorkflowStatusInput,
  ThreadWorkflowChangedEvent,
  ThreadWorkflowSummary
} from "@shared/thread-workflow"
import { invokeIpc, ipcRenderer } from "../ipc"

export const threadWorkflowApi = {
  onChanged: (listener: (event: ThreadWorkflowChangedEvent) => void): (() => void) => {
    const handler = (_event: unknown, payload: ThreadWorkflowChangedEvent): void => {
      listener(payload)
    }
    ipcRenderer.on("threadWorkflow:changed", handler)
    return () => ipcRenderer.removeListener("threadWorkflow:changed", handler)
  },
  listProjects: (): Promise<ProjectWorkflowDefinition[]> => {
    return invokeIpc("threadWorkflow:listProjects")
  },
  get: (threadId: string): Promise<ThreadWorkflowSummary | null> => {
    return invokeIpc("threadWorkflow:get", threadId)
  },
  createStatus: (input: CreateProjectWorkflowStatusInput): Promise<ProjectWorkflowDefinition> => {
    return invokeIpc("threadWorkflow:createStatus", input)
  },
  setDefaultStatus: (
    input: SetProjectDefaultWorkflowStatusInput
  ): Promise<ProjectWorkflowDefinition> => {
    return invokeIpc("threadWorkflow:setDefaultStatus", input)
  },
  createLabel: (input: CreateProjectWorkflowLabelInput): Promise<ProjectWorkflowDefinition> => {
    return invokeIpc("threadWorkflow:createLabel", input)
  },
  setStatus: (input: SetThreadWorkflowStatusInput): Promise<ThreadWorkflowSummary> => {
    return invokeIpc("threadWorkflow:setStatus", input)
  },
  addLabel: (input: AddThreadWorkflowLabelInput): Promise<ThreadWorkflowSummary> => {
    return invokeIpc("threadWorkflow:addLabel", input)
  },
  removeLabel: (input: RemoveThreadWorkflowLabelInput): Promise<ThreadWorkflowSummary> => {
    return invokeIpc("threadWorkflow:removeLabel", input)
  }
}
