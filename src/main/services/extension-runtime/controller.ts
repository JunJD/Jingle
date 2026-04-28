import type { IpcMain, WebContents } from "electron"
import type {
  ExtensionRuntimeEvent,
  ExtensionRuntimeLaunchContext
} from "@shared/extension-runtime-protocol"
import { registerIpcHandle } from "../../ipc/handle"
import { ExtensionRuntimeManager } from "./runtime-manager"

const SURFACE_CHANNEL = "extensionRuntime:surface"
const ERROR_CHANNEL = "extensionRuntime:error"

export class ExtensionRuntimeController {
  private readonly surfaceSubscribers = new Map<number, WebContents>()

  constructor(private readonly runtimeManager: ExtensionRuntimeManager) {
    this.runtimeManager.onSurface((surface, session) => {
      for (const subscriber of this.surfaceSubscribers.values()) {
        if (!subscriber.isDestroyed()) {
          subscriber.send(SURFACE_CHANNEL, { session, surface })
        }
      }
    })
    this.runtimeManager.onError((error) => {
      for (const subscriber of this.surfaceSubscribers.values()) {
        if (!subscriber.isDestroyed()) {
          subscriber.send(ERROR_CHANNEL, error)
        }
      }
    })
  }

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "extensionRuntime:subscribeSurfaces", (event) => {
      this.surfaceSubscribers.set(event.sender.id, event.sender)
      event.sender.once("destroyed", () => {
        this.surfaceSubscribers.delete(event.sender.id)
      })
    })

    registerIpcHandle(ipcMain, "extensionRuntime:unsubscribeSurfaces", (event) => {
      this.surfaceSubscribers.delete(event.sender.id)
    })

    registerIpcHandle(
      ipcMain,
      "extensionRuntime:startForeground",
      (_event, context: ExtensionRuntimeLaunchContext) => {
        return this.runtimeManager.startForeground(context)
      }
    )

    registerIpcHandle(ipcMain, "extensionRuntime:stopForeground", (_event, sessionId?: string) => {
      return this.runtimeManager.stopForeground(sessionId)
    })

    registerIpcHandle(
      ipcMain,
      "extensionRuntime:sendEvent",
      (_event, sessionId: string, runtimeEvent: ExtensionRuntimeEvent) => {
        return this.runtimeManager.sendEvent(sessionId, runtimeEvent)
      }
    )
  }
}
