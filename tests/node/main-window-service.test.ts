import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { describe, it } from "node:test"
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { DurableWindowController } from "../../src/main/main-window/controller"
import { PrimaryMainWindowService } from "../../src/main/main-window/service"
import { registerWindowIdentity } from "../../src/main/windows/window-identity"
import {
  DurableWindowRestoreGate,
  DurableWindowRestorePolicy
} from "../../src/main/durable-window/restore-policy"

class FakeIpcMain {
  handlers = new Map<string, (event: IpcMainInvokeEvent, params?: unknown) => unknown>()
  handle(channel: string, handler: (event: IpcMainInvokeEvent, params?: unknown) => unknown): void {
    this.handlers.set(channel, handler)
  }
}

class FakeWindow extends EventEmitter {
  focusCount = 0
  minimized = false
  visible = true
  destroyed = false
  sent: unknown[] = []
  webContents = {
    isDestroyed: () => false,
    send: (_channel: string, value: unknown) => this.sent.push(value)
  }
  focus(): void {
    this.focusCount += 1
  }
  isDestroyed(): boolean {
    return this.destroyed
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

describe("PrimaryMainWindowService", () => {
  it("reuses one window and rebinds it to the requested thread", () => {
    const windows: FakeWindow[] = []
    const bindings: string[] = []
    let state = { version: 1 as const, lastActiveThreadId: null as string | null }
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: () => {
          const window = new FakeWindow()
          windows.push(window)
          return window as never
        },
        getSessionState: () => state,
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        repairSessionThreadBinding: () => ({ repaired: false, state }),
        setSessionState: (next) => (state = next),
        setWindowThread: (_window, threadId) => bindings.push(threadId)
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) }),
      new DurableWindowRestoreGate()
    )

    service.open({ threadId: "thread-a" })
    service.bindSenderThread(windows[0]!.webContents as never, "thread-a")
    service.open({ threadId: "thread-b" })

    assert.equal(windows.length, 1)
    assert.deepEqual(bindings, ["thread-b"])
    assert.equal(state.lastActiveThreadId, "thread-b")
    assert.deepEqual(windows[0]?.sent, [{ threadId: "thread-b" }])
  })

  it("only accepts thread binding from the singleton sender", () => {
    let state = { version: 1 as const, lastActiveThreadId: null as string | null }
    const window = new FakeWindow()
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: () => window as never,
        getSessionState: () => state,
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        repairSessionThreadBinding: () => ({ repaired: false, state }),
        setSessionState: (next) => (state = next),
        setWindowThread: () => {}
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) }),
      new DurableWindowRestoreGate()
    )
    service.open()
    assert.throws(() => service.bindSenderThread({} as never, "thread-a"), /registered Main window/)
    service.bindSenderThread(window.webContents as never, "thread-a")
    assert.equal(state.lastActiveThreadId, "thread-a")
  })

  it("restores an active persisted Main binding after thread lookup", async () => {
    const createdThreadIds: Array<string | null> = []
    const state = { version: 1 as const, lastActiveThreadId: "thread-active" }
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: (threadId) => {
          createdThreadIds.push(threadId)
          return new FakeWindow() as never
        },
        getSessionState: () => state,
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        repairSessionThreadBinding: () => ({ repaired: false, state }),
        setSessionState: () => state,
        setWindowThread: () => {}
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) }),
      new DurableWindowRestoreGate()
    )

    service.open()
    assert.deepEqual(createdThreadIds, [])
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.deepEqual(createdThreadIds, ["thread-active"])
  })

  it("repairs an archived Main binding before creating an unbound window", async () => {
    const events: string[] = []
    let state = { version: 1 as const, lastActiveThreadId: "thread-archived" as string | null }
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: (threadId) => {
          events.push(`create:${String(threadId)}`)
          return new FakeWindow() as never
        },
        getSessionState: () => state,
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: (details) => {
          events.push(`diagnostic:${details.archivedBindingCount}`)
        },
        repairSessionThreadBinding: (staleThreadId) => {
          if (state.lastActiveThreadId !== staleThreadId) {
            return { repaired: false, state }
          }
          state = { ...state, lastActiveThreadId: null }
          events.push("repair")
          return { repaired: true, state }
        },
        setSessionState: (next) => (state = next),
        setWindowThread: () => {}
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: Date.now() }) }),
      new DurableWindowRestoreGate()
    )

    service.open()
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.equal(state.lastActiveThreadId, null)
    assert.deepEqual(events, ["repair", "diagnostic:1", "create:null"])
  })

  it("does not create a Main window after application quit begins during lookup", async () => {
    const createdThreadIds: Array<string | null> = []
    const state = { version: 1 as const, lastActiveThreadId: "thread-active" }
    let resolveThread: (value: { archivedAt: number | null }) => void = () => {
      throw new Error("Thread lookup resolver was not installed.")
    }
    const restoreGate = new DurableWindowRestoreGate()
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: (threadId) => {
          createdThreadIds.push(threadId)
          return new FakeWindow() as never
        },
        getSessionState: () => state,
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        repairSessionThreadBinding: () => ({ repaired: false, state }),
        setSessionState: () => state,
        setWindowThread: () => {}
      },
      new DurableWindowRestorePolicy({
        getThread: () =>
          new Promise((resolve) => {
            resolveThread = resolve
          })
      }),
      restoreGate
    )

    service.open()
    restoreGate.markApplicationQuitting()
    resolveThread({ archivedAt: null })
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.deepEqual(createdThreadIds, [])
  })
})

it("durable-window open IPC admits only registered Launcher and durable main frames", async () => {
  let openCount = 0
  const controller = new DurableWindowController(
    {
      open: () => {
        openCount += 1
      }
    } as never,
    {} as never
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const handler = ipcMain.handlers.get("durable-window:openPrimary")
  assert.ok(handler)

  const invoke = async (
    kind: "launcher" | "main" | "settings",
    mainFrame = true
  ): Promise<void> => {
    const frame = {}
    const sender = { isDestroyed: () => false, mainFrame: frame } as unknown as WebContents
    registerWindowIdentity(
      sender,
      kind === "main" ? { kind, threadId: null, windowId: "primary-main" } : { kind }
    )
    await handler({ sender, senderFrame: mainFrame ? frame : {} } as IpcMainInvokeEvent, {})
  }

  await invoke("launcher")
  await invoke("main")
  await assert.rejects(invoke("settings"), /Only the Launcher or a durable window/)
  await assert.rejects(invoke("launcher", false), /Only the Launcher or a durable window/)
  assert.equal(openCount, 2)
})
