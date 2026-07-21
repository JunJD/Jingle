import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import test from "node:test"
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { AI_THREAD_SOURCE } from "../../src/shared/launcher-ai"
import {
  MAX_LAUNCHER_SEARCH_CALLER_ID_LENGTH,
  MAX_LAUNCHER_SEARCH_QUERY_LENGTH,
  type LauncherSearchRequest,
  type LauncherSearchResponse
} from "../../src/shared/launcher-search"
import { MAX_LAUNCHER_SEARCH_RESULTS } from "../../src/shared/launcher"
import { parseSerializedIpcErrorMessage } from "../../src/shared/ipc-error"
import type { LauncherService } from "../../src/main/launcher/service"
import { registerWindowIdentity, type WindowIdentity } from "../../src/main/windows/window-identity"

const requireFromTest = createRequire(import.meta.url)

function installElectronModuleMock(): void {
  const originalOverridePath = process.env.ELECTRON_OVERRIDE_DIST_PATH
  process.env.ELECTRON_OVERRIDE_DIST_PATH = process.cwd()

  try {
    const electronModuleId = requireFromTest.resolve("electron")
    requireFromTest("electron")
    const electronModule = requireFromTest.cache[electronModuleId]
    assert.ok(electronModule, "Expected electron module to be loaded before mocking it.")
    electronModule.exports = {
      app: {},
      BrowserWindow: { fromWebContents: () => null },
      nativeImage: {},
      screen: {},
      shell: {}
    }
  } finally {
    if (originalOverridePath === undefined) {
      delete process.env.ELECTRON_OVERRIDE_DIST_PATH
    } else {
      process.env.ELECTRON_OVERRIDE_DIST_PATH = originalOverridePath
    }
  }
}

installElectronModuleMock()

const controllerModulePromise = import("../../src/main/launcher/controller")

const COMPLETE_RESPONSE: LauncherSearchResponse = {
  query: "jingle",
  results: [],
  terminal: { kind: "complete" }
}

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
  readonly mainFrame = {}
  destroyed = false

  constructor(readonly id: number) {
    super()
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
}

class FakeLauncherService {
  readonly cancellations: string[] = []
  readonly searches: Array<{ callerId: string; request: LauncherSearchRequest }> = []

  cancelSearch(callerId: string): boolean {
    this.cancellations.push(callerId)
    return true
  }

  search(request: LauncherSearchRequest, callerId: string): Promise<LauncherSearchResponse> {
    this.searches.push({ callerId, request })
    return Promise.resolve({ ...COMPLETE_RESPONSE, query: request.query })
  }
}

async function createHarness(): Promise<{
  ipcMain: FakeIpcMain
  registerIdentity: (sender: FakeWebContents, identity: WindowIdentity) => void
  service: FakeLauncherService
}> {
  const { LauncherController } = await controllerModulePromise
  const service = new FakeLauncherService()
  const controller = new LauncherController(service as unknown as LauncherService)
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  return {
    ipcMain,
    registerIdentity: (sender, identity) => {
      registerWindowIdentity(sender as unknown as WebContents, identity)
    },
    service
  }
}

async function assertInvalidArgument(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof Error)
    return parseSerializedIpcErrorMessage(error.message)?.code === "INVALID_ARGUMENT"
  })
}

test("launcher search accepts canonical requests from authorized main frames", async () => {
  const { ipcMain, registerIdentity, service } = await createHarness()
  const launcherSender = new FakeWebContents(11)
  registerIdentity(launcherSender, { kind: "launcher" })

  assert.deepEqual(
    await ipcMain.invoke("launcher:search", launcherSender, {
      callerId: "launcher-request",
      request: {
        limit: MAX_LAUNCHER_SEARCH_RESULTS,
        query: "jingle",
        sources: ["applications", "files"]
      }
    }),
    COMPLETE_RESPONSE
  )
  assert.deepEqual(service.searches, [
    {
      callerId: "11:launcher-request",
      request: {
        limit: MAX_LAUNCHER_SEARCH_RESULTS,
        query: "jingle",
        sources: ["applications", "files"]
      }
    }
  ])

  assert.equal(
    await ipcMain.invoke("launcher:cancelSearch", launcherSender, {
      callerId: "launcher-request"
    }),
    true
  )
  assert.deepEqual(service.cancellations, ["11:launcher-request"])
})

test("durable windows can invoke only canonical thread-scoped search", async () => {
  const { ipcMain, registerIdentity, service } = await createHarness()
  const senders: Array<{ identity: WindowIdentity; sender: FakeWebContents }> = [
    {
      identity: { kind: "main", threadId: null, windowId: "primary-main" },
      sender: new FakeWebContents(21)
    },
    {
      identity: { kind: "thread-window", threadId: "thread-a", windowId: "thread-window-a" },
      sender: new FakeWebContents(22)
    }
  ]

  for (const { identity, sender } of senders) {
    registerIdentity(sender, identity)
    await ipcMain.invoke("launcher:search", sender, {
      callerId: `request-${sender.id}`,
      request: {
        limit: 10,
        query: "history",
        sources: ["threads"],
        threadMetadataSource: AI_THREAD_SOURCE
      }
    })
    assert.equal(
      await ipcMain.invoke("launcher:cancelSearch", sender, {
        callerId: `request-${sender.id}`
      }),
      true
    )
  }

  assert.deepEqual(
    service.searches.map(({ callerId, request }) => ({ callerId, request })),
    senders.map(({ sender }) => ({
      callerId: `${sender.id}:request-${sender.id}`,
      request: {
        limit: 10,
        query: "history",
        sources: ["threads"],
        threadMetadataSource: AI_THREAD_SOURCE
      }
    }))
  )

  const mainSender = senders[0]!.sender
  await assert.rejects(
    ipcMain.invoke("launcher:search", mainSender, {
      callerId: "wrong-source",
      request: { limit: 10, query: "history", sources: ["applications"] }
    }),
    /thread-only search/
  )
  await assert.rejects(
    ipcMain.invokeFromFrame(
      "launcher:search",
      mainSender,
      {},
      {
        callerId: "subframe",
        request: {
          limit: 10,
          query: "history",
          sources: ["threads"],
          threadMetadataSource: AI_THREAD_SOURCE
        }
      }
    ),
    /main frame/
  )
  assert.equal(service.searches.length, 2)
  assert.deepEqual(
    service.cancellations,
    senders.map(({ sender }) => `${sender.id}:request-${sender.id}`)
  )
})

test("launcher search rejects unowned senders before calling the service", async () => {
  const { ipcMain, registerIdentity, service } = await createHarness()
  const settingsSender = new FakeWebContents(25)
  registerIdentity(settingsSender, { kind: "settings" })

  await assert.rejects(
    ipcMain.invoke("launcher:search", settingsSender, {
      callerId: "settings-request",
      request: { limit: 10, query: "jingle", sources: ["applications"] }
    }),
    /Launcher search can only be invoked/
  )
  await assert.rejects(
    ipcMain.invoke("launcher:cancelSearch", settingsSender, {
      callerId: "settings-request"
    }),
    /authorized window sender/
  )

  const unregisteredSender = new FakeWebContents(26)
  await assert.rejects(
    ipcMain.invoke("launcher:search", unregisteredSender, {
      callerId: "unregistered-request",
      request: { limit: 10, query: "jingle", sources: ["applications"] }
    }),
    /Launcher search can only be invoked/
  )

  assert.deepEqual(service.searches, [])
  assert.deepEqual(service.cancellations, [])
})

test("launcher search rejects malformed requests before calling the service", async () => {
  const { ipcMain, registerIdentity, service } = await createHarness()
  const sender = new FakeWebContents(31)
  registerIdentity(sender, { kind: "launcher" })
  const canonicalRequest = { limit: 10, query: "jingle", sources: ["applications"] }
  const invalidInvocations: unknown[] = [
    null,
    {},
    { callerId: "request", request: { ...canonicalRequest, unexpected: true } },
    { callerId: "request", request: { ...canonicalRequest, limit: Number.NaN } },
    { callerId: "request", request: { ...canonicalRequest, limit: Number.POSITIVE_INFINITY } },
    { callerId: "request", request: { ...canonicalRequest, limit: 1.5 } },
    { callerId: "request", request: { ...canonicalRequest, limit: 0 } },
    { callerId: "request", request: { ...canonicalRequest, limit: -1 } },
    {
      callerId: "request",
      request: { ...canonicalRequest, limit: MAX_LAUNCHER_SEARCH_RESULTS + 1 }
    },
    { callerId: "request", request: { ...canonicalRequest, query: 42 } },
    {
      callerId: "request",
      request: { ...canonicalRequest, query: "x".repeat(MAX_LAUNCHER_SEARCH_QUERY_LENGTH + 1) }
    },
    {
      callerId: "request",
      request: { ...canonicalRequest, sources: ["applications", "applications"] }
    },
    { callerId: "request", request: { ...canonicalRequest, sources: ["unknown"] } },
    {
      callerId: "x".repeat(MAX_LAUNCHER_SEARCH_CALLER_ID_LENGTH + 1),
      request: canonicalRequest
    },
    { callerId: "request", request: canonicalRequest, unexpected: true }
  ]

  for (const invocation of invalidInvocations) {
    await assertInvalidArgument(ipcMain.invoke("launcher:search", sender, invocation))
  }
  await assertInvalidArgument(
    ipcMain.invoke(
      "launcher:search",
      sender,
      {
        callerId: "request",
        request: canonicalRequest
      },
      "unexpected"
    )
  )

  assert.deepEqual(service.searches, [])
})

test("launcher search rejects malformed cancellation before calling the service", async () => {
  const { ipcMain, registerIdentity, service } = await createHarness()
  const sender = new FakeWebContents(41)
  registerIdentity(sender, { kind: "launcher" })

  for (const cancellation of [
    null,
    {},
    { callerId: "" },
    { callerId: "x".repeat(MAX_LAUNCHER_SEARCH_CALLER_ID_LENGTH + 1) },
    { callerId: "request", unexpected: true }
  ]) {
    await assertInvalidArgument(ipcMain.invoke("launcher:cancelSearch", sender, cancellation))
  }
  await assertInvalidArgument(
    ipcMain.invoke("launcher:cancelSearch", sender, { callerId: "request" }, "unexpected")
  )

  assert.deepEqual(service.cancellations, [])
})
