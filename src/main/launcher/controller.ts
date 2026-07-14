import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from "electron"
import { AI_THREAD_SOURCE } from "@shared/launcher-ai"
import type { LauncherSearchAction, LauncherSearchRequest } from "@shared/launcher-search"
import {
  isLauncherWindowWebContents,
  setLauncherWindowViewportHeight,
  showLauncherWindow
} from "../windows/launcher-window"
import { isPinnedAiSessionWindowWebContents } from "../windows/pinned-ai-session-window"
import { registerIpcHandle } from "../ipc/handle"
import { LauncherService } from "./service"

export class LauncherController {
  constructor(private readonly launcherService: LauncherService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(
      ipcMain,
      "launcher:search",
      async (event, request: LauncherSearchRequest) => {
        this.assertSearchSender(event, request)
        return this.launcherService.search(request)
      }
    )

    registerIpcHandle(ipcMain, "launcher:getClipboardContext", (event) => {
      this.assertLauncherSender(event)
      return this.launcherService.getClipboardContext()
    })

    registerIpcHandle(ipcMain, "launcher:getSelectionContext", (event) => {
      this.assertLauncherSender(event)
      return this.launcherService.getSelectionContext()
    })

    registerIpcHandle(ipcMain, "launcher:clearSelectionContext", (event, id?: string) => {
      this.assertLauncherSender(event)
      this.launcherService.clearSelectionContext(id)
      event.sender.send("launcher:selection-context-updated")
    })

    registerIpcHandle(
      ipcMain,
      "launcher:executeAction",
      async (event, action: LauncherSearchAction) => {
        this.assertLauncherSender(event)
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
      this.assertLauncherSender(event)
      const currentWindow = BrowserWindow.fromWebContents(event.sender)
      currentWindow?.hide()
    })

    registerIpcHandle(ipcMain, "launcher:show", (event) => {
      this.assertLauncherSender(event)
      const currentWindow = BrowserWindow.fromWebContents(event.sender)
      if (!currentWindow) {
        return
      }

      showLauncherWindow(currentWindow)
    })

    registerIpcHandle(ipcMain, "launcher:setViewportHeight", (event, height: number) => {
      this.assertLauncherSender(event)
      const currentWindow = BrowserWindow.fromWebContents(event.sender)
      if (!currentWindow) {
        return
      }

      setLauncherWindowViewportHeight(currentWindow, height)
    })
  }

  private assertSearchSender(event: IpcMainInvokeEvent, request: unknown): void {
    this.assertMainFrame(event)

    if (isLauncherWindowWebContents(event.sender)) {
      return
    }

    if (
      isPinnedAiSessionWindowWebContents(event.sender) &&
      this.isPinnedAiThreadSearchRequest(request)
    ) {
      return
    }

    throw new Error(
      "Launcher search can only be invoked by the Launcher or by Pinned AI for thread-only search."
    )
  }

  private assertLauncherSender(event: IpcMainInvokeEvent): void {
    this.assertMainFrame(event)

    if (!isLauncherWindowWebContents(event.sender)) {
      throw new Error("Launcher commands can only be invoked by the Launcher window.")
    }
  }

  private assertMainFrame(event: IpcMainInvokeEvent): void {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Launcher commands can only be invoked from a window's main frame.")
    }
  }

  private isPinnedAiThreadSearchRequest(request: unknown): boolean {
    if (typeof request !== "object" || request === null) {
      return false
    }

    const candidate = request as Partial<LauncherSearchRequest>
    return (
      Array.isArray(candidate.sources) &&
      candidate.sources.length === 1 &&
      candidate.sources[0] === "threads" &&
      candidate.threadMetadataSource === AI_THREAD_SOURCE
    )
  }
}
