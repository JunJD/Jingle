import type {
  ExtensionRuntimeEventAck,
  ExtensionRuntimeEvent,
  ExtensionRuntimeForegroundStartRequest,
  ExtensionRuntimeNavigationRequestEvent,
  ExtensionRuntimeNavigationResponse,
  ExtensionRuntimeRunBotAgentRequestEvent,
  ExtensionRuntimeRunBotAgentResponse,
  ExtensionRuntimeRunOnceRequest,
  ExtensionRuntimeRunResult,
  ExtensionRuntimeSessionError,
  ExtensionRuntimeSessionInfo,
  ExtensionRuntimeToastRequestEvent,
  ExtensionSurfaceSnapshot
} from "@shared/extension-runtime-protocol"
import {
  normalizeExtensionRuntimeNavigationRequestEvent,
  normalizeExtensionRuntimeStartRequest
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

interface SurfaceSubscription {
  callback: (event: ExtensionRuntimeSurfaceEvent) => void
  onError?: (error: ExtensionRuntimeSessionError) => void
}

const surfaceSubscriptions = new Set<SurfaceSubscription>()

function handleSurfaceEvent(_event: unknown, payload: ExtensionRuntimeSurfaceEvent): void {
  for (const subscription of surfaceSubscriptions) {
    subscription.callback(payload)
  }
}

function handleSurfaceError(_event: unknown, payload: ExtensionRuntimeSessionError): void {
  for (const subscription of surfaceSubscriptions) {
    subscription.onError?.(payload)
  }
}

function addSurfaceSubscription(subscription: SurfaceSubscription): void {
  const shouldSubscribeMain = surfaceSubscriptions.size === 0
  surfaceSubscriptions.add(subscription)

  if (!shouldSubscribeMain) {
    return
  }

  ipcRenderer.on("extensionRuntime:surface", handleSurfaceEvent)
  ipcRenderer.on("extensionRuntime:error", handleSurfaceError)

  void invokeIpc("extensionRuntime:subscribeSurfaces").catch((error) => {
    console.error("[ExtensionRuntime] Failed to subscribe surfaces:", error)
  })
}

function removeSurfaceSubscription(subscription: SurfaceSubscription): void {
  if (!surfaceSubscriptions.delete(subscription) || surfaceSubscriptions.size > 0) {
    return
  }

  ipcRenderer.removeListener("extensionRuntime:surface", handleSurfaceEvent)
  ipcRenderer.removeListener("extensionRuntime:error", handleSurfaceError)
  void invokeIpc("extensionRuntime:unsubscribeSurfaces").catch((error) => {
    console.error("[ExtensionRuntime] Failed to unsubscribe surfaces:", error)
  })
}

export const extensionRuntimeApi = {
  startForeground: async (
    request: ExtensionRuntimeForegroundStartRequest
  ): Promise<ExtensionRuntimeSessionInfo> => {
    return invokeIpc(
      "extensionRuntime:startForeground",
      normalizeExtensionRuntimeStartRequest(request)
    )
  },
  runOnce: async (request: ExtensionRuntimeRunOnceRequest): Promise<ExtensionRuntimeRunResult> => {
    return invokeIpc("extensionRuntime:runOnce", normalizeExtensionRuntimeStartRequest(request))
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
  completeRunBotAgentRequest: (response: ExtensionRuntimeRunBotAgentResponse): Promise<boolean> => {
    return invokeIpc("extensionRuntime:completeRunBotAgentRequest", response)
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
      if (disposed) {
        return
      }

      try {
        callback(normalizeExtensionRuntimeNavigationRequestEvent(payload))
      } catch (error) {
        const requestId = payload?.request?.id
        const sessionId = payload?.sessionId
        if (typeof requestId !== "string" || typeof sessionId !== "string") {
          console.error("[ExtensionRuntime] Rejected invalid navigation request:", error)
          return
        }
        void invokeIpc("extensionRuntime:completeNavigationRequest", {
          error: {
            code: "navigation_payload_invalid",
            message: error instanceof Error ? error.message : String(error)
          },
          ok: false,
          requestId,
          sessionId
        } satisfies ExtensionRuntimeNavigationResponse).catch((reportError) => {
          console.error(
            "[ExtensionRuntime] Failed to report invalid navigation request:",
            reportError
          )
        })
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
  subscribeToastRequests: (
    callback: (event: ExtensionRuntimeToastRequestEvent) => void
  ): (() => void) => {
    let disposed = false
    const listener = (_event: unknown, payload: ExtensionRuntimeToastRequestEvent): void => {
      if (!disposed) {
        callback(payload)
      }
    }

    ipcRenderer.on("extensionRuntime:toastRequest", listener)

    return () => {
      if (disposed) {
        return
      }

      disposed = true
      ipcRenderer.removeListener("extensionRuntime:toastRequest", listener)
    }
  },
  subscribeRunBotAgentRequests: (
    callback: (event: ExtensionRuntimeRunBotAgentRequestEvent) => void
  ): (() => void) => {
    let disposed = false
    const listener = (_event: unknown, payload: ExtensionRuntimeRunBotAgentRequestEvent): void => {
      if (!disposed) {
        callback(payload)
      }
    }

    ipcRenderer.on("extensionRuntime:runBotAgentRequest", listener)

    return () => {
      if (disposed) {
        return
      }

      disposed = true
      ipcRenderer.removeListener("extensionRuntime:runBotAgentRequest", listener)
    }
  },
  subscribeSurfaces: (
    callback: (event: ExtensionRuntimeSurfaceEvent) => void,
    onError?: (error: ExtensionRuntimeSessionError) => void
  ): (() => void) => {
    let disposed = false
    const subscription = { callback, onError }
    addSurfaceSubscription(subscription)

    return () => {
      if (disposed) {
        return
      }

      disposed = true
      removeSurfaceSubscription(subscription)
    }
  }
}
