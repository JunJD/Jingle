import type { Thread, ThreadHistoryState, ThreadRuntimeState } from "@shared/app-types"
import { invokeIpc } from "../ipc"

export const threadsApi = {
  list: (): Promise<Thread[]> => {
    return invokeIpc("threads:list")
  },
  get: (threadId: string): Promise<Thread | null> => {
    return invokeIpc("threads:get", threadId)
  },
  create: (metadata?: Record<string, unknown>): Promise<Thread> => {
    return invokeIpc("threads:create", metadata)
  },
  clone: (threadId: string): Promise<Thread> => {
    return invokeIpc("threads:clone", threadId)
  },
  cloneUntilMessage: (threadId: string, messageId: string): Promise<Thread> => {
    return invokeIpc("threads:cloneUntilMessage", threadId, messageId)
  },
  update: (threadId: string, updates: Partial<Thread>): Promise<Thread> => {
    return invokeIpc("threads:update", { threadId, updates })
  },
  delete: (threadId: string): Promise<void> => {
    return invokeIpc("threads:delete", threadId)
  },
  getHistory: (threadId: string): Promise<ThreadHistoryState> => {
    return invokeIpc("threads:history", threadId)
  },
  getRuntimeState: (threadId: string): Promise<ThreadRuntimeState> => {
    return invokeIpc("threads:runtimeState", threadId)
  },
  generateTitle: (message: string): Promise<string> => {
    return invokeIpc("threads:generateTitle", message)
  }
}
