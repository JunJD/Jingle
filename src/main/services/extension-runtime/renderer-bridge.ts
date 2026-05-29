import type { WebContents } from "electron"
import type {
  ExtensionNavigationHostRequest,
  ExtensionRuntimeNavigationRequestEvent,
  ExtensionRuntimeNavigationResponse,
  ExtensionRuntimeToastRequestEvent,
  ExtensionToastPayload
} from "@shared/extension-runtime-protocol"

export const EXTENSION_RUNTIME_NAVIGATION_REQUEST_CHANNEL = "extensionRuntime:navigationRequest"
export const EXTENSION_RUNTIME_TOAST_REQUEST_CHANNEL = "extensionRuntime:toastRequest"

interface PendingNavigationRequest {
  reject: (error: Error) => void
  resolve: () => void
  sessionId: string
}

export class ExtensionRuntimeRendererBridge {
  private readonly pendingNavigationRequests = new Map<string, PendingNavigationRequest>()
  private readonly sessionOwners = new Map<string, WebContents>()

  bindSession(sessionId: string, webContents: WebContents): void {
    this.sessionOwners.set(sessionId, webContents)
    webContents.once("destroyed", () => {
      if (this.sessionOwners.get(sessionId) === webContents) {
        this.releaseSession(sessionId)
      }
    })
  }

  releaseSession(sessionId: string): void {
    this.sessionOwners.delete(sessionId)
    for (const [requestId, pending] of this.pendingNavigationRequests) {
      if (pending.sessionId !== sessionId) {
        continue
      }

      this.pendingNavigationRequests.delete(requestId)
      pending.reject(new Error(`Extension runtime session "${sessionId}" renderer detached.`))
    }
  }

  handleNavigationRequest(params: {
    request: ExtensionNavigationHostRequest
    sessionId: string
  }): Promise<void> {
    const { request, sessionId } = params
    const owner = this.sessionOwners.get(sessionId)
    if (!owner || owner.isDestroyed()) {
      throw new Error(`Extension runtime session "${sessionId}" has no renderer owner.`)
    }

    const pendingKey = getNavigationRequestKey(sessionId, request.id)

    return new Promise((resolve, reject) => {
      this.pendingNavigationRequests.set(pendingKey, {
        reject,
        resolve,
        sessionId
      })

      owner.send(EXTENSION_RUNTIME_NAVIGATION_REQUEST_CHANNEL, {
        request,
        sessionId
      } satisfies ExtensionRuntimeNavigationRequestEvent)
    })
  }

  completeNavigationRequest(
    sender: WebContents,
    response: ExtensionRuntimeNavigationResponse
  ): boolean {
    const owner = this.sessionOwners.get(response.sessionId)
    if (!owner || owner.isDestroyed() || owner.id !== sender.id) {
      return false
    }

    const pendingKey = getNavigationRequestKey(response.sessionId, response.requestId)
    const pending = this.pendingNavigationRequests.get(pendingKey)
    if (!pending || pending.sessionId !== response.sessionId) {
      return false
    }

    this.pendingNavigationRequests.delete(pendingKey)
    if (response.ok) {
      pending.resolve()
      return true
    }

    pending.reject(new Error(response.error.message))
    return true
  }

  showToast(params: { sessionId: string; toast: ExtensionToastPayload }): boolean {
    const { sessionId, toast } = params
    const owner = this.sessionOwners.get(sessionId)
    if (!owner || owner.isDestroyed()) {
      return false
    }

    owner.send(EXTENSION_RUNTIME_TOAST_REQUEST_CHANNEL, {
      sessionId,
      toast
    } satisfies ExtensionRuntimeToastRequestEvent)
    return true
  }
}

function getNavigationRequestKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`
}
