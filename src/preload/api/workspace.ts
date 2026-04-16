import { ipcRenderer } from "electron"

type WorkspaceFileReadResult = {
  success: boolean
  content?: string
  size?: number
  modified_at?: string
  error?: string
}

export const workspaceApi = {
  get: (threadId?: string): Promise<string | null> => {
    return ipcRenderer.invoke("workspace:get", threadId)
  },
  set: (threadId: string | undefined, path: string | null): Promise<string | null> => {
    return ipcRenderer.invoke("workspace:set", { threadId, path })
  },
  select: (threadId?: string): Promise<string | null> => {
    return ipcRenderer.invoke("workspace:select", threadId)
  },
  readFile: (threadId: string, filePath: string): Promise<WorkspaceFileReadResult> => {
    return ipcRenderer.invoke("workspace:readFile", { threadId, filePath })
  },
  readBinaryFile: (threadId: string, filePath: string): Promise<WorkspaceFileReadResult> => {
    return ipcRenderer.invoke("workspace:readBinaryFile", { threadId, filePath })
  }
}
