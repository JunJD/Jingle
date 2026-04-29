import type {
  ExtensionRuntimeEventAck,
  ExtensionRuntimeEvent,
  ExtensionRuntimeLaunchContext,
  ExtensionRuntimeNavigationRequestEvent,
  ExtensionRuntimeNavigationResponse,
  ExtensionRuntimeSessionError,
  ExtensionRuntimeSessionInfo,
  ExtensionSurfaceSnapshot
} from "@shared/extension-runtime-protocol"
import { invokeIpc, ipcRenderer } from "../ipc"

export interface ExtensionRuntimeSurfaceEvent {
  session: ExtensionRuntimeSessionInfo
  surface: ExtensionSurfaceSnapshot
}

export interface ExtensionRuntimeEventAckEvent {
  ack: ExtensionRuntimeEventAck
  session: ExtensionRuntimeSessionInfo
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
  completeNavigationRequest: (response: ExtensionRuntimeNavigationResponse): Promise<boolean> => {
    return invokeIpc("extensionRuntime:completeNavigationRequest", response)
  },
  subscribeEventAcks: (callback: (event: ExtensionRuntimeEventAckEvent) => void): (() => void) => {
    let disposed = false
    const listener = (_event: unknown, payload: ExtensionRuntimeEventAckEvent): void => {
      if (!disposed) {
        callback(payload)
      }
    }

    ipcRenderer.on("extensionRuntime:eventAck", listener)

    return () => {
      if (disposed) {
        return
      }

      disposed = true
      ipcRenderer.removeListener("extensionRuntime:eventAck", listener)
    }
  },
  subscribeNavigationRequests: (
    callback: (event: ExtensionRuntimeNavigationRequestEvent) => void
  ): (() => void) => {
    let disposed = false
    const listener = (_event: unknown, payload: ExtensionRuntimeNavigationRequestEvent): void => {
      if (!disposed) {
        callback(payload)
      }
    }

    ipcRenderer.on("extensionRuntime:navigationRequest", listener)

    return () => {
      if (disposed) {
        return
      }

      disposed = true
      ipcRenderer.removeListener("extensionRuntime:navigationRequest", listener)
    }
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
