import type {
  ExtensionRuntimeEvent,
  ExtensionRuntimeLaunchContext,
  ExtensionRuntimeSessionError,
  ExtensionRuntimeSessionInfo,
  ExtensionSurfaceSnapshot
} from "@shared/extension-runtime-protocol"
import { invokeIpc, ipcRenderer } from "../ipc"

export interface ExtensionRuntimeSurfaceEvent {
  session: ExtensionRuntimeSessionInfo
  surface: ExtensionSurfaceSnapshot
}

export const extensionRuntimeApi = {
  startForeground: (
    context: ExtensionRuntimeLaunchContext
  ): Promise<ExtensionRuntimeSessionInfo> => {
    return invokeIpc("extensionRuntime:startForeground", context)
  },
  stopForeground: (sessionId?: string): Promise<boolean> => {
    return invokeIpc("extensionRuntime:stopForeground", sessionId)
  },
  sendEvent: (sessionId: string, event: ExtensionRuntimeEvent): Promise<boolean> => {
    return invokeIpc("extensionRuntime:sendEvent", sessionId, event)
  },
  subscribeSurfaces: (
    callback: (event: ExtensionRuntimeSurfaceEvent) => void,
    onError?: (error: ExtensionRuntimeSessionError) => void
  ): (() => void) => {
    let disposed = false
    const surfaceListener = (_event: unknown, payload: ExtensionRuntimeSurfaceEvent): void => {
      if (!disposed) {
        callback(payload)
      }
    }
    const errorListener = (_event: unknown, payload: ExtensionRuntimeSessionError): void => {
      if (!disposed) {
        onError?.(payload)
      }
    }

    ipcRenderer.on("extensionRuntime:surface", surfaceListener)
    ipcRenderer.on("extensionRuntime:error", errorListener)

    void invokeIpc("extensionRuntime:subscribeSurfaces").catch((error) => {
      console.error("[ExtensionRuntime] Failed to subscribe surfaces:", error)
    })

    return () => {
      if (disposed) {
        return
      }

      disposed = true
      ipcRenderer.removeListener("extensionRuntime:surface", surfaceListener)
      ipcRenderer.removeListener("extensionRuntime:error", errorListener)
      void invokeIpc("extensionRuntime:unsubscribeSurfaces").catch((error) => {
        console.error("[ExtensionRuntime] Failed to unsubscribe surfaces:", error)
      })
    }
  }
}
