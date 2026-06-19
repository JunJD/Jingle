import type { AgentThreadDataSnapshot, CreateThreadInput, Thread } from "@shared/app-types"
import { invokeIpc } from "../ipc"

export const threadsApi = {
  list: (): Promise<Thread[]> => {
    return invokeIpc("threads:list")
  },
  get: (threadId: string): Promise<Thread | null> => {
    return invokeIpc("threads:get", threadId)
  },
  create: (input?: CreateThreadInput): Promise<Thread> => {
    return invokeIpc("threads:create", input)
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
  setPinned: (threadId: string, pinned: boolean): Promise<Thread> => {
    return invokeIpc("threads:setPinned", { threadId, pinned })
  },
  delete: (threadId: string): Promise<void> => {
    return invokeIpc("threads:delete", threadId)
  },
  getAgentThreadData: (threadId: string): Promise<AgentThreadDataSnapshot> => {
    return invokeIpc("threads:agentThreadData", threadId)
  }
}
