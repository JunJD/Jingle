import type { IpcMain, WebContents } from "electron"
import type {
  ExtensionRuntimeEvent,
  ExtensionRuntimeLaunchContext,
  ExtensionRuntimeNavigationResponse,
  ExtensionRuntimeRunResult
} from "@shared/extension-runtime-protocol"
import { registerIpcHandle } from "../../ipc/handle"
import { ExtensionRuntimeRendererBridge } from "./renderer-bridge"
import { ExtensionRuntimeManager } from "./runtime-manager"

const SURFACE_CHANNEL = "extensionRuntime:surface"
const ERROR_CHANNEL = "extensionRuntime:error"
const EVENT_ACK_CHANNEL = "extensionRuntime:eventAck"
const RUN_ONCE_SESSION_CHANNEL = "extensionRuntime:runOnceSession"

export class ExtensionRuntimeController {
  private readonly surfaceSubscribers = new Map<number, WebContents>()

  constructor(
    private readonly runtimeManager: ExtensionRuntimeManager,
    private readonly rendererBridge: ExtensionRuntimeRendererBridge
  ) {
    this.runtimeManager.onSurface((surface, session) => {
      for (const subscriber of this.surfaceSubscribers.values()) {
        if (!subscriber.isDestroyed()) {
          subscriber.send(SURFACE_CHANNEL, { session, surface })
        }
      }
    })
    this.runtimeManager.onError((error) => {
      this.rendererBridge.releaseSession(error.sessionId)
      for (const subscriber of this.surfaceSubscribers.values()) {
        if (!subscriber.isDestroyed()) {
          subscriber.send(ERROR_CHANNEL, error)
        }
      }
    })
    this.runtimeManager.onEventAck((ack, session) => {
      for (const subscriber of this.surfaceSubscribers.values()) {
        if (!subscriber.isDestroyed()) {
          subscriber.send(EVENT_ACK_CHANNEL, { ack, session })
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
      async (event, context: ExtensionRuntimeLaunchContext) => {
        const previousSessionId = this.runtimeManager.getForegroundSession()?.sessionId
        const session = await this.runtimeManager.startForeground(context)
        if (previousSessionId) {
          this.rendererBridge.releaseSession(previousSessionId)
        }
        this.rendererBridge.bindSession(session.sessionId, event.sender)
        return session
      }
    )

    registerIpcHandle(
      ipcMain,
      "extensionRuntime:runOnce",
      async (event, context: ExtensionRuntimeLaunchContext): Promise<ExtensionRuntimeRunResult> => {
        let sessionId: string | null = null
        try {
          return await this.runtimeManager.runOnce(context, {
            onSessionStart: (session) => {
              sessionId = session.sessionId
              this.rendererBridge.bindSession(session.sessionId, event.sender)
              event.sender.send(RUN_ONCE_SESSION_CHANNEL, session)
            }
          })
        } finally {
          if (sessionId) {
            this.rendererBridge.releaseSession(sessionId)
          }
        }
      }
    )

    registerIpcHandle(ipcMain, "extensionRuntime:stopForeground", (_event, sessionId?: string) => {
      const stoppedSessionId = sessionId ?? this.runtimeManager.getForegroundSession()?.sessionId
      const stopped = this.runtimeManager.stopForeground(sessionId)
      if (stopped && stoppedSessionId) {
        this.rendererBridge.releaseSession(stoppedSessionId)
      }
      return stopped
    })

    registerIpcHandle(
      ipcMain,
      "extensionRuntime:sendEvent",
      (_event, sessionId: string, runtimeEvent: ExtensionRuntimeEvent) => {
        return this.runtimeManager.sendEvent(sessionId, runtimeEvent)
      }
    )

    registerIpcHandle(
      ipcMain,
      "extensionRuntime:completeNavigationRequest",
      (event, response: ExtensionRuntimeNavigationResponse) => {
        return this.rendererBridge.completeNavigationRequest(event.sender, response)
      }
    )
  }
}
