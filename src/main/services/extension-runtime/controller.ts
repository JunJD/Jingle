import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import type {
  ExtensionRuntimeEvent,
  ExtensionRuntimeForegroundStartRequest,
  ExtensionRuntimeNavigationResponse,
  ExtensionRuntimeRunBotAgentResponse,
  ExtensionRuntimeRunOnceRequest,
  ExtensionRuntimeRunResult
} from "@shared/extension-runtime-protocol"
import { normalizeExtensionRuntimeStartRequest } from "@shared/extension-runtime-protocol"
import { registerIpcHandle } from "../../ipc/handle"
import { ExtensionRuntimeRendererBridge } from "./renderer-bridge"
import { ExtensionRuntimeManager } from "./runtime-manager"

const SURFACE_CHANNEL = "extensionRuntime:surface"
const ERROR_CHANNEL = "extensionRuntime:error"
const ISSUE_SNAPSHOT_CHANNEL = "extensionRuntime:issueSnapshot"
const EVENT_ACK_CHANNEL = "extensionRuntime:eventAck"

export class ExtensionRuntimeController {
  private readonly surfaceSubscribers = new Map<number, WebContents>()
  private readonly surfaceSubscriberDestroyCleanups = new Map<number, () => void>()

  constructor(
    private readonly runtimeManager: ExtensionRuntimeManager,
    private readonly rendererBridge: ExtensionRuntimeRendererBridge,
    private readonly isAuthorizedRenderer: (webContents: WebContents) => boolean
  ) {
    this.rendererBridge.onSessionOwnerDetached((sessionId) => {
      this.runtimeManager.stopSessionById(sessionId, {
        code: "runtime_renderer_detached",
        message: "Extension runtime renderer owner detached."
      })
    })
    this.runtimeManager.onSurface((surface, session) => {
      this.sendSessionProjection(session.sessionId, SURFACE_CHANNEL, { session, surface })
    })
    this.runtimeManager.onError((error) => {
      this.sendSessionProjection(error.sessionId, ERROR_CHANNEL, error, false)
    })
    this.runtimeManager.onIssueSnapshot((snapshot) => {
      this.sendSessionProjection(
        snapshot.sessionId,
        ISSUE_SNAPSHOT_CHANNEL,
        snapshot,
        !snapshot.terminal
      )
    })
    this.runtimeManager.onSessionStopped((session) => {
      this.rendererBridge.releaseSession(session.sessionId)
    })
    this.runtimeManager.onEventAck((ack, session) => {
      this.sendSessionProjection(session.sessionId, EVENT_ACK_CHANNEL, { ack, session })
    })
  }

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "extensionRuntime:subscribeSurfaces", (event) => {
      this.assertAuthorizedRenderer(event)
      const senderId = event.sender.id
      this.surfaceSubscribers.set(senderId, event.sender)
      if (!this.surfaceSubscriberDestroyCleanups.has(senderId)) {
        const cleanup = () => {
          this.surfaceSubscribers.delete(senderId)
          this.surfaceSubscriberDestroyCleanups.delete(senderId)
        }
        this.surfaceSubscriberDestroyCleanups.set(senderId, cleanup)
        event.sender.once("destroyed", cleanup)
      }
      return this.runtimeManager
        .getIssueSnapshots()
        .filter((snapshot) => this.rendererBridge.isSessionOwner(snapshot.sessionId, event.sender))
    })

    registerIpcHandle(ipcMain, "extensionRuntime:unsubscribeSurfaces", (event) => {
      this.assertAuthorizedRenderer(event)
      const senderId = event.sender.id
      const cleanup = this.surfaceSubscriberDestroyCleanups.get(senderId)
      if (cleanup) {
        event.sender.removeListener("destroyed", cleanup)
        this.surfaceSubscriberDestroyCleanups.delete(senderId)
      }
      this.surfaceSubscribers.delete(senderId)
    })

    registerIpcHandle(
      ipcMain,
      "extensionRuntime:startForeground",
      async (event, request: ExtensionRuntimeForegroundStartRequest) => {
        this.assertAuthorizedRenderer(event)
        const normalizedRequest = normalizeExtensionRuntimeStartRequest(request)
        return this.runtimeManager.startForeground(normalizedRequest.intent, {
          onSessionStart: (startedSession) => {
            this.rendererBridge.bindSession(startedSession.sessionId, event.sender)
          },
          sessionId: normalizedRequest.sessionId
        })
      }
    )

    registerIpcHandle(
      ipcMain,
      "extensionRuntime:runOnce",
      async (
        event,
        request: ExtensionRuntimeRunOnceRequest
      ): Promise<ExtensionRuntimeRunResult> => {
        this.assertAuthorizedRenderer(event)
        const normalizedRequest = normalizeExtensionRuntimeStartRequest(request)
        return this.runtimeManager.runOnce(normalizedRequest.intent, {
          onSessionStart: (session) => {
            this.rendererBridge.bindSession(session.sessionId, event.sender)
          },
          sessionId: normalizedRequest.sessionId
        })
      }
    )

    registerIpcHandle(ipcMain, "extensionRuntime:stopForeground", (event, sessionId?: string) => {
      this.assertAuthorizedRenderer(event)
      const targetSessionId = sessionId ?? this.runtimeManager.getForegroundSession()?.sessionId
      if (!targetSessionId) {
        return false
      }
      if (!this.rendererBridge.isSessionOwner(targetSessionId, event.sender)) {
        return false
      }
      return this.runtimeManager.stopForeground(targetSessionId)
    })

    registerIpcHandle(
      ipcMain,
      "extensionRuntime:sendEvent",
      (event, sessionId: string, runtimeEvent: ExtensionRuntimeEvent) => {
        this.assertAuthorizedRenderer(event)
        if (!this.rendererBridge.isSessionOwner(sessionId, event.sender)) {
          return false
        }
        return this.runtimeManager.sendEvent(sessionId, runtimeEvent)
      }
    )

    registerIpcHandle(
      ipcMain,
      "extensionRuntime:discardStorageIssue",
      (event, sessionId: string, issueId: string) => {
        this.assertAuthorizedRenderer(event)
        if (
          typeof sessionId !== "string" ||
          typeof issueId !== "string" ||
          !/^storage-legacy-unowned:[a-f0-9]{64}$/.test(issueId) ||
          !this.rendererBridge.isSessionOwner(sessionId, event.sender)
        ) {
          return false
        }
        return this.runtimeManager.discardStorageIssue(sessionId, issueId)
      }
    )

    registerIpcHandle(
      ipcMain,
      "extensionRuntime:completeNavigationRequest",
      (event, response: ExtensionRuntimeNavigationResponse) => {
        this.assertAuthorizedRenderer(event)
        return this.rendererBridge.completeNavigationRequest(event.sender, response)
      }
    )

    registerIpcHandle(
      ipcMain,
      "extensionRuntime:completeRunBotAgentRequest",
      (event, response: ExtensionRuntimeRunBotAgentResponse) => {
        this.assertAuthorizedRenderer(event)
        return this.rendererBridge.completeRunBotAgentRequest(event.sender, response)
      }
    )
  }

  private sendSessionProjection(
    sessionId: string,
    channel: string,
    payload: unknown,
    stopOnFailure = true
  ): void {
    const owner = this.rendererBridge.getSessionOwner(sessionId)
    if (!owner || this.surfaceSubscribers.get(owner.id) !== owner) {
      return
    }

    try {
      owner.send(channel, payload)
    } catch (error) {
      console.error("[jingle:extension-runtime] Renderer projection failed", error)
      this.rendererBridge.releaseSession(sessionId)
      if (stopOnFailure) {
        this.runtimeManager.stopSessionById(sessionId, {
          code: "runtime_renderer_transport_failed",
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  private assertAuthorizedRenderer(event: IpcMainInvokeEvent): void {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Extension runtime IPC is only available to the renderer main frame.")
    }
    if (!this.isAuthorizedRenderer(event.sender)) {
      throw new Error("Extension runtime IPC is only available to the Launcher window.")
    }
  }
}
