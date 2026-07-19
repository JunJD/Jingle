import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from "electron"
import { AI_THREAD_SOURCE } from "@shared/launcher-ai"
import type {
  LauncherSearchAction,
  LauncherSearchCancellation,
  LauncherSearchInvocation,
  LauncherSearchRequest
} from "@shared/launcher-search"
import { launcherPresentArgsSchema } from "@shared/launcher-presentation"
import {
  presentLauncherWindow,
  setLauncherWindowViewportHeight,
  showLauncherWindow
} from "../windows/launcher-window"
import { getWindowIdentity } from "../windows/window-identity"
import { registerIpcHandle, registerValidatedIpcHandle } from "../ipc/handle"
import {
  bindLauncherSearchSenderLifetime,
  getScopedLauncherSearchCallerId
} from "./search-sender-lifetime"
import { LauncherService } from "./service"

export class LauncherController {
  constructor(private readonly launcherService: LauncherService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(
      ipcMain,
      "launcher:search",
      async (event, invocation: LauncherSearchInvocation) => {
        this.assertSearchSender(event, invocation.request)
        const lifetime = bindLauncherSearchSenderLifetime({
          callerId: invocation.callerId,
          cancel: (scopedCallerId) => {
            this.launcherService.cancelSearch(scopedCallerId)
          },
          sender: event.sender
        })
        try {
          const searchPromise = this.launcherService.search(invocation.request, lifetime.callerId)
          lifetime.activate()
          return await searchPromise
        } finally {
          lifetime.dispose()
        }
      }
    )

    registerIpcHandle(
      ipcMain,
      "launcher:cancelSearch",
      (event, cancellation: LauncherSearchCancellation) => {
        this.assertSearchCancellationSender(event)
        return this.launcherService.cancelSearch(
          getScopedLauncherSearchCallerId(event.sender.id, cancellation.callerId)
        )
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

    registerValidatedIpcHandle(
      ipcMain,
      "launcher:present",
      launcherPresentArgsSchema,
      (event, presentationId) => {
        this.assertLauncherSender(event)
        const currentWindow = BrowserWindow.fromWebContents(event.sender)
        if (!currentWindow) {
          return
        }

        presentLauncherWindow(currentWindow, presentationId)
      }
    )
  }

  private assertSearchSender(event: IpcMainInvokeEvent, request: unknown): void {
    this.assertMainFrame(event)

    if (getWindowIdentity(event.sender)?.kind === "launcher") {
      return
    }

    if (
      (getWindowIdentity(event.sender)?.kind === "main" ||
        getWindowIdentity(event.sender)?.kind === "thread-window") &&
      this.isMainThreadSearchRequest(request)
    ) {
      return
    }

    throw new Error(
      "Launcher search can only be invoked by the Launcher or Main window for thread-only search."
    )
  }

  private assertSearchCancellationSender(event: IpcMainInvokeEvent): void {
    this.assertMainFrame(event)
    const windowKind = getWindowIdentity(event.sender)?.kind
    if (windowKind === "launcher" || windowKind === "main" || windowKind === "thread-window") {
      return
    }

    throw new Error("Launcher search cancellation requires an authorized window sender.")
  }

  private assertLauncherSender(event: IpcMainInvokeEvent): void {
    this.assertMainFrame(event)

    if (getWindowIdentity(event.sender)?.kind !== "launcher") {
      throw new Error("Launcher commands can only be invoked by the Launcher window.")
    }
  }

  private assertMainFrame(event: IpcMainInvokeEvent): void {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Launcher commands can only be invoked from a window's main frame.")
    }
  }

  private isMainThreadSearchRequest(request: unknown): boolean {
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
