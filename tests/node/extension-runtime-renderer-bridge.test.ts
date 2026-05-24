import assert from "node:assert/strict"
import test from "node:test"
import type { WebContents } from "electron"
import {
  EXTENSION_RUNTIME_NAVIGATION_REQUEST_CHANNEL,
  ExtensionRuntimeRendererBridge
} from "../../src/main/services/extension-runtime/renderer-bridge"
import type {
  ExtensionNavigationHostRequest,
  ExtensionRuntimeNavigationRequestEvent
} from "../../src/shared/extension-runtime-protocol"

class FakeWebContents {
  destroyed = false
  sentMessages: Array<{
    channel: string
    payload: ExtensionRuntimeNavigationRequestEvent
  }> = []
  private readonly destroyedListeners = new Set<() => void>()

  constructor(readonly id = 1) {}

  destroy(): void {
    this.destroyed = true
    for (const listener of this.destroyedListeners) {
      listener()
    }
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  once(eventName: "destroyed", listener: () => void): this {
    if (eventName === "destroyed") {
      this.destroyedListeners.add(listener)
    }
    return this
  }

  send(channel: string, payload: ExtensionRuntimeNavigationRequestEvent): void {
    this.sentMessages.push({ channel, payload })
  }
}

function createNavigationRequest(): ExtensionNavigationHostRequest {
  return {
    capability: "navigation",
    id: "navigation-1",
    method: "open-command",
    payload: {
      commandName: "my-pull-requests",
      extensionName: "github"
    }
  }
}

test("runtime renderer bridge sends navigation requests to the owning renderer", async () => {
  const bridge = new ExtensionRuntimeRendererBridge()
  const webContents = new FakeWebContents()
  const request = createNavigationRequest()

  bridge.bindSession("session-1", webContents as unknown as WebContents)
  const requestPromise = bridge.handleNavigationRequest({
    request,
    sessionId: "session-1"
  })

  assert.deepEqual(webContents.sentMessages, [
    {
      channel: EXTENSION_RUNTIME_NAVIGATION_REQUEST_CHANNEL,
      payload: {
        request,
        sessionId: "session-1"
      }
    }
  ])
  assert.equal(
    bridge.completeNavigationRequest(webContents as unknown as WebContents, {
      ok: true,
      requestId: "navigation-1",
      sessionId: "session-1"
    }),
    true
  )
  await requestPromise
})

test("runtime renderer bridge only accepts navigation completion from the owning renderer", async () => {
  const bridge = new ExtensionRuntimeRendererBridge()
  const owner = new FakeWebContents(1)
  const other = new FakeWebContents(2)

  bridge.bindSession("session-1", owner as unknown as WebContents)
  const requestPromise = bridge.handleNavigationRequest({
    request: createNavigationRequest(),
    sessionId: "session-1"
  })

  assert.equal(
    bridge.completeNavigationRequest(other as unknown as WebContents, {
      ok: true,
      requestId: "navigation-1",
      sessionId: "session-1"
    }),
    false
  )
  assert.equal(
    bridge.completeNavigationRequest(owner as unknown as WebContents, {
      ok: true,
      requestId: "navigation-1",
      sessionId: "session-1"
    }),
    true
  )
  await requestPromise
})

test("runtime renderer bridge rejects pending navigation when the owner detaches", async () => {
  const bridge = new ExtensionRuntimeRendererBridge()
  const webContents = new FakeWebContents()

  bridge.bindSession("session-1", webContents as unknown as WebContents)
  const requestPromise = bridge.handleNavigationRequest({
    request: createNavigationRequest(),
    sessionId: "session-1"
  })
  const rejection = assert.rejects(requestPromise, /renderer detached/)
  webContents.destroy()

  await rejection
})

test("runtime renderer bridge requires an owner for navigation requests", () => {
  const bridge = new ExtensionRuntimeRendererBridge()

  assert.throws(
    () =>
      bridge.handleNavigationRequest({
        request: createNavigationRequest(),
        sessionId: "missing-session"
      }),
    /no renderer owner/
  )
})
