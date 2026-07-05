import type { IpcMain } from "electron"
import type { ThreadSidebarOrganizeMode, ThreadSidebarSortBy } from "@shared/thread-sidebar"
import { registerIpcHandle } from "../ipc/handle"
import { ThreadSidebarService } from "./service"

export class ThreadSidebarController {
  constructor(private readonly service: ThreadSidebarService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "threadSidebar:getView", async () => {
      return this.service.getView()
    })

    registerIpcHandle(
      ipcMain,
      "threadSidebar:reorderProjects",
      async (_event, projectIds: string[]) => {
        return this.service.reorderProjects(projectIds)
      }
    )

    registerIpcHandle(
      ipcMain,
      "threadSidebar:setOrganizeMode",
      async (_event, mode: ThreadSidebarOrganizeMode) => {
        return this.service.setOrganizeMode(mode)
      }
    )

    registerIpcHandle(ipcMain, "threadSidebar:setSortBy", async (_event, sortBy: ThreadSidebarSortBy) => {
      return this.service.setSortBy(sortBy)
    })
  }
}
