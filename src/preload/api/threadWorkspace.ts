import type { ProjectRecord, ThreadWorkspaceBindingRecord } from "@shared/thread-workspace"
import { invokeIpc } from "../ipc"

export const threadWorkspaceApi = {
  addProject: (workspacePath: string): Promise<ProjectRecord> => {
    return invokeIpc("threadWorkspace:addProject", { workspacePath })
  },
  bindProject: (
    threadId: string,
    workspacePath: string
  ): Promise<ThreadWorkspaceBindingRecord> => {
    return invokeIpc("threadWorkspace:bindProject", { threadId, workspacePath })
  },
  get: (threadId: string): Promise<ThreadWorkspaceBindingRecord | null> => {
    return invokeIpc("threadWorkspace:get", threadId)
  },
  markProjectless: (threadId: string): Promise<ThreadWorkspaceBindingRecord> => {
    return invokeIpc("threadWorkspace:markProjectless", threadId)
  }
}
