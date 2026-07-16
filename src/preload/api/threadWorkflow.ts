import {
  projectWorkflowDefinitionSchema,
  projectWorkflowDefinitionsSchema,
  threadWorkflowChangedEventSchema,
  threadWorkflowViewSchema,
  type AddThreadWorkflowLabelInput,
  type CreateProjectWorkflowLabelInput,
  type CreateProjectWorkflowStatusInput,
  type ProjectWorkflowDefinition,
  type RemoveThreadWorkflowLabelInput,
  type SetProjectDefaultWorkflowStatusInput,
  type SetThreadWorkflowStatusInput,
  type ThreadWorkflowChangedEvent,
  type ThreadWorkflowView
} from "@shared/thread-workflow"
import { invokeIpc, ipcRenderer } from "../ipc"

export const threadWorkflowApi = {
  onChanged: (listener: (event: ThreadWorkflowChangedEvent) => void): (() => void) => {
    const handler = (_event: unknown, payload: unknown): void => {
      const parsed = threadWorkflowChangedEventSchema.safeParse(payload)
      if (!parsed.success) {
        console.error("[ThreadWorkflow] Ignored an invalid change event.")
        return
      }
      listener(parsed.data)
    }
    ipcRenderer.on("threadWorkflow:changed", handler)
    return () => ipcRenderer.removeListener("threadWorkflow:changed", handler)
  },
  listProjects: async (): Promise<ProjectWorkflowDefinition[]> => {
    return projectWorkflowDefinitionsSchema.parse(await invokeIpc("threadWorkflow:listProjects"))
  },
  get: async (threadId: string): Promise<ThreadWorkflowView> => {
    return threadWorkflowViewSchema.parse(await invokeIpc("threadWorkflow:get", { threadId }))
  },
  createStatus: async (
    input: CreateProjectWorkflowStatusInput
  ): Promise<ProjectWorkflowDefinition> => {
    return projectWorkflowDefinitionSchema.parse(
      await invokeIpc("threadWorkflow:createStatus", input)
    )
  },
  setDefaultStatus: async (
    input: SetProjectDefaultWorkflowStatusInput
  ): Promise<ProjectWorkflowDefinition> => {
    return projectWorkflowDefinitionSchema.parse(
      await invokeIpc("threadWorkflow:setDefaultStatus", input)
    )
  },
  createLabel: async (
    input: CreateProjectWorkflowLabelInput
  ): Promise<ProjectWorkflowDefinition> => {
    return projectWorkflowDefinitionSchema.parse(
      await invokeIpc("threadWorkflow:createLabel", input)
    )
  },
  setStatus: async (input: SetThreadWorkflowStatusInput): Promise<ThreadWorkflowView> => {
    return threadWorkflowViewSchema.parse(await invokeIpc("threadWorkflow:setStatus", input))
  },
  addLabel: async (input: AddThreadWorkflowLabelInput): Promise<ThreadWorkflowView> => {
    return threadWorkflowViewSchema.parse(await invokeIpc("threadWorkflow:addLabel", input))
  },
  removeLabel: async (input: RemoveThreadWorkflowLabelInput): Promise<ThreadWorkflowView> => {
    return threadWorkflowViewSchema.parse(await invokeIpc("threadWorkflow:removeLabel", input))
  }
}
