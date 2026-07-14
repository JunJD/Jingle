import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { ExtensionRuntimeController } from "../../src/main/services/extension-runtime/controller"
import type { ExtensionRuntimeRendererBridge } from "../../src/main/services/extension-runtime/renderer-bridge"
import type { ExtensionRuntimeManager } from "../../src/main/services/extension-runtime/runtime-manager"

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

  constructor(readonly id: number) {
    super()
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  send(): void {
    return undefined
  }
}

function createRuntimeManagerStub(calls: string[] = []): ExtensionRuntimeManager {
  return {
    onError: () => () => undefined,
    onEventAck: () => () => undefined,
    onSessionStopped: () => () => undefined,
    onSurface: () => () => undefined,
    runOnce: async () => {
      calls.push("runOnce")
      return { sessionId: "runtime-session", status: "ready" }
    },
    startForeground: async () => {
      calls.push("startForeground")
      return {
        intent: {
          commandName: "command",
          extensionName: "extension",
          initialAction: "open",
          seedQuery: ""
        },
        kind: "foreground",
        sessionId: "runtime-session"
      }
    },
    stopSessionById: () => {
      calls.push("stopSessionById")
      return true
    }
  } as unknown as ExtensionRuntimeManager
}

function createRendererBridgeStub(calls: string[] = []): ExtensionRuntimeRendererBridge {
  return {
    bindSession: (sessionId: string) => {
      calls.push(`bindSession:${sessionId}`)
    },
    completeNavigationRequest: () => {
      calls.push("completeNavigationRequest")
      return true
    },
    completeRunBotAgentRequest: () => {
      calls.push("completeRunBotAgentRequest")
      return true
    },
    getSessionOwner: () => null,
    isSessionOwner: () => false,
    onSessionOwnerDetached: () => () => undefined,
    releaseSession: (sessionId: string) => {
      calls.push(`releaseSession:${sessionId}`)
    }
  } as unknown as ExtensionRuntimeRendererBridge
}

function createLauncherSenderPredicate(authorized: WeakSet<WebContents>) {
  return (sender: WebContents): boolean => authorized.has(sender) && !sender.isDestroyed()
}

test("extension runtime surface subscription does not accumulate destroyed listeners", async () => {
  const sender = new FakeWebContents(1)
  const controller = new ExtensionRuntimeController(
    createRuntimeManagerStub(),
    createRendererBridgeStub(),
    createLauncherSenderPredicate(new WeakSet([sender as unknown as WebContents]))
  )
  const ipcMain = new FakeIpcMain()

  controller.register(ipcMain as unknown as IpcMain)

  for (let index = 0; index < 20; index += 1) {
    await ipcMain.invoke("extensionRuntime:subscribeSurfaces", sender)
  }

  assert.equal(sender.listenerCount("destroyed"), 1)

  await ipcMain.invoke("extensionRuntime:unsubscribeSurfaces", sender)
  assert.equal(sender.listenerCount("destroyed"), 0)
})

test("extension runtime IPC rejects every non-Launcher sender before touching runtime owners", async () => {
  const managerCalls: string[] = []
  const bridgeCalls: string[] = []
  const launcher = new FakeWebContents(1)
  const settings = new FakeWebContents(2)
  const pinned = new FakeWebContents(3)
  const unknown = new FakeWebContents(4)
  const destroyedLauncher = new FakeWebContents(5)
  destroyedLauncher.destroyed = true
  const authorized = new WeakSet<WebContents>([
    launcher as unknown as WebContents,
    destroyedLauncher as unknown as WebContents
  ])
  const controller = new ExtensionRuntimeController(
    createRuntimeManagerStub(managerCalls),
    createRendererBridgeStub(bridgeCalls),
    createLauncherSenderPredicate(authorized)
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)

  const rejectedCalls: Array<{ args: unknown[]; channel: string }> = [
    { args: [], channel: "extensionRuntime:subscribeSurfaces" },
    { args: [], channel: "extensionRuntime:unsubscribeSurfaces" },
    { args: [{}], channel: "extensionRuntime:startForeground" },
    { args: [{}], channel: "extensionRuntime:runOnce" },
    { args: ["session"], channel: "extensionRuntime:stopForeground" },
    { args: ["session", {}], channel: "extensionRuntime:sendEvent" },
    { args: [{}], channel: "extensionRuntime:completeNavigationRequest" },
    { args: [{}], channel: "extensionRuntime:completeRunBotAgentRequest" }
  ]

  for (const sender of [settings, pinned, unknown, destroyedLauncher]) {
    for (const call of rejectedCalls) {
      await assert.rejects(
        ipcMain.invoke(call.channel, sender, ...call.args),
        /only available to the Launcher window/
      )
    }
    assert.equal(sender.listenerCount("destroyed"), 0)
  }

  for (const call of rejectedCalls) {
    await assert.rejects(
      ipcMain.invokeFromFrame(call.channel, launcher, {}, ...call.args),
      /only available to the renderer main frame/
    )
  }

  assert.deepEqual(managerCalls, [])
  assert.deepEqual(bridgeCalls, [])
})

test("extension runtime start IPC rejects malformed outer requests before manager admission", async () => {
  const managerCalls: string[] = []
  const bridgeCalls: string[] = []
  const launcher = new FakeWebContents(1)
  const authorized = new WeakSet<WebContents>([launcher as unknown as WebContents])
  const controller = new ExtensionRuntimeController(
    createRuntimeManagerStub(managerCalls),
    createRendererBridgeStub(bridgeCalls),
    createLauncherSenderPredicate(authorized)
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)

  let intentGetterReads = 0
  const accessorRequest = { sessionId: "runtime-session" }
  Object.defineProperty(accessorRequest, "intent", {
    enumerable: true,
    get: () => {
      intentGetterReads += 1
      return {
        commandName: "command",
        extensionName: "extension",
        initialAction: "open",
        seedQuery: ""
      }
    }
  })
  const invalidRequests = [
    {
      error: /enumerable data property/,
      request: accessorRequest
    },
    {
      error: /extension runtime start request contains unsupported property/,
      request: {
        extra: true,
        intent: {
          commandName: "command",
          extensionName: "extension",
          initialAction: "open",
          seedQuery: ""
        },
        sessionId: "runtime-session"
      }
    },
    {
      error: /sessionId must be a non-empty string/,
      request: {
        intent: {
          commandName: "command",
          extensionName: "extension",
          initialAction: "open",
          seedQuery: ""
        },
        sessionId: ""
      }
    }
  ]

  for (const channel of ["extensionRuntime:startForeground", "extensionRuntime:runOnce"]) {
    for (const invalid of invalidRequests) {
      await assert.rejects(ipcMain.invoke(channel, launcher, invalid.request), invalid.error)
    }
  }

  assert.equal(intentGetterReads, 0)
  assert.deepEqual(managerCalls, [])
  assert.deepEqual(bridgeCalls, [])
})

test("extension runtime start IPC admits normalized Launcher requests and binds their sessions", async () => {
  const launcher = new FakeWebContents(1)
  const bridgeCalls: string[] = []
  const captured: Array<{ intent: unknown; kind: string; sessionId: string | undefined }> = []
  const runtimeManager = {
    onError: () => () => undefined,
    onEventAck: () => () => undefined,
    onSessionStopped: () => () => undefined,
    onSurface: () => () => undefined,
    runOnce: (
      intent: Parameters<ExtensionRuntimeManager["runOnce"]>[0],
      options: Parameters<ExtensionRuntimeManager["runOnce"]>[1]
    ) => {
      captured.push({ intent, kind: "run-once", sessionId: options?.sessionId })
      const session = {
        intent,
        kind: "run-once" as const,
        sessionId: options?.sessionId ?? "generated-run-once"
      }
      options?.onSessionStart?.(session)
      return Promise.resolve({ sessionId: session.sessionId, status: "ready" as const })
    },
    startForeground: async (
      intent: Parameters<ExtensionRuntimeManager["startForeground"]>[0],
      options: Parameters<ExtensionRuntimeManager["startForeground"]>[1]
    ) => {
      captured.push({ intent, kind: "foreground", sessionId: options?.sessionId })
      const session = {
        intent,
        kind: "foreground" as const,
        sessionId: options?.sessionId ?? "generated-foreground"
      }
      options?.onSessionStart?.(session)
      return session
    }
  } as unknown as ExtensionRuntimeManager
  const controller = new ExtensionRuntimeController(
    runtimeManager,
    createRendererBridgeStub(bridgeCalls),
    createLauncherSenderPredicate(new WeakSet<WebContents>([launcher as unknown as WebContents]))
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const foregroundRequest = {
    intent: {
      commandName: "command",
      extensionName: "extension",
      initialAction: "submit",
      launchProps: {
        arguments: { issue: "before" }
      },
      seedQuery: "query"
    },
    sessionId: "foreground-session"
  }

  await ipcMain.invoke("extensionRuntime:startForeground", launcher, foregroundRequest)
  await ipcMain.invoke("extensionRuntime:runOnce", launcher, {
    intent: {
      commandName: "command",
      extensionName: "extension",
      initialAction: "open",
      seedQuery: ""
    },
    sessionId: "run-once-session"
  })
  foregroundRequest.intent.launchProps.arguments.issue = "after"

  assert.equal(captured.length, 2)
  assert.deepEqual(
    captured.map((entry) => [entry.kind, entry.sessionId]),
    [
      ["foreground", "foreground-session"],
      ["run-once", "run-once-session"]
    ]
  )
  const foregroundIntent = captured[0]?.intent as {
    launchProps: { arguments: { issue: string } }
  }
  assert.equal(foregroundIntent.launchProps.arguments.issue, "before")
  assert.equal(Object.isFrozen(foregroundIntent), true)
  assert.equal(Object.isFrozen(foregroundIntent.launchProps), true)
  assert.deepEqual(bridgeCalls, ["bindSession:foreground-session", "bindSession:run-once-session"])
})
