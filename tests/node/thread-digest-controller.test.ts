import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { ThreadDigestController } from "../../src/main/thread-digest/controller"
import type { ThreadDigestService } from "../../src/main/thread-digest/service"
import {
  threadDigestChangedEventSchema,
  threadDigestRecordSchema,
  type ThreadDigestRecord
} from "../../src/shared/thread-digest"

class FakeIpcMain {
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, handler)
  }

  invoke(channel: string, sender: FakeWebContents, ...args: unknown[]): Promise<unknown> {
    return this.invokeFromFrame(channel, sender, sender.mainFrame, ...args)
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

class FakeWebContents extends EventEmitter {
  destroyed = false
  readonly mainFrame = {}
  readonly sent: Array<{ channel: string; payload: unknown }> = []

  constructor(readonly id: number) {
    super()
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }
}

class FakeWindow {
  destroyed = false

  constructor(readonly webContents: FakeWebContents) {}

  isDestroyed(): boolean {
    return this.destroyed
  }
}

const DIGEST: ThreadDigestRecord = {
  decisions: [],
  generatedAt: 10,
  messageCount: 2,
  openQuestions: [],
  projectedThroughSeq: 2,
  projectionError: null,
  sourceHash: "source",
  status: "ready",
  summary: "Ready digest",
  threadId: "thread-bound",
  topics: [],
  updatedAt: 10
}

function createServiceStub(calls: string[]) {
  let changedListener: ((digest: ThreadDigestRecord) => void) | null = null
  const service = {
    generate: async (threadId: string) => {
      calls.push(`generate:${threadId}`)
      return { ...DIGEST, threadId }
    },
    get: async (threadId: string) => {
      calls.push(`get:${threadId}`)
      return { ...DIGEST, threadId }
    },
    onChanged: (listener: (digest: ThreadDigestRecord) => void) => {
      changedListener = listener
      return () => {
        changedListener = null
      }
    }
  }

  return {
    emitChanged: (digest: ThreadDigestRecord) => {
      assert.ok(changedListener)
      changedListener(digest)
    },
    service: service as unknown as ThreadDigestService
  }
}

function createSenderIdentity(input: {
  launcher: FakeWebContents
  pinned: ReadonlyMap<FakeWebContents, string>
}) {
  return {
    getPinnedThreadId: (sender: WebContents) =>
      input.pinned.get(sender as unknown as FakeWebContents) ?? null,
    isLauncher: (sender: WebContents) => sender === (input.launcher as unknown as WebContents)
  }
}

test("thread digest IPC admits only Launcher and the bound Pinned AI main frame", async () => {
  const calls: string[] = []
  const launcher = new FakeWebContents(1)
  const pinned = new FakeWebContents(2)
  const settings = new FakeWebContents(3)
  const { service } = createServiceStub(calls)
  const controller = new ThreadDigestController(
    service,
    createSenderIdentity({ launcher, pinned: new Map([[pinned, "thread-bound"]]) }),
    () => []
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)

  await ipcMain.invoke("threadDigest:get", launcher, { threadId: "thread-any" })
  await ipcMain.invoke("threadDigest:generate", pinned, { threadId: "thread-bound" })

  await assert.rejects(
    ipcMain.invoke("threadDigest:get", pinned, { threadId: "thread-other" }),
    /only available to the Launcher or the bound Pinned AI session/
  )
  await assert.rejects(
    ipcMain.invoke("threadDigest:generate", settings, { threadId: "thread-bound" }),
    /only available to the Launcher or the bound Pinned AI session/
  )
  await assert.rejects(
    ipcMain.invokeFromFrame("threadDigest:get", launcher, {}, { threadId: "thread-any" }),
    /window's main frame/
  )

  assert.deepEqual(calls, ["get:thread-any", "generate:thread-bound"])
})

test("thread digest changes publish only to Launcher and the matching Pinned AI session", () => {
  const calls: string[] = []
  const launcher = new FakeWebContents(1)
  const matchingPinned = new FakeWebContents(2)
  const otherPinned = new FakeWebContents(3)
  const settings = new FakeWebContents(4)
  const windows = [launcher, matchingPinned, otherPinned, settings].map(
    (webContents) => new FakeWindow(webContents)
  )
  const { emitChanged, service } = createServiceStub(calls)
  const controller = new ThreadDigestController(
    service,
    createSenderIdentity({
      launcher,
      pinned: new Map([
        [matchingPinned, "thread-bound"],
        [otherPinned, "thread-other"]
      ])
    }),
    () => windows as unknown as BrowserWindow[]
  )
  controller.register(new FakeIpcMain() as unknown as IpcMain)

  emitChanged(DIGEST)

  const expected = [{ channel: "threadDigest:changed", payload: { digest: DIGEST } }]
  assert.deepEqual(launcher.sent, expected)
  assert.deepEqual(matchingPinned.sent, expected)
  assert.deepEqual(otherPinned.sent, [])
  assert.deepEqual(settings.sent, [])
})

test("thread digest wire codecs reject malformed records and events", () => {
  assert.equal(threadDigestRecordSchema.safeParse(DIGEST).success, true)
  assert.equal(
    threadDigestRecordSchema.safeParse({ ...DIGEST, updatedAt: Number.NaN }).success,
    false
  )
  assert.equal(
    threadDigestChangedEventSchema.safeParse({ digest: DIGEST, unexpected: true }).success,
    false
  )
})
