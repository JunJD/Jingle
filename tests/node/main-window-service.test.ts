import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { describe, it } from "node:test"
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import {
  MAIN_WINDOW_THREAD_BINDING_CHANGED_CHANNEL,
  MAIN_WINDOW_THREAD_BINDING_GET_CHANNEL
} from "../../src/shared/durable-window"
import { DurableWindowController } from "../../src/main/main-window/controller"
import { PrimaryMainWindowService } from "../../src/main/main-window/service"
import {
  getDurableWindowCallerLease,
  getWindowIdentity,
  registerDurableWindowIdentity,
  registerWindowIdentity,
  setDurableWindowIdentityThread
} from "../../src/main/windows/window-identity"
import {
  DurableWindowRestoreGate,
  DurableWindowRestorePolicy
} from "../../src/main/durable-window/restore-policy"
import { parseSerializedIpcErrorMessage } from "../../src/shared/ipc-error"

class FakeIpcMain {
  handlers = new Map<string, (event: IpcMainInvokeEvent, ...params: unknown[]) => unknown>()
  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...params: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, handler)
  }
}

async function assertInvalidArgument(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof Error)
    return parseSerializedIpcErrorMessage(error.message)?.code === "INVALID_ARGUMENT"
  })
}

class FakeWindow extends EventEmitter {
  focusCount = 0
  minimized = false
  visible = true
  destroyed = false
  sent: unknown[] = []
  webContents = {
    isDestroyed: () => false,
    send: (channel: string, value: unknown) => this.sent.push({ channel, value })
  }
  focus(): void {
    this.focusCount += 1
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    const emitWebContents = (this.webContents as { emit?: (event: string) => void }).emit
    emitWebContents?.call(this.webContents, "destroyed")
    this.emit("closed")
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

class DeferredCloseWindow extends FakeWindow {
  override destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    const emitWebContents = (this.webContents as { emit?: (event: string) => void }).emit
    emitWebContents?.call(this.webContents, "destroyed")
  }
  finishClose(): void {
    this.emit("closed")
  }
}

describe("PrimaryMainWindowService", () => {
  it("reuses one window and rebinds it to the requested thread", () => {
    const windows: FakeWindow[] = []
    const bindings: string[] = []
    let windowThreadId: string | null = null
    let state = { version: 1 as const, lastActiveThreadId: null as string | null }
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: (threadId) => {
          const window = new FakeWindow()
          windowThreadId = threadId
          windows.push(window)
          return window as never
        },
        getSessionState: () => state,
        getWindowBinding: () => ({ kind: "main", threadId: windowThreadId }),
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        repairSessionThreadBinding: () => ({ repaired: false, state }),
        setSessionState: (next) => (state = next),
        setWindowThread: (_window, threadId) => {
          windowThreadId = threadId
          bindings.push(threadId)
        }
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) }),
      new DurableWindowRestoreGate()
    )

    service.open({ threadId: "thread-a" })
    const initial = service.getSenderThreadBinding(windows[0]!.webContents as never)
    const unchanged = service.bindSenderThread(windows[0]!.webContents as never, "thread-a")
    service.open({ threadId: "thread-b" })

    assert.equal(windows.length, 1)
    assert.deepEqual(initial, { revision: 1, threadId: "thread-a" })
    assert.deepEqual(unchanged, initial)
    assert.deepEqual(bindings, ["thread-b"])
    assert.equal(state.lastActiveThreadId, "thread-b")
    assert.deepEqual(windows[0]?.sent, [
      {
        channel: MAIN_WINDOW_THREAD_BINDING_CHANGED_CHANNEL,
        value: { revision: 2, threadId: "thread-b" }
      }
    ])
  })

  it("only accepts thread binding from the singleton sender", () => {
    let state = { version: 1 as const, lastActiveThreadId: null as string | null }
    let windowThreadId: string | null = null
    const window = new FakeWindow()
    const restoreGate = new DurableWindowRestoreGate()
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: (threadId) => {
          windowThreadId = threadId
          return window as never
        },
        getSessionState: () => state,
        getWindowBinding: () => ({ kind: "main", threadId: windowThreadId }),
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        repairSessionThreadBinding: () => ({ repaired: false, state }),
        setSessionState: (next) => (state = next),
        setWindowThread: (_window, threadId) => {
          windowThreadId = threadId
        }
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) }),
      restoreGate
    )
    service.open()
    assert.throws(() => service.bindSenderThread({} as never, "thread-a"), /registered Main window/)
    const snapshot = service.bindSenderThread(window.webContents as never, "thread-a")
    assert.equal(state.lastActiveThreadId, "thread-a")
    assert.deepEqual(snapshot, { revision: 2, threadId: "thread-a" })

    restoreGate.markApplicationQuitting()
    assert.throws(
      () => service.bindSenderThread(window.webContents as never, "thread-b"),
      /after application quit begins/
    )
    assert.equal(windowThreadId, "thread-a")
    assert.equal(state.lastActiveThreadId, "thread-a")
  })

  it("advances the binding revision when a new Main window incarnation is created", () => {
    const windows: FakeWindow[] = []
    let state = { version: 1 as const, lastActiveThreadId: null as string | null }
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: () => {
          const window = new FakeWindow()
          windows.push(window)
          return window as never
        },
        getSessionState: () => state,
        getWindowBinding: () => ({ kind: "main", threadId: state.lastActiveThreadId }),
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

    service.open({ threadId: "thread-a" })
    assert.deepEqual(service.getSenderThreadBinding(windows[0]!.webContents as never), {
      revision: 1,
      threadId: "thread-a"
    })
    windows[0]!.emit("closed")
    service.open({ threadId: "thread-a" })
    assert.deepEqual(service.getSenderThreadBinding(windows[1]!.webContents as never), {
      revision: 2,
      threadId: "thread-a"
    })
  })

  it("publishes the authoritative binding when session persistence rejects a rebind", () => {
    const window = new FakeWindow()
    const bindings: string[] = []
    let windowThreadId: string | null = null
    let rejectSessionWrite = false
    let state = { version: 1 as const, lastActiveThreadId: null as string | null }
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: (threadId) => {
          windowThreadId = threadId
          return window as never
        },
        getSessionState: () => state,
        getWindowBinding: () => ({ kind: "main", threadId: windowThreadId }),
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        repairSessionThreadBinding: () => ({ repaired: false, state }),
        setSessionState: (next) => {
          if (rejectSessionWrite) throw new Error("session write failed")
          state = next
          return state
        },
        setWindowThread: (_window, threadId) => {
          windowThreadId = threadId
          bindings.push(threadId)
        }
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) }),
      new DurableWindowRestoreGate()
    )

    service.open({ threadId: "thread-a" })
    rejectSessionWrite = true
    assert.throws(
      () => service.bindSenderThread(window.webContents as never, "thread-b"),
      /session write failed/
    )
    assert.deepEqual(service.getSenderThreadBinding(window.webContents as never), {
      revision: 2,
      threadId: "thread-b"
    })
    assert.equal(state.lastActiveThreadId, "thread-a")
    assert.deepEqual(bindings, ["thread-b"])
    assert.deepEqual(window.sent, [
      {
        channel: MAIN_WINDOW_THREAD_BINDING_CHANGED_CHANNEL,
        value: { revision: 2, threadId: "thread-b" }
      }
    ])

    rejectSessionWrite = false
    assert.deepEqual(service.bindSenderThread(window.webContents as never, "thread-b"), {
      revision: 2,
      threadId: "thread-b"
    })
    assert.equal(state.lastActiveThreadId, "thread-b")
  })

  it("keeps the previous binding when the window identity rejects before mutation", () => {
    const window = new FakeWindow()
    let rejectIdentityWrite = false
    let state = { version: 1 as const, lastActiveThreadId: null as string | null }
    let windowThreadId: string | null = null
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: (threadId) => {
          windowThreadId = threadId
          return window as never
        },
        getSessionState: () => state,
        getWindowBinding: () => ({ kind: "main", threadId: windowThreadId }),
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        repairSessionThreadBinding: () => ({ repaired: false, state }),
        setSessionState: (next) => (state = next),
        setWindowThread: (_window, threadId) => {
          if (rejectIdentityWrite) throw new Error("identity write failed")
          windowThreadId = threadId
        }
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) }),
      new DurableWindowRestoreGate()
    )

    service.open({ threadId: "thread-a" })
    rejectIdentityWrite = true
    assert.throws(
      () => service.bindSenderThread(window.webContents as never, "thread-b"),
      /identity write failed/
    )
    assert.deepEqual(service.getSenderThreadBinding(window.webContents as never), {
      revision: 1,
      threadId: "thread-a"
    })
    assert.equal(state.lastActiveThreadId, "thread-a")
    assert.deepEqual(window.sent, [])
  })

  it("adopts a nested authoritative identity when it supersedes a rebind", () => {
    const window = new FakeWindow()
    const webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => window.destroyed,
      send: (channel: string, value: unknown) => window.sent.push({ channel, value })
    })
    ;(window as unknown as { webContents: typeof webContents }).webContents = webContents
    let state = { version: 1 as const, lastActiveThreadId: null as string | null }
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: (threadId) => {
          registerDurableWindowIdentity(webContents as never, {
            kind: "main",
            threadId,
            windowId: "primary-main"
          })
          return window as never
        },
        getSessionState: () => state,
        getWindowBinding: () => {
          const identity = getWindowIdentity(webContents as never)
          return identity?.kind === "main"
            ? { kind: "main", threadId: identity.threadId }
            : { kind: "replaced" }
        },
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        repairSessionThreadBinding: () => ({ repaired: false, state }),
        setSessionState: (next) => (state = next),
        setWindowThread: (_window, threadId) =>
          setDurableWindowIdentityThread(webContents as never, threadId)
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) }),
      new DurableWindowRestoreGate()
    )

    service.open({ threadId: "thread-a" })
    const originalLease = getDurableWindowCallerLease(webContents as never)
    assert.ok(originalLease)
    originalLease.signal.addEventListener(
      "abort",
      () => setDurableWindowIdentityThread(webContents as never, "thread-c"),
      { once: true }
    )

    assert.throws(
      () => service.bindSenderThread(webContents as never, "thread-b"),
      /changed during revocation/
    )
    assert.deepEqual(service.getSenderThreadBinding(webContents as never), {
      revision: 2,
      threadId: "thread-c"
    })
    assert.equal(state.lastActiveThreadId, "thread-c")
    const identity = getWindowIdentity(webContents as never)
    assert.equal(identity?.kind, "main")
    assert.equal(identity?.kind === "main" ? identity.threadId : null, "thread-c")
    assert.equal(getDurableWindowCallerLease(webContents as never)?.threadId, "thread-c")
    assert.deepEqual(window.sent, [
      {
        channel: MAIN_WINDOW_THREAD_BINDING_CHANGED_CHANNEL,
        value: { revision: 2, threadId: "thread-c" }
      }
    ])
  })

  it("closes Main when a nested durable identity replaces its window kind", () => {
    const window = new FakeWindow()
    const webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => window.destroyed,
      send: (channel: string, value: unknown) => window.sent.push({ channel, value })
    })
    ;(window as unknown as { webContents: typeof webContents }).webContents = webContents
    let closeCount = 0
    let state = { version: 1 as const, lastActiveThreadId: null as string | null }
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: (threadId) => {
          registerDurableWindowIdentity(webContents as never, {
            kind: "main",
            threadId,
            windowId: "primary-main"
          })
          return window as never
        },
        getSessionState: () => state,
        getWindowBinding: () => {
          const identity = getWindowIdentity(webContents as never)
          return identity?.kind === "main"
            ? { kind: "main", threadId: identity.threadId }
            : { kind: "replaced" }
        },
        onWindowClosed: () => {
          closeCount += 1
        },
        onWindowOpened: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        repairSessionThreadBinding: () => ({ repaired: false, state }),
        setSessionState: (next) => (state = next),
        setWindowThread: (_window, threadId) =>
          setDurableWindowIdentityThread(webContents as never, threadId)
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) }),
      new DurableWindowRestoreGate()
    )

    service.open({ threadId: "thread-a" })
    const originalLease = getDurableWindowCallerLease(webContents as never)
    assert.ok(originalLease)
    originalLease.signal.addEventListener(
      "abort",
      () =>
        registerDurableWindowIdentity(webContents as never, {
          kind: "thread-window",
          threadId: "thread-c",
          windowId: "window-c"
        }),
      { once: true }
    )

    assert.throws(
      () => service.bindSenderThread(webContents as never, "thread-b"),
      /changed during revocation/
    )
    assert.equal(window.destroyed, true)
    assert.equal(closeCount, 1)
    assert.equal(state.lastActiveThreadId, "thread-a")
    assert.equal(getWindowIdentity(webContents as never), null)
    assert.equal(getDurableWindowCallerLease(webContents as never), null)
    assert.throws(
      () => service.getSenderThreadBinding(webContents as never),
      /registered Main window/
    )
    assert.deepEqual(window.sent, [])
  })

  it("does not let a delayed closed event clear a newer Main incarnation", () => {
    const windows: FakeWindow[] = []
    const webContents: EventEmitter[] = []
    let closeCount = 0
    let openCount = 0
    let state = { version: 1 as const, lastActiveThreadId: null as string | null }
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: (threadId) => {
          const window = windows.length === 0 ? new DeferredCloseWindow() : new FakeWindow()
          const contents = Object.assign(new EventEmitter(), {
            isDestroyed: () => window.destroyed,
            send: (channel: string, value: unknown) => window.sent.push({ channel, value })
          })
          ;(window as unknown as { webContents: typeof contents }).webContents = contents
          registerDurableWindowIdentity(contents as never, {
            kind: "main",
            threadId,
            windowId: "primary-main"
          })
          windows.push(window)
          webContents.push(contents)
          return window as never
        },
        getSessionState: () => state,
        getWindowBinding: (window) => {
          const identity = getWindowIdentity(window.webContents)
          return identity?.kind === "main"
            ? { kind: "main", threadId: identity.threadId }
            : { kind: "replaced" }
        },
        onWindowClosed: () => {
          closeCount += 1
        },
        onWindowOpened: () => {
          openCount += 1
        },
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        repairSessionThreadBinding: () => ({ repaired: false, state }),
        setSessionState: (next) => (state = next),
        setWindowThread: (window, threadId) =>
          setDurableWindowIdentityThread(window.webContents, threadId)
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) }),
      new DurableWindowRestoreGate()
    )

    service.open({ threadId: "thread-a" })
    const firstContents = webContents[0]
    assert.ok(firstContents)
    const originalLease = getDurableWindowCallerLease(firstContents as never)
    assert.ok(originalLease)
    originalLease.signal.addEventListener(
      "abort",
      () =>
        registerDurableWindowIdentity(firstContents as never, {
          kind: "thread-window",
          threadId: "thread-c",
          windowId: "window-c"
        }),
      { once: true }
    )
    assert.throws(
      () => service.bindSenderThread(firstContents as never, "thread-b"),
      /changed during revocation/
    )

    service.open({ threadId: "thread-d" })
    const secondContents = webContents[1]
    assert.ok(secondContents)
    assert.equal(service.isSender(secondContents as never), true)
    ;(windows[0] as DeferredCloseWindow).finishClose()

    assert.equal(openCount, 2)
    assert.equal(closeCount, 1)
    assert.equal(service.isSender(secondContents as never), true)
    assert.deepEqual(service.getSenderThreadBinding(secondContents as never), {
      revision: 2,
      threadId: "thread-d"
    })
    assert.equal(state.lastActiveThreadId, "thread-d")
  })

  it("rejects exhausted revisions before changing session or window identity", () => {
    const window = new FakeWindow()
    const mutations: string[] = []
    let state = { version: 1 as const, lastActiveThreadId: null as string | null }
    const service = new PrimaryMainWindowService(
      {
        createMainWindow: () => window as never,
        getSessionState: () => state,
        getWindowBinding: () => ({ kind: "main", threadId: state.lastActiveThreadId }),
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        repairSessionThreadBinding: () => ({ repaired: false, state }),
        setSessionState: (next) => {
          mutations.push(`session:${String(next.lastActiveThreadId)}`)
          state = next
          return state
        },
        setWindowThread: (_window, threadId) => mutations.push(`identity:${threadId}`)
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) }),
      new DurableWindowRestoreGate()
    )

    service.open({ threadId: "thread-a" })
    mutations.length = 0
    ;(service as unknown as { bindingRevision: number }).bindingRevision = Number.MAX_SAFE_INTEGER
    assert.throws(
      () => service.bindSenderThread(window.webContents as never, "thread-b"),
      /revision space is exhausted/
    )
    assert.deepEqual(service.getSenderThreadBinding(window.webContents as never), {
      revision: Number.MAX_SAFE_INTEGER,
      threadId: "thread-a"
    })
    assert.equal(state.lastActiveThreadId, "thread-a")
    assert.deepEqual(mutations, [])
    assert.deepEqual(window.sent, [])
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
        getWindowBinding: () => ({ kind: "main", threadId: state.lastActiveThreadId }),
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
        getWindowBinding: () => ({ kind: "main", threadId: state.lastActiveThreadId }),
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
        getWindowBinding: () => ({ kind: "main", threadId: state.lastActiveThreadId }),
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

it("durable-window IPC validates canonical action tuples before service admission", async () => {
  const mainFrame = {}
  const mainSender = { isDestroyed: () => false, mainFrame } as unknown as WebContents
  registerWindowIdentity(mainSender, {
    kind: "main",
    threadId: "thread-current",
    windowId: "primary-main"
  })
  const opened: unknown[] = []
  const pinned: unknown[] = []
  const mainBindings: string[] = []
  const snapshot = { revision: 1, threadId: "thread-current" } as const
  const controller = new DurableWindowController(
    {
      bindSenderThread: (_sender: WebContents, threadId: string) => {
        mainBindings.push(threadId)
        return snapshot
      },
      getSenderThreadBinding: () => snapshot,
      isSender: (sender: WebContents) => sender === mainSender,
      open: (params: unknown) => opened.push(params)
    } as never,
    {
      bindSenderThread: () => {},
      isSender: () => false,
      openNew: (params: unknown) => {
        pinned.push(params)
        return { ok: true, windowId: "thread-window-a" }
      }
    } as never
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const event = { sender: mainSender, senderFrame: mainFrame } as IpcMainInvokeEvent
  const getBinding = ipcMain.handlers.get(MAIN_WINDOW_THREAD_BINDING_GET_CHANNEL)
  const openPrimary = ipcMain.handlers.get("durable-window:openPrimary")
  const pinNew = ipcMain.handlers.get("durable-window:pinNew")
  const setThread = ipcMain.handlers.get("durable-window:setThread")
  assert.ok(getBinding)
  assert.ok(openPrimary)
  assert.ok(pinNew)
  assert.ok(setThread)

  assert.deepEqual(await getBinding(event), snapshot)
  await openPrimary(event)
  await openPrimary(event, undefined)
  await openPrimary(event, { threadId: " thread-open " })
  await pinNew(event)
  await pinNew(event, undefined)
  await pinNew(event, { threadId: " thread-pin " })
  assert.deepEqual(await setThread(event, { threadId: " thread-next " }), snapshot)
  assert.deepEqual(opened, [undefined, undefined, { threadId: "thread-open" }])
  assert.deepEqual(pinned, [undefined, undefined, { threadId: "thread-pin" }])
  assert.deepEqual(mainBindings, ["thread-next"])

  for (const invocation of [
    () => getBinding(event, {}),
    () => openPrimary(event, null),
    () => openPrimary(event, { threadId: "" }),
    () => openPrimary(event, { unexpected: true }),
    () => openPrimary(event, {}, {}),
    () => pinNew(event, []),
    () => pinNew(event, { threadId: "   " }),
    () => setThread(event, undefined),
    () => setThread(event, {}),
    () => setThread(event, { threadId: "thread-next", unexpected: true })
  ]) {
    await assertInvalidArgument(Promise.resolve(invocation()))
  }

  assert.deepEqual(opened, [undefined, undefined, { threadId: "thread-open" }])
  assert.deepEqual(pinned, [undefined, undefined, { threadId: "thread-pin" }])
  assert.deepEqual(mainBindings, ["thread-next"])
})

it("durable-window binding snapshot belongs only to the registered Main main frame", async () => {
  const mainFrame = {}
  const mainSender = { isDestroyed: () => false, mainFrame } as unknown as WebContents
  const otherMainFrame = {}
  const otherMainSender = {
    isDestroyed: () => false,
    mainFrame: otherMainFrame
  } as unknown as WebContents
  const threadFrame = {}
  const threadSender = {
    isDestroyed: () => false,
    mainFrame: threadFrame
  } as unknown as WebContents
  registerWindowIdentity(mainSender, {
    kind: "main",
    threadId: "thread-a",
    windowId: "primary-main"
  })
  registerWindowIdentity(otherMainSender, {
    kind: "main",
    threadId: "thread-other",
    windowId: "other-main"
  })
  registerWindowIdentity(threadSender, {
    kind: "thread-window",
    threadId: "thread-a",
    windowId: "thread-window-a"
  })
  const snapshot = { revision: 4, threadId: "thread-a" } as const
  const controller = new DurableWindowController(
    {
      bindSenderThread: () => snapshot,
      getSenderThreadBinding: () => snapshot,
      isSender: (sender: WebContents) => sender === mainSender,
      open: () => {}
    } as never,
    {
      bindSenderThread: () => {},
      isSender: (sender: WebContents) => sender === threadSender,
      openNew: () => ({ ok: true, windowId: "thread-window-a" })
    } as never
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const getBinding = ipcMain.handlers.get(MAIN_WINDOW_THREAD_BINDING_GET_CHANNEL)
  const setThread = ipcMain.handlers.get("durable-window:setThread")
  assert.ok(getBinding)
  assert.ok(setThread)

  assert.deepEqual(
    await getBinding({ sender: mainSender, senderFrame: mainFrame } as IpcMainInvokeEvent),
    snapshot
  )
  assert.deepEqual(
    await setThread({ sender: mainSender, senderFrame: mainFrame } as IpcMainInvokeEvent, {
      threadId: "thread-a"
    }),
    snapshot
  )
  assert.equal(
    await setThread({ sender: threadSender, senderFrame: threadFrame } as IpcMainInvokeEvent, {
      threadId: "thread-a"
    }),
    null
  )
  await assert.rejects(
    Promise.resolve(
      getBinding({ sender: otherMainSender, senderFrame: otherMainFrame } as IpcMainInvokeEvent)
    ),
    /registered Main window/
  )
  await assert.rejects(
    Promise.resolve(
      getBinding({ sender: threadSender, senderFrame: threadFrame } as IpcMainInvokeEvent)
    ),
    /registered Main window/
  )
  await assert.rejects(
    Promise.resolve(getBinding({ sender: mainSender, senderFrame: {} } as IpcMainInvokeEvent)),
    /registered Main window/
  )
})
