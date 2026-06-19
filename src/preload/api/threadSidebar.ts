import type {
  ThreadSidebarOrganizeMode,
  ThreadSidebarSortBy,
  ThreadSidebarView
} from "@shared/thread-sidebar"
import { invokeIpc } from "../ipc"

export const threadSidebarApi = {
  getView: (): Promise<ThreadSidebarView> => {
    return invokeIpc("threadSidebar:getView")
  },
  reorderProjects: (projectIds: string[]): Promise<ThreadSidebarView> => {
    return invokeIpc("threadSidebar:reorderProjects", projectIds)
  },
  setOrganizeMode: (mode: ThreadSidebarOrganizeMode): Promise<ThreadSidebarView> => {
    return invokeIpc("threadSidebar:setOrganizeMode", mode)
  },
  setSortBy: (sortBy: ThreadSidebarSortBy): Promise<ThreadSidebarView> => {
    return invokeIpc("threadSidebar:setSortBy", sortBy)
  }
}
