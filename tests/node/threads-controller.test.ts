import assert from "node:assert/strict"
import test from "node:test"
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { ThreadsController } from "../../src/main/threads/controller"
import type {
  ModelRuntimeSelection,
  ThreadModelRuntimeSelectionChangedEvent
} from "../../src/shared/app-types"

class FakeIpcMain {
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, handler)
  }

  async invoke(channel: string, sender: FakeWebContents, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel)
    assert.ok(handler, `Missing IPC handler for ${channel}`)
    return handler(
      { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent,
      ...args
    )
  }

  async invokeFromFrame(
    channel: string,
    sender: FakeWebContents,
    senderFrame: object,
    ...args: unknown[]
  ): Promise<unknown> {
    const handler = this.handlers.get(channel)
    assert.ok(handler, `Missing IPC handler for ${channel}`)
    return handler({ sender, senderFrame } as unknown as IpcMainInvokeEvent, ...args)
  }
}

class FakeWebContents {
  readonly mainFrame = {}
  readonly sent: Array<{ channel: string; payload: unknown }> = []

  constructor(readonly id: number) {}

  isDestroyed(): boolean {
    return false
  }

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }
}

class FakeWindow {
  constructor(readonly webContents: FakeWebContents) {}

  isDestroyed(): boolean {
    return false
  }
}

function createServiceStub() {
  const calls: Array<{ selection: ModelRuntimeSelection; threadId: string }> = []
  let listener: ((event: ThreadModelRuntimeSelectionChangedEvent) => void) | null = null
  const service = {
    onModelRuntimeSelectionChanged: (
      nextListener: (event: ThreadModelRuntimeSelectionChangedEvent) => void
    ) => {
      listener = nextListener
      return () => {
        listener = null
      }
    },
    setModel: async (threadId: string, selection: ModelRuntimeSelection) => {
      calls.push({ selection, threadId })
      listener?.({ revision: 2, selection, threadId })
      return {
        created_at: new Date("2026-07-17T00:00:00.000Z"),
        metadata: {},
        status: "idle" as const,
        thread_id: threadId,
        updated_at: new Date("2026-07-17T00:00:00.000Z")
      }
    }
  }
  return { calls, service }
}

function createIdentity(input: {
  launcher: FakeWebContents
  threadBindings: ReadonlyMap<FakeWebContents, string>
}) {
  return {
    getMainThreadId: (sender: WebContents) =>
      input.threadBindings.get(sender as unknown as FakeWebContents) ?? null,
    isLauncher: (sender: WebContents) => sender === (input.launcher as unknown as WebContents)
  }
}

test("threads:setModel validates sender ownership and fans one revision to both bound windows", async () => {
  const launcher = new FakeWebContents(1)
  const main = new FakeWebContents(2)
  const threadWindow = new FakeWebContents(3)
  const otherThread = new FakeWebContents(4)
  const settings = new FakeWebContents(5)
  const windows = [launcher, main, threadWindow, otherThread, settings].map(
    (sender) => new FakeWindow(sender)
  )
  const { calls, service } = createServiceStub()
  const controller = new ThreadsController(
    service as never,
    {} as never,
    createIdentity({
      launcher,
      threadBindings: new Map([
        [main, "thread-a"],
        [threadWindow, "thread-a"],
        [otherThread, "thread-b"]
      ])
    }),
    () => windows as unknown as BrowserWindow[]
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const selection = {
    modelId: "openai:gpt-5.6-sol",
    thinkingEffort: "max",
    version: 1
  } as const

  await ipcMain.invoke("threads:setModel", main, { selection, threadId: "thread-a" })

  assert.deepEqual(calls, [{ selection, threadId: "thread-a" }])
  const expected = [
    {
      channel: "threads:modelRuntimeSelectionChanged",
      payload: { revision: 2, selection, threadId: "thread-a" }
    }
  ]
  assert.deepEqual(launcher.sent, expected)
  assert.deepEqual(main.sent, expected)
  assert.deepEqual(threadWindow.sent, expected)
  assert.deepEqual(otherThread.sent, [])
  assert.deepEqual(settings.sent, [])

  await assert.rejects(
    ipcMain.invoke("threads:setModel", main, { selection, threadId: "thread-b" }),
    /only available to the Launcher or a window bound to that thread/
  )
  await assert.rejects(
    ipcMain.invoke("threads:setModel", settings, { selection, threadId: "thread-a" }),
    /only available to the Launcher or a window bound to that thread/
  )
  await assert.rejects(
    ipcMain.invokeFromFrame("threads:setModel", launcher, {}, { selection, threadId: "thread-a" }),
    /window's main frame/
  )
  await assert.rejects(
    ipcMain.invoke("threads:setModel", launcher, {
      selection: { ...selection, untrusted: true },
      threadId: "thread-a"
    }),
    /params validation failed/
  )
  assert.equal(calls.length, 1)
})
