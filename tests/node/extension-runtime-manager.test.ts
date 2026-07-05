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
  ExtensionRuntimeLaunchPackageRef,
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
  const host: ExtensionRuntimeHostCapabilities = {
    askAI: async () => "AI response",
    confirmAlert: () => true,
    getRuntimeCapabilities: () => [
      "agent",
      "clipboard",
      "dialog",
      "ai",
      "navigation",
      "preferences",
      "rpc",
      "settings",
      "shell",
      "storage",
      "toast",
      "quicklinks"
    ],
    getCommandPreferences: () => ({ showCreated: true }),
    getExtensionPreferences: () => ({ apiBaseUrl: "https://api.github.com" }),
    getStorageValue: () => undefined,
    listStorageValues: () => ({}),
    removeStorageValue: () => undefined,
    clearStorageValues: () => undefined,
    handleNavigationRequest: () => undefined,
    handleRunBotAgentRequest: () => null,
    invokeNativeExtension: async () => null,
    openExtensionSettings: () => undefined,
    openExternal: async () => undefined,
    pasteClipboardText: () => undefined,
    readClipboardText: () => "",
    readSelectedText: () => "",
    registerQuicklink: () => undefined,
    setStorageValue: () => undefined,
    showToast: () => undefined,
    writeClipboardText: () => undefined
  }

  return {
    ...host,
    ...overrides
  } as ExtensionRuntimeHostCapabilities
}

function createManager(
  params: {
    host?: ExtensionRuntimeHostCapabilities
    launcher?: FakeRuntimeProcessLauncher
    onEventAck?: ConstructorParameters<typeof ExtensionRuntimeManager>[0]["onEventAck"]
    onError?: ConstructorParameters<typeof ExtensionRuntimeManager>[0]["onError"]
    onSurface?: ConstructorParameters<typeof ExtensionRuntimeManager>[0]["onSurface"]
    resolveRuntimePackage?: ConstructorParameters<
      typeof ExtensionRuntimeManager
    >[0]["resolveRuntimePackage"]
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
    processLauncher: launcher,
    resolveRuntimePackage:
      params.resolveRuntimePackage ??
      (() =>
        ({
          extensionName: "github",
          kind: "built-in",
          version: "built-in"
        }) satisfies ExtensionRuntimeLaunchPackageRef)
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
    runtime: {
      extensionName: "github",
      kind: "built-in",
      version: "built-in"
    },
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

test("runtime manager forwards RunBotAgent requests to the host capability", async () => {
  let capturedRequest:
    | Parameters<ExtensionRuntimeHostCapabilities["handleRunBotAgentRequest"]>[0]
    | null = null
  const host = createHost({
    handleRunBotAgentRequest: (params) => {
      capturedRequest = params
      return {
        threadId: "thread-1"
      }
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "agent",
    id: "agent-1",
    method: "run-bot-agent",
    payload: {
      prompt: {
        objective: "Fix the GitHub issue"
      },
      title: "Fix GitHub issue"
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
    launcher.processes[0]?.messages.find(
      (message) => message.type === "host-response" && message.response.id === "agent-1"
    ),
    {
      response: {
        id: "agent-1",
        ok: true,
        result: {
          threadId: "thread-1"
        }
      },
      sessionId: "session-1",
      type: "host-response"
    }
  )
})

test("runtime manager forwards clipboard write requests to the host capability", async () => {
  const clipboardWrites: Array<{ html?: string; text: string }> = []
  const host = createHost({
    writeClipboardText: (content) => {
      clipboardWrites.push(content)
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "clipboard",
    id: "clipboard-1",
    method: "write-text",
    payload: {
      html: "<strong>Copied from runtime</strong>",
      text: "Copied from runtime"
    }
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  assert.deepEqual(clipboardWrites, [
    {
      html: "<strong>Copied from runtime</strong>",
      text: "Copied from runtime"
    }
  ])
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

test("runtime manager forwards clipboard paste requests to the host capability", async () => {
  const clipboardPastes: Array<{ html?: string; text: string }> = []
  const host = createHost({
    pasteClipboardText: (content) => {
      clipboardPastes.push(content)
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "clipboard",
    id: "clipboard-paste-1",
    method: "paste-text",
    payload: {
      html: "<strong>Pasted from runtime</strong>",
      text: "Pasted from runtime"
    }
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  assert.deepEqual(clipboardPastes, [
    {
      html: "<strong>Pasted from runtime</strong>",
      text: "Pasted from runtime"
    }
  ])
  assert.deepEqual(
    launcher.processes[0]?.messages.find((message) => message.type === "host-response"),
    {
      response: {
        id: "clipboard-paste-1",
        ok: true,
        result: null
      },
      sessionId: "session-1",
      type: "host-response"
    }
  )
})

test("runtime manager forwards clipboard read requests to the host capability", async () => {
  const host = createHost({
    readClipboardText: () => "Clipboard text from host"
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "clipboard",
    id: "clipboard-read-1",
    method: "read-text"
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  assert.deepEqual(
    launcher.processes[0]?.messages.find((message) => message.type === "host-response"),
    {
      response: {
        id: "clipboard-read-1",
        ok: true,
        result: "Clipboard text from host"
      },
      sessionId: "session-1",
      type: "host-response"
    }
  )
})

test("runtime manager forwards selected text read requests to the host capability", async () => {
  const host = createHost({
    readSelectedText: () => "Selected text from host"
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "clipboard",
    id: "selected-text-read-1",
    method: "read-selected-text"
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  assert.deepEqual(
    launcher.processes[0]?.messages.find((message) => message.type === "host-response"),
    {
      response: {
        id: "selected-text-read-1",
        ok: true,
        result: "Selected text from host"
      },
      sessionId: "session-1",
      type: "host-response"
    }
  )
})

test("runtime manager forwards toast requests to the host capability", async () => {
  const toasts: unknown[] = []
  const host = createHost({
    showToast: (params) => {
      toasts.push(params)
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "toast",
    id: "toast-1",
    method: "show",
    payload: {
      message: "Page title",
      primaryAction: {
        id: "toast-action-0",
        shortcut: {
          key: "c",
          modifiers: ["cmd"]
        },
        title: "Copy URL"
      },
      style: "success",
      title: "Page created"
    }
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  assert.deepEqual(toasts, [
    {
      sessionId: "session-1",
      toast: {
        message: "Page title",
        primaryAction: {
          id: "toast-action-0",
          shortcut: {
            key: "c",
            modifiers: ["cmd"]
          },
          title: "Copy URL"
        },
        style: "success",
        title: "Page created"
      }
    }
  ])
  assert.deepEqual(
    launcher.processes[0]?.messages.find((message) => message.type === "host-response"),
    {
      response: {
        id: "toast-1",
        ok: true,
        result: null
      },
      sessionId: "session-1",
      type: "host-response"
    }
  )
})

test("runtime manager forwards dialog confirm requests to the host capability", async () => {
  const alerts: unknown[] = []
  const host = createHost({
    confirmAlert: (alert) => {
      alerts.push(alert)
      return false
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "dialog",
    id: "dialog-1",
    method: "confirm-alert",
    payload: {
      message: "This page can be restored from trash.",
      primaryAction: {
        style: "destructive",
        title: "Delete Page"
      },
      title: "Delete Page"
    }
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  assert.deepEqual(alerts, [
    {
      message: "This page can be restored from trash.",
      primaryAction: {
        style: "destructive",
        title: "Delete Page"
      },
      title: "Delete Page"
    }
  ])
  assert.deepEqual(
    launcher.processes[0]?.messages.find((message) => message.type === "host-response"),
    {
      response: {
        id: "dialog-1",
        ok: true,
        result: false
      },
      sessionId: "session-1",
      type: "host-response"
    }
  )
})

test("runtime manager forwards extension-scoped storage requests to the host capability", async () => {
  const storageCalls: unknown[] = []
  const host = createHost({
    getStorageValue: (params) => {
      storageCalls.push(["get", params])
      return "stored value"
    },
    setStorageValue: (params) => {
      storageCalls.push(["set", params])
    },
    removeStorageValue: (params) => {
      storageCalls.push(["remove", params])
    },
    listStorageValues: (params) => {
      storageCalls.push(["all-items", params])
      return {
        recentPage: "page-1"
      }
    },
    clearStorageValues: (params) => {
      storageCalls.push(["clear", params])
    }
  })
  const { launcher, manager } = createManager({ host })
  const context = createLaunchContext()

  await manager.startForeground(context)
  const requests: ExtensionHostRequest[] = [
    {
      capability: "storage",
      id: "storage-get",
      method: "get",
      payload: {
        key: "recentPage",
        scope: "extension"
      }
    },
    {
      capability: "storage",
      id: "storage-set",
      method: "set",
      payload: {
        key: "recentPage",
        scope: "extension",
        value: "page-2"
      }
    },
    {
      capability: "storage",
      id: "storage-all",
      method: "all-items",
      payload: {
        scope: "extension"
      }
    },
    {
      capability: "storage",
      id: "storage-remove",
      method: "remove",
      payload: {
        key: "recentPage",
        scope: "extension"
      }
    },
    {
      capability: "storage",
      id: "storage-clear",
      method: "clear",
      payload: {
        scope: "extension"
      }
    }
  ]

  for (const request of requests) {
    launcher.processes[0]?.emitMessage({
      request,
      sessionId: "session-1",
      type: "host-request"
    })
    await flushPromises()
  }

  assert.deepEqual(storageCalls, [
    [
      "get",
      {
        context,
        key: "recentPage",
        scope: "extension"
      }
    ],
    [
      "set",
      {
        context,
        key: "recentPage",
        scope: "extension",
        value: "page-2"
      }
    ],
    [
      "all-items",
      {
        context,
        scope: "extension"
      }
    ],
    [
      "remove",
      {
        context,
        key: "recentPage",
        scope: "extension"
      }
    ],
    [
      "clear",
      {
        context,
        scope: "extension"
      }
    ]
  ])

  assert.deepEqual(
    launcher.processes[0]?.messages
      .filter((message) => message.type === "host-response")
      .map((message) => message.response),
    [
      {
        id: "storage-get",
        ok: true,
        result: "stored value"
      },
      {
        id: "storage-set",
        ok: true,
        result: null
      },
      {
        id: "storage-all",
        ok: true,
        result: {
          recentPage: "page-1"
        }
      },
      {
        id: "storage-remove",
        ok: true,
        result: null
      },
      {
        id: "storage-clear",
        ok: true,
        result: null
      }
    ]
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

test("runtime manager forwards requested desktop URL schemes and app targets with shell requests", async () => {
  const opened: Array<{
    allowedUrlSchemes: readonly string[]
    application?: { bundleId?: string; name?: string; path?: string }
    url: string
  }> = []
  const host = createHost({
    openExternal: async (params) => {
      opened.push({
        allowedUrlSchemes: params.allowedUrlSchemes,
        application: params.application,
        url: params.url
      })
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchContext())
  const request: ExtensionHostRequest = {
    capability: "shell",
    id: "shell-1",
    method: "open-external",
    payload: {
      allowedUrlSchemes: ["notion"],
      application: {
        bundleId: "notion.id",
        name: "Notion"
      },
      url: "notion://www.notion.so/page-1"
    }
  }

  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  assert.deepEqual(opened, [
    {
      allowedUrlSchemes: ["notion"],
      application: {
        bundleId: "notion.id",
        name: "Notion"
      },
      url: "notion://www.notion.so/page-1"
    }
  ])
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
