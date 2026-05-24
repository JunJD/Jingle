import { BrowserWindow, type IpcMain } from "electron"
import type { LauncherSearchAction, LauncherSearchRequest } from "@shared/launcher-search"
import { setLauncherWindowViewportHeight, showLauncherWindow } from "../windows/launcher-window"
import { registerIpcHandle } from "../ipc/handle"
import { LauncherService } from "./service"

export class LauncherController {
  constructor(private readonly launcherService: LauncherService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(
      ipcMain,
      "launcher:search",
      async (_event, request: LauncherSearchRequest) => {
        return this.launcherService.search(request)
      }
    )

    registerIpcHandle(ipcMain, "launcher:getClipboardContext", () => {
      return this.launcherService.getClipboardContext()
    })

    registerIpcHandle(
      ipcMain,
      "launcher:executeAction",
      async (event, action: LauncherSearchAction) => {
        const currentWindow = BrowserWindow.fromWebContents(event.sender)

        try {
          await this.launcherService.executeAction(action)
          currentWindow?.hide()
          return {
            ok: true
          }
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
            ok: false
          }
        }
      }
    )

    registerIpcHandle(ipcMain, "launcher:hide", (event) => {
      const currentWindow = BrowserWindow.fromWebContents(event.sender)
      currentWindow?.hide()
    })

    registerIpcHandle(ipcMain, "launcher:show", (event) => {
      const currentWindow = BrowserWindow.fromWebContents(event.sender)
      if (!currentWindow) {
        return
      }

      showLauncherWindow(currentWindow)
    })

    registerIpcHandle(ipcMain, "launcher:setViewportHeight", (event, height: number) => {
      const currentWindow = BrowserWindow.fromWebContents(event.sender)
      if (!currentWindow) {
        return
      }

      setLauncherWindowViewportHeight(currentWindow, height)
    })
  }
}
