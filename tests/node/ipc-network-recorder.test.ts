import assert from "node:assert/strict"
import test from "node:test"
import type { IpcMain } from "electron"
import {
  IPC_NETWORK_LIST_CHANNEL,
  IPC_NETWORK_OPEN_WINDOW_CHANNEL,
  type IpcNetworkEntry
} from "../../packages/devtools-network/src/protocol"
import {
  configureIpcNetworkRecorder,
  getIpcNetworkRecorder,
  installIpcMainNetworkInstrumentation,
  installWebContentsNetworkInstrumentation,
  summarizeIpcNetworkValue
} from "../../packages/devtools-network/src/main"

interface FakeSender {
  readonly id: number
}

interface FakeIpcMain {
  handle(
    channel: string,
    listener: (event: { sender: FakeSender }, ...args: unknown[]) => unknown
  ): FakeIpcMain
  on(
    channel: string,
    listener: (event: { sender: FakeSender }, ...args: unknown[]) => void
  ): FakeIpcMain
}

class FakeIpcMainImpl implements FakeIpcMain {
  readonly handleListeners = new Map<
    string,
    (event: { sender: FakeSender }, ...args: unknown[]) => unknown
  >()
  readonly onListeners = new Map<
    string,
    (event: { sender: FakeSender }, ...args: unknown[]) => void
  >()

  handle(
    channel: string,
    listener: (event: { sender: FakeSender }, ...args: unknown[]) => unknown
  ): FakeIpcMain {
    this.handleListeners.set(channel, listener)
    return this
  }

  on(
    channel: string,
    listener: (event: { sender: FakeSender }, ...args: unknown[]) => void
  ): FakeIpcMain {
    this.onListeners.set(channel, listener)
    return this
  }
}

class FakeWebContents {
  readonly sent: { args: unknown[]; channel: string }[] = []

  constructor(readonly id: number) {}

  send(channel: string, ...args: unknown[]): void {
    this.sent.push({ args, channel })
  }
}

function asInstrumentedIpcMain(ipcMain: FakeIpcMainImpl): Pick<IpcMain, "handle" | "on"> {
  return ipcMain as unknown as Pick<IpcMain, "handle" | "on">
}

function invokeFakeHandle(
  ipcMain: FakeIpcMainImpl,
  channel: string,
  sender: FakeSender,
  ...args: unknown[]
): Promise<unknown> {
  const listener = ipcMain.handleListeners.get(channel)
  assert.ok(listener, `Missing fake handle listener for ${channel}`)
  return Promise.resolve(listener({ sender }, ...args))
}

function emitFakeOn(
  ipcMain: FakeIpcMainImpl,
  channel: string,
  sender: FakeSender,
  ...args: unknown[]
): void {
  const listener = ipcMain.onListeners.get(channel)
  assert.ok(listener, `Missing fake on listener for ${channel}`)
  listener({ sender }, ...args)
}

function resetRecorder(): void {
  configureIpcNetworkRecorder({
    enabled: true,
    maxEntries: 100
  })
  getIpcNetworkRecorder().clear()
}

test("summarizeIpcNetworkValue redacts sensitive fields and truncates large values", () => {
  const summary = summarizeIpcNetworkValue({
    apiKey: "secret",
    nested: {
      token: "secret-token"
    },
    text: "x".repeat(300)
  })

  assert.deepEqual((summary.preview as { apiKey: string }).apiKey, "[redacted]")
  assert.deepEqual((summary.preview as { nested: { token: string } }).nested.token, "[redacted]")
  assert.equal(summary.truncated, true)
})

test("installIpcMainNetworkInstrumentation records invoke success and errors", async () => {
  resetRecorder()
  const ipcMain = new FakeIpcMainImpl()

  installIpcMainNetworkInstrumentation(asInstrumentedIpcMain(ipcMain))
  ipcMain.handle("threads:get", async (_event, payload) => {
    return { id: (payload as { threadId: string }).threadId }
  })
  ipcMain.handle("threads:fail", () => {
    throw new Error("boom")
  })

  await invokeFakeHandle(ipcMain, "threads:get", { id: 42 }, { threadId: "t1" })
  await assert.rejects(
    () => invokeFakeHandle(ipcMain, "threads:fail", { id: 43 }),
    /boom/
  )

  const entries = getIpcNetworkRecorder().list()
  assert.equal(entries.length, 2)
  assert.deepEqual(
    entries.map((entry) => entry.channel),
    ["threads:get", "threads:fail"]
  )
  assert.equal(entries[0].direction, "renderer-to-main")
  assert.equal(entries[0].pattern, "invoke")
  assert.equal(entries[0].source, "ipc")
  assert.equal(entries[0].status, "success")
  assert.deepEqual(entries[0].result?.preview, { id: "t1" })
  assert.equal(entries[1].status, "error")
  assert.equal(entries[1].error?.message, "boom")
})

test("recorder appends agent stream and trace events as first-class sources", () => {
  resetRecorder()

  getIpcNetworkRecorder().append({
    channel: "agent:stream:messages",
    metadata: {
      mode: "messages",
      runId: "run-1",
      threadId: "thread-1"
    },
    payload: {
      apiKey: "secret",
      chunk: "hello"
    },
    source: "agent-stream",
    status: "sent"
  })
  getIpcNetworkRecorder().append({
    channel: "llm.input.captured",
    metadata: {
      runId: "run-1",
      threadId: "thread-1"
    },
    payload: {
      inputHash: "hash-1",
      preview: "question"
    },
    source: "agent-trace",
    status: "sent"
  })

  const entries = getIpcNetworkRecorder().list()
  assert.equal(entries.length, 2)
  assert.equal(entries[0].source, "agent-stream")
  assert.equal(entries[0].channel, "agent:stream:messages")
  assert.equal(entries[0].direction, "internal")
  assert.equal(entries[0].pattern, "record")
  assert.deepEqual(entries[0].payload?.preview, {
    apiKey: "[redacted]",
    chunk: "hello"
  })
  assert.deepEqual(entries[0].metadata?.preview, {
    mode: "messages",
    runId: "run-1",
    threadId: "thread-1"
  })
  assert.equal(entries[1].source, "agent-trace")
  assert.equal(entries[1].channel, "llm.input.captured")
})

test("installIpcMainNetworkInstrumentation records renderer-to-main sends without business wrappers", () => {
  resetRecorder()
  const ipcMain = new FakeIpcMainImpl()
  const received: unknown[] = []

  installIpcMainNetworkInstrumentation(asInstrumentedIpcMain(ipcMain))
  ipcMain.on("agent:invoke", (_event, payload) => {
    received.push(payload)
  })

  emitFakeOn(ipcMain, "agent:invoke", { id: 7 }, { threadId: "thread-1" })

  assert.deepEqual(received, [{ threadId: "thread-1" }])
  const [entry] = getIpcNetworkRecorder().list()
  assert.equal(entry.channel, "agent:invoke")
  assert.equal(entry.direction, "renderer-to-main")
  assert.equal(entry.pattern, "send")
  assert.equal(entry.status, "sent")
  assert.equal(entry.webContentsId, 7)
})

test("installWebContentsNetworkInstrumentation records main-to-renderer sends", () => {
  resetRecorder()
  const webContents = new FakeWebContents(13)

  installWebContentsNetworkInstrumentation(webContents)
  webContents.send("launcher:shown", { source: "test" })

  assert.deepEqual(webContents.sent, [
    {
      args: [{ source: "test" }],
      channel: "launcher:shown"
    }
  ])
  const [entry] = getIpcNetworkRecorder().list()
  assert.equal(entry.channel, "launcher:shown")
  assert.equal(entry.direction, "main-to-renderer")
  assert.equal(entry.pattern, "send")
  assert.equal(entry.status, "sent")
  assert.equal(entry.webContentsId, 13)
})

test("instrumentation skips internal IPC network devtools channels", async () => {
  resetRecorder()
  const ipcMain = new FakeIpcMainImpl()

  installIpcMainNetworkInstrumentation(asInstrumentedIpcMain(ipcMain))
  ipcMain.handle(IPC_NETWORK_LIST_CHANNEL, () => {
    return [] satisfies IpcNetworkEntry[]
  })

  await invokeFakeHandle(ipcMain, IPC_NETWORK_LIST_CHANNEL, { id: 1 })

  assert.deepEqual(getIpcNetworkRecorder().list(), [])
})

test("instrumentation skips the IPC network open-window route", async () => {
  resetRecorder()
  const ipcMain = new FakeIpcMainImpl()

  installIpcMainNetworkInstrumentation(asInstrumentedIpcMain(ipcMain))
  ipcMain.handle(IPC_NETWORK_OPEN_WINDOW_CHANNEL, () => undefined)

  await invokeFakeHandle(ipcMain, IPC_NETWORK_OPEN_WINDOW_CHANNEL, { id: 1 })

  assert.deepEqual(getIpcNetworkRecorder().list(), [])
})
