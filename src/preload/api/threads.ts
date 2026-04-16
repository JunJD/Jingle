import { ipcRenderer } from "electron"
import type { Thread, ThreadHistoryState, ThreadRuntimeState } from "../../shared/app-types"

export const threadsApi = {
  list: (): Promise<Thread[]> => {
    return ipcRenderer.invoke("threads:list")
  },
  get: (threadId: string): Promise<Thread | null> => {
    return ipcRenderer.invoke("threads:get", threadId)
  },
  create: (metadata?: Record<string, unknown>): Promise<Thread> => {
    return ipcRenderer.invoke("threads:create", metadata)
  },
  update: (threadId: string, updates: Partial<Thread>): Promise<Thread> => {
    return ipcRenderer.invoke("threads:update", { threadId, updates })
  },
  delete: (threadId: string): Promise<void> => {
    return ipcRenderer.invoke("threads:delete", threadId)
  },
  getHistory: (threadId: string): Promise<ThreadHistoryState> => {
    return ipcRenderer.invoke("threads:history", threadId)
  },
  getRuntimeState: (threadId: string): Promise<ThreadRuntimeState> => {
    return ipcRenderer.invoke("threads:runtimeState", threadId)
  },
  generateTitle: (message: string): Promise<string> => {
    return ipcRenderer.invoke("threads:generateTitle", message)
  }
}
