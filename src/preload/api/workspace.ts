import { invokeIpc } from "../ipc"

type WorkspaceFileReadResult = {
  success: boolean
  content?: string
  size?: number
  modified_at?: string
  error?: string
}

export const workspaceApi = {
  get: (threadId?: string): Promise<string | null> => {
    return invokeIpc("workspace:get", threadId)
  },
  set: (threadId: string | undefined, path: string | null): Promise<string | null> => {
    return invokeIpc("workspace:set", { threadId, path })
  },
  select: (threadId?: string): Promise<string | null> => {
    return invokeIpc("workspace:select", threadId)
  },
  readFile: (threadId: string, filePath: string): Promise<WorkspaceFileReadResult> => {
    return invokeIpc("workspace:readFile", { threadId, filePath })
  },
  readBinaryFile: (threadId: string, filePath: string): Promise<WorkspaceFileReadResult> => {
    return invokeIpc("workspace:readBinaryFile", { threadId, filePath })
  }
}
