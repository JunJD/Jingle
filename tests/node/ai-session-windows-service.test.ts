import { EventEmitter } from "node:events"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  PINNED_AI_SESSION_WINDOW_LIMIT,
  type OpenPinnedAiSessionWindowParams
} from "../../src/shared/ai-session-window"
import { AiSessionWindowsService } from "../../src/main/ai-session-windows/service"

class FakeBrowserWindow extends EventEmitter {
  close(): void {
    this.emit("closed")
  }
}

function createService(): {
  createdWindows: FakeBrowserWindow[]
  service: AiSessionWindowsService
} {
  const createdWindows: FakeBrowserWindow[] = []
  const service = new AiSessionWindowsService({
    createPinnedAiSessionWindow: () => {
      const window = new FakeBrowserWindow()
      createdWindows.push(window)
      return window as never
    }
  })

  return {
    createdWindows,
    service
  }
}

function open(
  service: AiSessionWindowsService
): ReturnType<AiSessionWindowsService["openPinnedWindow"]> {
  const params: OpenPinnedAiSessionWindowParams = {
    threadId: "thread-1"
  }
  return service.openPinnedWindow(params)
}

describe("AiSessionWindowsService", () => {
  it("creates a fresh pinned window for each request until the limit", () => {
    const { createdWindows, service } = createService()

    const results = Array.from({ length: PINNED_AI_SESSION_WINDOW_LIMIT }, () => open(service))

    assert.equal(
      results.every((result) => result.ok),
      true
    )
    assert.equal(new Set(results.map((result) => (result.ok ? result.windowId : ""))).size, 3)
    assert.equal(createdWindows.length, PINNED_AI_SESSION_WINDOW_LIMIT)
  })

  it("rejects requests once the pinned window limit is reached", () => {
    const { createdWindows, service } = createService()

    for (let index = 0; index < PINNED_AI_SESSION_WINDOW_LIMIT; index += 1) {
      open(service)
    }
    const result = open(service)

    assert.deepEqual(result, {
      limit: PINNED_AI_SESSION_WINDOW_LIMIT,
      ok: false,
      reason: "limit_reached"
    })
    assert.equal(createdWindows.length, PINNED_AI_SESSION_WINDOW_LIMIT)
  })

  it("releases a pinned window slot when the window closes", () => {
    const { createdWindows, service } = createService()

    for (let index = 0; index < PINNED_AI_SESSION_WINDOW_LIMIT; index += 1) {
      open(service)
    }

    createdWindows[0]?.close()
    const result = open(service)

    assert.equal(result.ok, true)
    assert.equal(createdWindows.length, PINNED_AI_SESSION_WINDOW_LIMIT + 1)
  })
})
