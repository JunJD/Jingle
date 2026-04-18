import { BrowserWindow, type IpcMain } from "electron"
import type { LauncherSearchAction, LauncherSearchRequest } from "../../shared/launcher-search"
import {
  setLauncherWindowViewportHeight,
  showLauncherWindow
} from "../windows/launcher-window"
import { LauncherService } from "./service"

export class LauncherController {
  constructor(private readonly launcherService: LauncherService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("launcher:search", async (_event, request: LauncherSearchRequest) => {
      return this.launcherService.search(request)
    })

    ipcMain.handle("launcher:getClipboardContext", () => {
      return this.launcherService.getClipboardContext()
    })

    ipcMain.handle("launcher:executeAction", async (event, action: LauncherSearchAction) => {
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
    })

    ipcMain.handle("launcher:hide", (event) => {
      const currentWindow = BrowserWindow.fromWebContents(event.sender)
      currentWindow?.hide()
    })

    ipcMain.handle("launcher:show", (event) => {
      const currentWindow = BrowserWindow.fromWebContents(event.sender)
      if (!currentWindow) {
        return
      }

      showLauncherWindow(currentWindow)
    })

    ipcMain.handle("launcher:setViewportHeight", (event, height: number) => {
      const currentWindow = BrowserWindow.fromWebContents(event.sender)
      if (!currentWindow) {
        return
      }

      setLauncherWindowViewportHeight(currentWindow, height)
    })
  }
}
