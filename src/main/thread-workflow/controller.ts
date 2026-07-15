import type { IpcMain } from "electron"
import type {
  AddThreadWorkflowLabelInput,
  CreateProjectWorkflowLabelInput,
  CreateProjectWorkflowStatusInput,
  RemoveThreadWorkflowLabelInput,
  SetProjectDefaultWorkflowStatusInput,
  SetThreadWorkflowStatusInput
} from "@shared/thread-workflow"
import { registerIpcHandle } from "../ipc/handle"
import { ThreadWorkflowService } from "./service"

export class ThreadWorkflowController {
  constructor(private readonly service: ThreadWorkflowService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "threadWorkflow:listProjects", async () => {
      return this.service.listProjects()
    })

    registerIpcHandle(ipcMain, "threadWorkflow:get", async (_event, threadId: string) => {
      return this.service.get(threadId)
    })

    registerIpcHandle(
      ipcMain,
      "threadWorkflow:createStatus",
      async (_event, input: CreateProjectWorkflowStatusInput) => {
        return this.service.createStatus(input)
      }
    )

    registerIpcHandle(
      ipcMain,
      "threadWorkflow:setDefaultStatus",
      async (_event, input: SetProjectDefaultWorkflowStatusInput) => {
        return this.service.setDefaultStatus(input)
      }
    )

    registerIpcHandle(
      ipcMain,
      "threadWorkflow:createLabel",
      async (_event, input: CreateProjectWorkflowLabelInput) => {
        return this.service.createLabel(input)
      }
    )

    registerIpcHandle(
      ipcMain,
      "threadWorkflow:setStatus",
      async (_event, input: SetThreadWorkflowStatusInput) => {
        return this.service.setStatus(input)
      }
    )

    registerIpcHandle(
      ipcMain,
      "threadWorkflow:addLabel",
      async (_event, input: AddThreadWorkflowLabelInput) => {
        return this.service.addLabel(input)
      }
    )

    registerIpcHandle(
      ipcMain,
      "threadWorkflow:removeLabel",
      async (_event, input: RemoveThreadWorkflowLabelInput) => {
        return this.service.removeLabel(input)
      }
    )
  }
}
