import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import type { ArtifactChangedEvent, ArtifactRecord } from "../../src/shared/artifacts"
import { ArtifactsController } from "../../src/main/artifacts/controller"
import type { ArtifactsService } from "../../src/main/artifacts/service"
import type { DurableWindowCallerLease } from "../../src/main/windows/window-identity"

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

function createArtifact(id: string, threadId: string): ArtifactRecord {
  return {
    artifactKey: `key:${id}`,
    createdAt: new Date(10),
    id,
    kind: "summary",
    messageId: null,
    mimeType: "text/plain",
    payload: { format: "plain", text: `artifact ${id}` },
    previewText: `artifact ${id}`,
    runId: null,
    sizeBytes: null,
    source: { type: "inline-text", uri: null },
    status: "ready",
    subtitle: null,
    threadId,
    title: id,
    toolCallId: null,
    updatedAt: new Date(10)
  }
}

function createServiceStub(artifacts: readonly ArtifactRecord[]) {
  const calls: string[] = []
  let changedListener: ((event: ArtifactChangedEvent) => void) | null = null
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  const service = {
    get: async (artifactId: string) => {
      calls.push(`get:${artifactId}`)
      return byId.get(artifactId) ?? null
    },
    list: async (threadId: string) => {
      calls.push(`list:${threadId}`)
      return artifacts.filter((artifact) => artifact.threadId === threadId)
    },
    onChanged: (listener: (event: ArtifactChangedEvent) => void) => {
      changedListener = listener
      return () => {
        changedListener = null
      }
    },
    open: async (
      artifactId: string,
      _action: unknown,
      assertAccess: (threadId: string) => void
    ) => {
      assertAccess(byId.get(artifactId)?.threadId ?? "missing")
      calls.push(`open:${artifactId}`)
      return { type: "detail" as const }
    },
    readBinaryFile: async (artifactId: string, assertAccess: (threadId: string) => void) => {
      assertAccess(byId.get(artifactId)?.threadId ?? "missing")
      calls.push(`readBinary:${artifactId}`)
      return { content: "YQ==", modified_at: "10", size: 1, success: true as const }
    },
    readFile: async (artifactId: string, assertAccess: (threadId: string) => void) => {
      assertAccess(byId.get(artifactId)?.threadId ?? "missing")
      calls.push(`read:${artifactId}`)
      return { content: "a", modified_at: "10", size: 1, success: true as const }
    }
  }

  return {
    calls,
    emitChanged: (event: ArtifactChangedEvent) => {
      assert.ok(changedListener)
      changedListener(event)
    },
    service: service as unknown as ArtifactsService
  }
}

function createIdentity(input: {
  launcher: FakeWebContents
  durableLeases: Map<FakeWebContents, DurableWindowCallerLease>
}) {
  return {
    getDurableCallerLease: (sender: WebContents) =>
      input.durableLeases.get(sender as unknown as FakeWebContents) ?? null,
    isLauncher: (sender: WebContents) => sender === (input.launcher as unknown as WebContents)
  }
}

function createLease(
  threadId: string,
  incarnation: number
): { abort: () => void; lease: DurableWindowCallerLease } {
  const controller = new AbortController()
  return {
    abort: () => controller.abort(new Error("rebound")),
    lease: Object.freeze({
      incarnation,
      signal: controller.signal,
      threadId,
      window: Object.freeze({ kind: "main", windowId: `window-${incarnation}` })
    })
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

test("artifact IPC enforces main-frame and current thread ownership", async () => {
  const artifactA = createArtifact("artifact-a", "thread-a")
  const artifactB = createArtifact("artifact-b", "thread-b")
  const { calls, service } = createServiceStub([artifactA, artifactB])
  const launcher = new FakeWebContents(1)
  const mainA = new FakeWebContents(2)
  const threadWindowB = new FakeWebContents(3)
  const settings = new FakeWebContents(4)
  const ipcNetwork = new FakeWebContents(5)
  const unregistered = new FakeWebContents(6)
  const leaseA = createLease("thread-a", 1)
  const leaseB = createLease("thread-b", 2)
  const durableLeases = new Map<FakeWebContents, DurableWindowCallerLease>([
    [mainA, leaseA.lease],
    [threadWindowB, leaseB.lease]
  ])
  const controller = new ArtifactsController(
    service,
    createIdentity({ durableLeases, launcher }),
    () => []
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)

  assert.equal(ipcMain.handlers.size, 4)
  assert.deepEqual(await ipcMain.invoke("artifacts:list", launcher, "thread-b"), [artifactB])
  assert.deepEqual(await ipcMain.invoke("artifacts:list", mainA, "thread-a"), [artifactA])
  await ipcMain.invoke("artifacts:open", launcher, { artifactId: "artifact-b" })
  await ipcMain.invoke("artifacts:open", mainA, { artifactId: "artifact-a" })
  await ipcMain.invoke("artifacts:readFile", mainA, "artifact-a")
  await ipcMain.invoke("artifacts:readBinaryFile", threadWindowB, "artifact-b")

  await assert.rejects(ipcMain.invoke("artifacts:list", mainA, "thread-b"), /PERMISSION_DENIED/)
  await assert.rejects(
    ipcMain.invoke("artifacts:open", mainA, { artifactId: "artifact-b" }),
    /PERMISSION_DENIED/
  )
  for (const sender of [settings, ipcNetwork, unregistered]) {
    await assert.rejects(
      ipcMain.invoke("artifacts:readFile", sender, "artifact-a"),
      /PERMISSION_DENIED/
    )
  }
  await assert.rejects(
    ipcMain.invokeFromFrame("artifacts:list", launcher, {}, "thread-a"),
    /main frame/
  )
  await assert.rejects(
    ipcMain.invokeFromFrame("artifacts:open", launcher, {}, { artifactId: "artifact-a" }),
    /main frame/
  )
  await assert.rejects(
    ipcMain.invoke("artifacts:open", launcher, { artifactId: "missing" }),
    /NOT_FOUND/
  )

  assert.deepEqual(calls, [
    "list:thread-b",
    "list:thread-a",
    "get:artifact-b",
    "open:artifact-b",
    "get:artifact-a",
    "open:artifact-a",
    "get:artifact-a",
    "read:artifact-a",
    "get:artifact-b",
    "readBinary:artifact-b",
    "get:artifact-b",
    "get:missing"
  ])
})

test("artifact changes only reach windows authorized for the current thread binding", () => {
  const artifactA = createArtifact("artifact-a", "thread-a")
  const artifactB = createArtifact("artifact-b", "thread-b")
  const { emitChanged, service } = createServiceStub([artifactA, artifactB])
  const launcher = new FakeWebContents(1)
  const durable = new FakeWebContents(2)
  const other = new FakeWebContents(3)
  const settings = new FakeWebContents(4)
  const destroyed = new FakeWebContents(5)
  destroyed.destroyed = true
  const firstDurableLease = createLease("thread-a", 1)
  const secondDurableLease = createLease("thread-b", 2)
  const otherLease = createLease("thread-b", 3)
  const destroyedLease = createLease("thread-a", 4)
  const durableLeases = new Map<FakeWebContents, DurableWindowCallerLease>([
    [durable, firstDurableLease.lease],
    [other, otherLease.lease],
    [destroyed, destroyedLease.lease]
  ])
  const windows = [launcher, durable, other, settings, destroyed].map(
    (sender) => new FakeWindow(sender)
  )
  const controller = new ArtifactsController(
    service,
    createIdentity({ durableLeases, launcher }),
    () => windows as unknown as BrowserWindow[]
  )
  controller.register(new FakeIpcMain() as unknown as IpcMain)

  emitChanged({ artifacts: [artifactA], threadId: "thread-a" })
  assert.deepEqual(
    launcher.sent.map((item) => item.payload),
    [{ artifacts: [artifactA], threadId: "thread-a" }]
  )
  assert.equal(durable.sent.length, 1)
  assert.equal(other.sent.length, 0)
  assert.equal(settings.sent.length, 0)
  assert.equal(destroyed.sent.length, 0)

  firstDurableLease.abort()
  durableLeases.set(durable, secondDurableLease.lease)
  emitChanged({ artifacts: [artifactA], threadId: "thread-a" })
  assert.equal(durable.sent.length, 1)
  emitChanged({ artifacts: [artifactB], threadId: "thread-b" })
  assert.equal(durable.sent.length, 2)
  assert.equal(other.sent.length, 1)
})

test("artifact operations reject results and side effects after a durable window rebind", async () => {
  const artifactA = createArtifact("artifact-a", "thread-a")
  const listGate = createDeferred<ArtifactRecord[]>()
  const openGate = createDeferred<void>()
  const readGate = createDeferred<void>()
  let openSideEffects = 0
  let readResults = 0
  let changedListener: ((event: ArtifactChangedEvent) => void) | null = null
  const service = {
    get: async () => artifactA,
    list: async () => listGate.promise,
    onChanged: (listener: (event: ArtifactChangedEvent) => void) => {
      changedListener = listener
      return () => {
        changedListener = null
      }
    },
    open: async (_id: string, _action: unknown, assertAccess: (threadId: string) => void) => {
      await openGate.promise
      assertAccess("thread-a")
      openSideEffects += 1
      return { type: "detail" as const }
    },
    readBinaryFile: async (_id: string, assertAccess: (threadId: string) => void) => {
      await readGate.promise
      assertAccess("thread-a")
      readResults += 1
      return { content: "YQ==", modified_at: "10", size: 1, success: true as const }
    },
    readFile: async (_id: string, assertAccess: (threadId: string) => void) => {
      await readGate.promise
      assertAccess("thread-a")
      readResults += 1
      return { content: "a", modified_at: "10", size: 1, success: true as const }
    }
  } as unknown as ArtifactsService
  const launcher = new FakeWebContents(1)
  const durable = new FakeWebContents(2)
  const firstLease = createLease("thread-a", 1)
  const secondLease = createLease("thread-b", 2)
  const durableLeases = new Map<FakeWebContents, DurableWindowCallerLease>([
    [durable, firstLease.lease]
  ])
  const controller = new ArtifactsController(
    service,
    createIdentity({ durableLeases, launcher }),
    () => []
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  assert.ok(changedListener)

  const list = ipcMain.invoke("artifacts:list", durable, "thread-a")
  const open = ipcMain.invoke("artifacts:open", durable, { artifactId: "artifact-a" })
  const read = ipcMain.invoke("artifacts:readFile", durable, "artifact-a")
  const readBinary = ipcMain.invoke("artifacts:readBinaryFile", durable, "artifact-a")
  await new Promise<void>((resolve) => setImmediate(resolve))

  firstLease.abort()
  durableLeases.set(durable, secondLease.lease)
  listGate.resolve([artifactA])
  openGate.resolve()
  readGate.resolve()

  for (const operation of [list, open, read, readBinary]) {
    await assert.rejects(operation, /PERMISSION_DENIED/)
  }
  assert.equal(openSideEffects, 0)
  assert.equal(readResults, 0)
})

test("artifact actions revalidate the persisted owner before dispatch and return", async () => {
  const artifactA = createArtifact("artifact-a", "thread-a")
  let openSideEffects = 0
  let readResults = 0
  const service = {
    get: async () => artifactA,
    list: async () => [],
    onChanged: () => () => undefined,
    open: async (_id: string, _action: unknown, assertAccess: (threadId: string) => void) => {
      assertAccess("thread-b")
      openSideEffects += 1
      return { type: "detail" as const }
    },
    readBinaryFile: async (_id: string, assertAccess: (threadId: string) => void) => {
      assertAccess("thread-b")
      readResults += 1
      return { content: "YQ==", modified_at: "10", size: 1, success: true as const }
    },
    readFile: async (_id: string, assertAccess: (threadId: string) => void) => {
      assertAccess("thread-b")
      readResults += 1
      return { content: "a", modified_at: "10", size: 1, success: true as const }
    }
  } as unknown as ArtifactsService
  const launcher = new FakeWebContents(1)
  const durable = new FakeWebContents(2)
  const lease = createLease("thread-a", 1)
  const durableLeases = new Map<FakeWebContents, DurableWindowCallerLease>([[durable, lease.lease]])
  const controller = new ArtifactsController(
    service,
    createIdentity({ durableLeases, launcher }),
    () => []
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)

  await assert.rejects(
    ipcMain.invoke("artifacts:open", durable, { artifactId: "artifact-a" }),
    /PERMISSION_DENIED/
  )
  await assert.rejects(
    ipcMain.invoke("artifacts:readFile", durable, "artifact-a"),
    /PERMISSION_DENIED/
  )
  await assert.rejects(
    ipcMain.invoke("artifacts:readBinaryFile", durable, "artifact-a"),
    /PERMISSION_DENIED/
  )
  assert.equal(openSideEffects, 0)
  assert.equal(readResults, 0)
})
