import { EventEmitter } from "node:events"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import {
  PINNED_AI_SESSION_WINDOW_LIMIT,
  type OpenPinnedAiSessionWindowParams
} from "../../src/shared/ai-session-window"
import { AiSessionWindowsService } from "../../src/main/ai-session-windows/service"
import { AiSessionWindowsController } from "../../src/main/ai-session-windows/controller"

type IpcHandler = (event: IpcMainInvokeEvent, params: unknown) => unknown

class FakeIpcMain {
  private readonly handlers = new Map<string, IpcHandler>()

  handle(channel: string, handler: IpcHandler): void {
    this.handlers.set(channel, handler)
  }

  invoke(
    channel: string,
    sender: WebContents,
    params: unknown,
    senderFrame: unknown = sender.mainFrame
  ): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) {
      throw new Error(`Missing IPC handler: ${channel}`)
    }
    return Promise.resolve(handler({ sender, senderFrame } as IpcMainInvokeEvent, params))
  }
}

class FakeBrowserWindow extends EventEmitter {
  focusCount = 0
  private minimized = false
  private visible = true
  readonly webContents = {
    isDestroyed: () => false
  }

  close(): void {
    this.emit("closed")
  }

  focus(): void {
    this.focusCount += 1
  }

  isMinimized(): boolean {
    return this.minimized
  }

  isVisible(): boolean {
    return this.visible
  }

  restore(): void {
    this.minimized = false
  }

  show(): void {
    this.visible = true
  }
}

function createService(options?: {
  restorableThreadIds?: Set<string>
  restoreThreadIds?: string[]
  setRestoreState?: (state: { threadIds: string[] }) => { threadIds: string[] }
  setPinnedWindowThread?: (window: FakeBrowserWindow, threadId: string) => void
}): {
  createdWindows: FakeBrowserWindow[]
  getRestoreThreadIds: () => string[]
  restoreChecks: string[]
  service: AiSessionWindowsService
  updatedWindowThreads: Array<{ threadId: string; window: FakeBrowserWindow }>
} {
  const createdWindows: FakeBrowserWindow[] = []
  const restoreChecks: string[] = []
  const updatedWindowThreads: Array<{ threadId: string; window: FakeBrowserWindow }> = []
  let restoreThreadIds: string[] = options?.restoreThreadIds ?? []
  const service = new AiSessionWindowsService({
    canRestorePinnedAiSessionWindow: async (threadId) => {
      restoreChecks.push(threadId)
      return options?.restorableThreadIds?.has(threadId) ?? true
    },
    createPinnedAiSessionWindow: () => {
      const window = new FakeBrowserWindow()
      createdWindows.push(window)
      return window as never
    },
    getPinnedAiSessionWindowRestoreState: () => ({ threadIds: restoreThreadIds }),
    presentPinnedAiSessionWindow: (window) => window.focus(),
    setPinnedAiSessionWindowRestoreState: (state) => {
      restoreThreadIds = (options?.setRestoreState?.(state) ?? state).threadIds
      return { threadIds: restoreThreadIds }
    },
    setPinnedAiSessionWindowThreadId: (window, threadId) => {
      const fakeWindow = window as unknown as FakeBrowserWindow
      options?.setPinnedWindowThread?.(fakeWindow, threadId)
      updatedWindowThreads.push({ threadId, window: fakeWindow })
    }
  })

  return {
    createdWindows,
    getRestoreThreadIds: () => restoreThreadIds,
    restoreChecks,
    service,
    updatedWindowThreads
  }
}

function open(
  service: AiSessionWindowsService,
  threadId = "thread-1"
): ReturnType<AiSessionWindowsService["openPinnedWindow"]> {
  const params: OpenPinnedAiSessionWindowParams = {
    threadId
  }
  return service.openPinnedWindow(params)
}

describe("AiSessionWindowsService", () => {
  it("reuses the pinned window for the same thread and creates windows for distinct threads", () => {
    const { createdWindows, service } = createService()

    const first = open(service, "thread-1")
    const duplicate = open(service, "thread-1")
    const results = [first, duplicate, open(service, "thread-2"), open(service, "thread-3")]

    assert.equal(
      results.every((result) => result.ok),
      true
    )
    assert.equal(first.ok && duplicate.ok ? first.windowId === duplicate.windowId : false, true)
    assert.equal(createdWindows[0]?.focusCount, 1)
    assert.equal(createdWindows.length, PINNED_AI_SESSION_WINDOW_LIMIT)
  })

  it("rejects requests once the pinned window limit is reached", () => {
    const { createdWindows, service } = createService()

    for (let index = 0; index < PINNED_AI_SESSION_WINDOW_LIMIT; index += 1) {
      open(service, `thread-${index}`)
    }
    const result = open(service, "thread-over-limit")

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
      open(service, `thread-${index}`)
    }

    createdWindows[0]?.close()
    const result = open(service, "thread-after-close")

    assert.equal(result.ok, true)
    assert.equal(createdWindows.length, PINNED_AI_SESSION_WINDOW_LIMIT + 1)
  })

  it("records opened pinned windows and removes the record when a window closes", () => {
    const { createdWindows, getRestoreThreadIds, service } = createService()

    open(service, "thread-1")
    open(service, "thread-2")

    assert.deepEqual(getRestoreThreadIds(), ["thread-1", "thread-2"])

    createdWindows[0]?.close()

    assert.deepEqual(getRestoreThreadIds(), ["thread-2"])
  })

  it("keeps pinned window restore records when the application is quitting", () => {
    const { createdWindows, getRestoreThreadIds, service } = createService()

    open(service, "thread-1")
    service.markApplicationQuitting()
    createdWindows[0]?.close()

    assert.deepEqual(getRestoreThreadIds(), ["thread-1"])
  })

  it("restores valid pinned windows and drops stale restore targets", async () => {
    const { createdWindows, getRestoreThreadIds, restoreChecks, service } = createService({
      restorableThreadIds: new Set(["thread-1", "thread-3"]),
      restoreThreadIds: ["thread-1", "archived-thread", "thread-3"]
    })

    await service.restorePinnedWindows()

    assert.deepEqual(restoreChecks, ["thread-1", "archived-thread", "thread-3"])
    assert.equal(createdWindows.length, 2)
    assert.deepEqual(getRestoreThreadIds(), ["thread-1", "thread-3"])
  })

  it("updates a pinned window thread mapping when the current window switches sessions", () => {
    const { createdWindows, getRestoreThreadIds, service, updatedWindowThreads } = createService()

    const first = open(service, "thread-1")
    assert.equal(first.ok, true)
    assert.deepEqual(getRestoreThreadIds(), ["thread-1"])
    assert.equal(
      service.isPinnedWindowSender(
        first.ok ? first.windowId : "",
        createdWindows[0]?.webContents as never
      ),
      true
    )
    assert.equal(
      service.isPinnedWindowSender(first.ok ? first.windowId : "", {
        isDestroyed: () => false
      } as never),
      false
    )

    const result = service.updatePinnedWindowThread({
      threadId: "thread-2",
      windowId: first.ok ? first.windowId : ""
    })

    assert.deepEqual(result, { ok: true })
    assert.deepEqual(getRestoreThreadIds(), ["thread-2"])
    assert.deepEqual(updatedWindowThreads, [{ threadId: "thread-2", window: createdWindows[0] }])

    createdWindows[0]?.close()

    assert.deepEqual(getRestoreThreadIds(), [])
  })

  it("keeps the previous thread mapping when the trusted window binding update fails", () => {
    const { createdWindows, getRestoreThreadIds, service } = createService({
      setPinnedWindowThread: () => {
        throw new Error("binding update failed")
      }
    })
    const opened = open(service, "thread-1")
    assert.equal(opened.ok, true)

    assert.throws(
      () =>
        service.updatePinnedWindowThread({
          threadId: "thread-2",
          windowId: opened.ok ? opened.windowId : ""
        }),
      /binding update failed/
    )
    assert.deepEqual(getRestoreThreadIds(), ["thread-1"])

    createdWindows[0]?.close()
    assert.deepEqual(getRestoreThreadIds(), [])
  })

  it("keeps the trusted retarget committed when restore projection persistence fails", () => {
    let rejectRestoreProjection = false
    const { getRestoreThreadIds, service, updatedWindowThreads } = createService({
      setRestoreState: (state) => {
        if (rejectRestoreProjection) {
          throw new Error("restore projection failed")
        }
        return state
      }
    })
    const opened = open(service, "thread-1")
    assert.equal(opened.ok, true)
    rejectRestoreProjection = true

    assert.deepEqual(
      service.updatePinnedWindowThread({
        threadId: "thread-2",
        windowId: opened.ok ? opened.windowId : ""
      }),
      { ok: true }
    )
    assert.deepEqual(
      updatedWindowThreads.map(({ threadId }) => threadId),
      ["thread-2"]
    )
    assert.deepEqual(getRestoreThreadIds(), ["thread-1"])
    assert.deepEqual(
      service.updatePinnedWindowThread({
        threadId: "thread-2",
        windowId: opened.ok ? opened.windowId : ""
      }),
      { ok: true }
    )
  })

  it("focuses the existing pinned window when switching to a thread that is already open", () => {
    const { createdWindows, getRestoreThreadIds, service } = createService()

    const first = open(service, "thread-1")
    const second = open(service, "thread-2")

    const result = service.updatePinnedWindowThread({
      threadId: "thread-2",
      windowId: first.ok ? first.windowId : ""
    })

    assert.deepEqual(result, {
      ok: false,
      reason: "thread_already_open",
      windowId: second.ok ? second.windowId : ""
    })
    assert.equal(createdWindows[1]?.focusCount, 1)
    assert.deepEqual(getRestoreThreadIds(), ["thread-1", "thread-2"])
  })
})

it("rejects pinned thread reassignment from a different renderer", async () => {
  let updateCalls = 0
  const service = {
    isPinnedWindowSender: () => false,
    updatePinnedWindowThread: () => {
      updateCalls += 1
      return { ok: true as const }
    }
  }
  const controller = new AiSessionWindowsController(service as never)
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)

  const mainFrame = {}
  const sender = {
    isDestroyed: () => false,
    mainFrame
  } as WebContents
  await assert.rejects(
    ipcMain.invoke("ai-session-windows:updatePinnedThread", sender, {
      threadId: "thread-b",
      windowId: "window-a"
    }),
    /PERMISSION_DENIED/
  )
  assert.equal(updateCalls, 0)

  service.isPinnedWindowSender = () => true
  await assert.rejects(
    ipcMain.invoke(
      "ai-session-windows:updatePinnedThread",
      sender,
      { threadId: "thread-b", windowId: "window-a" },
      {}
    ),
    /PERMISSION_DENIED/
  )
  assert.equal(updateCalls, 0)

  assert.deepEqual(
    await ipcMain.invoke(
      "ai-session-windows:updatePinnedThread",
      sender,
      { threadId: "thread-b", windowId: "window-a" },
      mainFrame
    ),
    { ok: true }
  )
  assert.equal(updateCalls, 1)
})
