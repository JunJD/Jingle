import assert from "node:assert/strict"
import test from "node:test"
import {
  ExtensionRuntimeManager,
  type ExtensionRuntimeHostCapabilities
} from "../../src/main/services/extension-runtime/runtime-manager"
import type {
  ExtensionHostRequest,
  ExtensionHostToRuntimeMessage,
  ExtensionRuntimeLaunchContext,
  ExtensionRuntimeToHostMessage,
  ExtensionSurfaceSnapshot
} from "../../src/shared/extension-runtime-protocol"
import type {
  ExtensionRuntimeProcess,
  ExtensionRuntimeProcessLauncher
} from "../../src/main/services/extension-runtime/runtime-process"

class FakeRuntimeProcess implements ExtensionRuntimeProcess {
  killed = false
  messages: ExtensionHostToRuntimeMessage[] = []
  pid = 100
  private exitListeners = new Set<(code: number) => void>()
  private messageListeners = new Set<(message: ExtensionRuntimeToHostMessage) => void>()

  emitExit(code: number): void {
    for (const listener of this.exitListeners) {
      listener(code)
    }
  }

  emitMessage(message: ExtensionRuntimeToHostMessage): void {
    for (const listener of this.messageListeners) {
      listener(message)
    }
  }

  kill(): void {
    this.killed = true
  }

  onExit(listener: (code: number) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  onMessage(listener: (message: ExtensionRuntimeToHostMessage) => void): () => void {
    this.messageListeners.add(listener)
    return () => {
      this.messageListeners.delete(listener)
    }
  }

  postMessage(message: ExtensionHostToRuntimeMessage): void {
    this.messages.push(message)
  }
}

class FakeRuntimeProcessLauncher implements ExtensionRuntimeProcessLauncher {
  processes: FakeRuntimeProcess[] = []

  launch(): ExtensionRuntimeProcess {
    const process = new FakeRuntimeProcess()
    process.pid = 100 + this.processes.length
    this.processes.push(process)
    return process
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return {
    promise,
    resolve
  }
}

function createLaunchContext(): ExtensionRuntimeLaunchContext {
  return {
    commandName: "my-issues",
    commandPreferences: {},
    extensionName: "github",
    extensionPreferences: {},
    initialAction: "open",
    locale: "zh-CN",
    mode: "view",
    seedQuery: ""
  }
}

function createHost(
  overrides: Partial<ExtensionRuntimeHostCapabilities> = {}
): ExtensionRuntimeHostCapabilities {
  return {
    askAI: async () => "AI response",
    getRuntimeCapabilities: () => [
      "clipboard",
      "ai",
      "navigation",
      "preferences",
      "rpc",
      "settings",
      "shell",
      "storage"
    ],
    getCommandPreferences: () => ({ showCreated: true }),
    getExtensionPreferences: () => ({ apiBaseUrl: "https://api.github.com" }),
    getStorageValue: () => undefined,
    handleNavigationRequest: () => undefined,
    invokeNativeExtension: async () => null,
    openExtensionSettings: () => undefined,
    openExternal: async () => undefined,
    setStorageValue: () => undefined,
    writeClipboardText: () => undefined,
    ...overrides
  }
}

function createManager(
  params: {
    host?: ExtensionRuntimeHostCapabilities
    launcher?: FakeRuntimeProcessLauncher
    onEventAck?: ConstructorParameters<typeof ExtensionRuntimeManager>[0]["onEventAck"]
    onError?: ConstructorParameters<typeof ExtensionRuntimeManager>[0]["onError"]
    onSurface?: ConstructorParameters<typeof ExtensionRuntimeManager>[0]["onSurface"]
    sessionIds?: string[]
  } = {}
) {
  const launcher = params.launcher ?? new FakeRuntimeProcessLauncher()
  const sessionIds = [...(params.sessionIds ?? ["session-1", "session-2", "session-3"])]
  const manager = new ExtensionRuntimeManager({
    createSessionId: () => {
      const sessionId = sessionIds.shift()
      assert.ok(sessionId)
      return sessionId
    },
    host: params.host ?? createHost(),
    onEventAck: params.onEventAck,
    onError: params.onError,
    onSurface: params.onSurface,
    processLauncher: launcher
  })

  return {
    launcher,
    manager
  }
}

function createSurface(sessionId: string): ExtensionSurfaceSnapshot {
  return {
    commandName: "my-issues",
    description: sessionId,
    extensionName: "github",
    kind: "error",
    revision: 1,
    title: "Runtime Surface"
  }
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

test("runtime manager starts and stops a foreground utility session", async () => {
  const { launcher, manager } = createManager()

  const session = await manager.startForeground(createLaunchContext())

  assert.equal(session.sessionId, "session-1")
  assert.equal(session.pid, 100)
  assert.deepEqual(launcher.processes[0]?.messages[0], {
    context: createLaunchContext(),
    sessionId: "session-1",
    type: "start"
  })
  assert.deepEqual(manager.getForegroundSession(), session)

  assert.equal(manager.stopForeground("session-1"), true)
  assert.deepEqual(launcher.processes[0]?.messages[1], {
    sessionId: "session-1",
    type: "stop"
  })
  assert.equal(launcher.processes[0]?.killed, true)
  assert.equal(manager.getForegroundSession(), null)
})

test("runtime manager drops messages from a stopped foreground session", async () => {
  const surfaces: ExtensionSurfaceSnapshot[] = []
  const { launcher, manager } = createManager({
    onSurface: (surface) => {
      surfaces.push(surface)
    }
  })

  await manager.startForeground(createLaunchContext())
  await manager.startForeground(createLaunchContext())

  launcher.processes[0]?.emitMessage({
    sessionId: "session-1",
    surface: createSurface("session-1"),
    type: "surface"
  })
  launcher.processes[1]?.emitMessage({
    sessionId: "session-2",
    surface: createSurface("session-2"),
    type: "surface"
  })

  assert.equal(launcher.processes[0]?.killed, true)
  assert.equal(surfaces.length, 1)
  assert.equal(surfaces[0]?.kind, "error")
  assert.equal(surfaces[0]?.description, "session-2")
})

test("runtime manager records structured crash errors", async () => {
  const errors: string[] = []
  const { launcher, manager } = createManager({
    onError: (error) => {
      errors.push(error.error.code)
    }
  })

  await manager.startForeground(createLaunchContext())
  launcher.processes[0]?.emitExit(42)

  assert.equal(manager.getForegroundSession(), null)
  assert.equal(manager.getLastError()?.error.code, "runtime_crashed")
  assert.deepEqual(errors, ["runtime_crashed"])
})

test("runtime manager forwards event acks for the active session", async () => {
  const acks: string[] = []
  const { launcher, manager } = createManager({
    onEventAck: (ack, session) => {
      acks.push(`${session.sessionId}:${ack.changeId}:${ack.ok}`)
    }
  })

  await manager.startForeground(createLaunchContext())
  launcher.processes[0]?.emitMessage({
    ack: {
      changeId: "change-1",
      eventType: "form.field.change",
      fieldId: "title",
      ok: true
    },
    sessionId: "session-1",
    type: "event-ack"
  })

  assert.deepEqual(acks, ["session-1:change-1:true"])
})

test("runtime manager drops event acks from stopped sessions", async () => {
  const acks: string[] = []
  const { launcher, manager } = createManager({
    onEventAck: (ack) => {
      acks.push(ack.changeId)
    }
  })

  await manager.startForeground(createLaunchContext())
  await manager.startForeground(createLaunchContext())
  launcher.processes[0]?.emitMessage({
    ack: {
      changeId: "change-1",
      eventType: "form.field.change",
      fieldId: "title",
      ok: true
    },
    sessionId: "session-1",
    type: "event-ack"
  })

  assert.deepEqual(acks, [])
})

test("runtime manager responds to host requests and drops late responses after stop", async () => {
  const deferredPreferences = createDeferred<Record<string, unknown>>()
  const host = createHost({
    getExtensionPreferences: () => deferredPreferences.promise
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "preferences",
    id: "preferences-1",
    method: "get-extension-preferences",
    payload: {
      extensionName: "github"
    }
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  manager.stopForeground("session-1")
  deferredPreferences.resolve({ apiBaseUrl: "https://api.github.com" })
  await flushPromises()

  assert.equal(
    launcher.processes[0]?.messages.some((message) => message.type === "host-response"),
    false
  )
})

test("runtime manager forwards navigation requests to the host capability", async () => {
  let capturedRequest:
    | Parameters<ExtensionRuntimeHostCapabilities["handleNavigationRequest"]>[0]
    | null = null
  const host = createHost({
    handleNavigationRequest: (params) => {
      capturedRequest = params
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "navigation",
    id: "navigation-1",
    method: "open-command",
    payload: {
      commandName: "my-pull-requests",
      extensionName: "github"
    }
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  assert.deepEqual(capturedRequest, {
    request,
    sessionId: "session-1"
  })
  assert.deepEqual(
    launcher.processes[0]?.messages.find((message) => message.type === "host-response"),
    {
      response: {
        id: "navigation-1",
        ok: true,
        result: undefined
      },
      sessionId: "session-1",
      type: "host-response"
    }
  )
})

test("runtime manager forwards clipboard write requests to the host capability", async () => {
  const clipboardWrites: string[] = []
  const host = createHost({
    writeClipboardText: (text) => {
      clipboardWrites.push(text)
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "clipboard",
    id: "clipboard-1",
    method: "write-text",
    payload: {
      text: "Copied from runtime"
    }
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  assert.deepEqual(clipboardWrites, ["Copied from runtime"])
  assert.deepEqual(
    launcher.processes[0]?.messages.find((message) => message.type === "host-response"),
    {
      response: {
        id: "clipboard-1",
        ok: true,
        result: null
      },
      sessionId: "session-1",
      type: "host-response"
    }
  )
})

test("runtime manager forwards AI ask requests to the host capability", async () => {
  const aiRequests: unknown[] = []
  const host = createHost({
    askAI: async (input) => {
      aiRequests.push(input)
      return "Translated text"
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "ai",
    id: "ai-1",
    method: "ask",
    payload: {
      modelId: "openai:gpt-test",
      prompt: "hello",
      system: "Translate.",
      temperature: 0
    }
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  assert.deepEqual(aiRequests, [
    {
      modelId: "openai:gpt-test",
      prompt: "hello",
      system: "Translate.",
      temperature: 0
    }
  ])
  assert.deepEqual(
    launcher.processes[0]?.messages.find((message) => message.type === "host-response"),
    {
      response: {
        id: "ai-1",
        ok: true,
        result: "Translated text"
      },
      sessionId: "session-1",
      type: "host-response"
    }
  )
})

test("runtime manager rejects cross-extension host capability requests", async () => {
  let preferencesReadCount = 0
  const host = createHost({
    getExtensionPreferences: () => {
      preferencesReadCount += 1
      return {}
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "preferences",
    id: "preferences-1",
    method: "get-extension-preferences",
    payload: {
      extensionName: "todo-list"
    }
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  const response = launcher.processes[0]?.messages.find(
    (message) => message.type === "host-response"
  )
  assert.equal(response?.type, "host-response")
  assert.equal(response?.response.ok, false)
  assert.equal(preferencesReadCount, 0)
})

test("runtime manager stops run-once sessions after ready", async () => {
  const { launcher, manager } = createManager()
  const resultPromise = manager.runOnce(createLaunchContext())
  await flushPromises()

  launcher.processes[0]?.emitMessage({
    sessionId: "session-1",
    type: "ready"
  })

  assert.deepEqual(await resultPromise, {
    sessionId: "session-1",
    status: "ready"
  })
  assert.equal(launcher.processes[0]?.killed, true)
})

test("runtime manager reports run-once sessions when started", async () => {
  const { launcher, manager } = createManager()
  const startedSessionIds: string[] = []
  const processMessageCountsWhenStarted: number[] = []
  const resultPromise = manager.runOnce(createLaunchContext(), {
    onSessionStart: (session) => {
      startedSessionIds.push(session.sessionId)
      processMessageCountsWhenStarted.push(launcher.processes[0]?.messages.length ?? -1)
    }
  })
  await flushPromises()

  assert.deepEqual(startedSessionIds, ["session-1"])
  assert.deepEqual(processMessageCountsWhenStarted, [0])
  assert.equal(launcher.processes[0]?.messages[0]?.type, "start")

  launcher.processes[0]?.emitMessage({
    sessionId: "session-1",
    type: "ready"
  })
  await resultPromise
})

test("runtime manager stops run-once sessions after runtime errors", async () => {
  const { launcher, manager } = createManager()
  const resultPromise = manager.runOnce(createLaunchContext())
  await flushPromises()

  launcher.processes[0]?.emitMessage({
    error: {
      code: "runtime_error",
      message: "Command failed."
    },
    sessionId: "session-1",
    type: "error"
  })

  assert.deepEqual(await resultPromise, {
    error: {
      code: "runtime_error",
      message: "Command failed."
    },
    sessionId: "session-1",
    status: "error"
  })
  assert.equal(launcher.processes[0]?.killed, true)
})

test("runtime manager rejects undeclared host capability requests", async () => {
  let clipboardWriteCount = 0
  const host = createHost({
    getRuntimeCapabilities: () => ["preferences"],
    writeClipboardText: () => {
      clipboardWriteCount += 1
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "clipboard",
    id: "clipboard-1",
    method: "write-text",
    payload: {
      text: "Copied from runtime"
    }
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  const response = launcher.processes[0]?.messages.find(
    (message) => message.type === "host-response"
  )
  assert.equal(response?.type, "host-response")
  assert.equal(response?.response.ok, false)
  assert.equal(clipboardWriteCount, 0)
})

test("runtime manager rejects undeclared AI host capability requests", async () => {
  let aiRequestCount = 0
  const host = createHost({
    askAI: async () => {
      aiRequestCount += 1
      return "Translated text"
    },
    getRuntimeCapabilities: () => ["preferences"]
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "ai",
    id: "ai-1",
    method: "ask",
    payload: {
      prompt: "hello"
    }
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  const response = launcher.processes[0]?.messages.find(
    (message) => message.type === "host-response"
  )
  assert.equal(response?.type, "host-response")
  assert.equal(response?.response.ok, false)
  assert.equal(aiRequestCount, 0)
})
