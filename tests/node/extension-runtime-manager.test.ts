import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  ExtensionRuntimeHostError,
  ExtensionRuntimeLifecycleError,
  ExtensionRuntimeManager,
  type ExtensionRuntimeHostCapabilities
} from "../../src/main/services/extension-runtime/runtime-manager"
import { ExtensionRuntimeMenuBarService } from "../../src/main/services/extension-runtime/menu-bar-service"
import type { NativeMenuBarService } from "../../src/main/native-menu-bar/service"
import type { NativeMenuBarState } from "../../src/shared/native-menu-bar"
import {
  clearRuntimeSessionIssues,
  createRuntimeAdmissionAttempt,
  createRuntimeForegroundLaunchIntent,
  markRuntimeAdmissionTerminal,
  reduceRuntimeSessionIssues,
  shouldCommitRuntimeAdmission
} from "../../src/renderer/src/extension-runtime/runtime-extension-controller"
import {
  RuntimeIssueBand,
  RuntimeIssueSurfaceLayout
} from "../../src/renderer/src/extension-runtime/runtime-toast-overlay"
import { createRuntimeRunOnceLaunchIntent } from "../../src/renderer/src/extension-host"
import {
  createExtensionRuntimeNavigation,
  getActiveExtensionRuntimeSdk,
  launchCommand,
  LaunchType,
  runWithExtensionRuntimeSdk,
  sendExtensionRuntimeHostRequest,
  type ExtensionRuntimeSdkContextValue
} from "../../packages/extension-api/src/extension-runtime/sdk/runtime-context"
import type {
  ExtensionHostRequest,
  ExtensionHostToRuntimeMessage,
  ExtensionRuntimeHostCapability,
  ExtensionRuntimeLaunchIntent,
  ExtensionRuntimeRecoverableIssue,
  ExtensionRuntimeSessionError,
  ExtensionRuntimeSessionInfo,
  ExtensionRuntimeSessionIssueSnapshot,
  ExtensionRuntimeSessionKind,
  ExtensionRuntimeToHostMessage,
  ExtensionSurfaceSnapshot
} from "../../src/shared/extension-runtime-protocol"

type ExtensionRuntimeSessionIssue = ExtensionRuntimeSessionIssueSnapshot
import {
  normalizeExtensionRuntimeJsonFact,
  normalizeExtensionRuntimeLaunchIntent,
  normalizeExtensionRuntimeLaunchProps,
  normalizeExtensionRuntimeNavigationHostRequest,
  normalizeExtensionRuntimeNavigationRequestEvent,
  normalizeExtensionRuntimeStartRequest
} from "../../src/shared/extension-runtime-protocol"
import {
  createExtensionRuntimeUtilityExecutionLease,
  type ExtensionRuntimeExecutionLease,
  type ExtensionRuntimeExecutionLeaseOwner
} from "../../src/main/services/extension-runtime/execution-lease"
import type {
  ExtensionRuntimeProcess,
  ExtensionRuntimeProcessLauncher
} from "../../src/main/services/extension-runtime/runtime-process"

class FakeRuntimeProcess implements ExtensionRuntimeProcess {
  killCalls = 0
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
    this.killCalls += 1
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

function createLaunchIntent(): ExtensionRuntimeLaunchIntent {
  return {
    commandName: "my-issues",
    extensionName: "github",
    initialAction: "open",
    seedQuery: ""
  }
}

const DEFAULT_RUNTIME_CAPABILITIES: readonly ExtensionRuntimeHostCapability[] = [
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
]

function createTestLease(
  intent: ExtensionRuntimeLaunchIntent,
  kind: ExtensionRuntimeSessionKind,
  runtimeCapabilities: readonly ExtensionRuntimeHostCapability[] = DEFAULT_RUNTIME_CAPABILITIES
): ExtensionRuntimeExecutionLease {
  const configurationToken = {
    commandName: intent.commandName,
    connectionId: "default",
    extensionName: intent.extensionName,
    provider: "github",
    revisions: {
      commandConfigRevision: 0,
      connectionConfigRevision: 0,
      credentialRevision: 0,
      extensionConfigRevision: 0
    }
  }
  const extensionPreferences = {
    accessToken: "secret-token",
    apiBaseUrl: "https://api.github.com"
  }
  const invokeContext = {
    commandPreferences: {
      ...extensionPreferences,
      showCreated: true
    },
    configurationToken,
    connection: {
      connectionId: "default",
      extensionName: intent.extensionName,
      missingSecretNames: [],
      provider: "github",
      publicConfig: {
        apiBaseUrl: "https://api.github.com"
      },
      status: "connected" as const
    },
    extensionName: intent.extensionName,
    extensionPreferences
  }
  const mode =
    kind === "ambient"
      ? ("menu-bar" as const)
      : kind === "run-once"
        ? ("no-view" as const)
        : ("view" as const)
  const runtime = {
    extensionName: intent.extensionName,
    kind: "built-in" as const,
    version: "built-in"
  }

  return {
    configurationToken,
    intent,
    invokeContext,
    runtimeCapabilities,
    utility: createExtensionRuntimeUtilityExecutionLease({
      intent,
      invokeContext,
      locale: "zh-CN",
      mode,
      runtime,
      runtimeCapabilities
    })
  }
}

function createHost(
  overrides: Partial<ExtensionRuntimeHostCapabilities> = {}
): ExtensionRuntimeHostCapabilities {
  const host: ExtensionRuntimeHostCapabilities = {
    askAI: async () => "AI response",
    confirmAlert: () => true,
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
    onIssue?: ConstructorParameters<typeof ExtensionRuntimeManager>[0]["onIssueSnapshot"]
    onSurface?: ConstructorParameters<typeof ExtensionRuntimeManager>[0]["onSurface"]
    executionLeaseOwner?: ExtensionRuntimeExecutionLeaseOwner
    runtimeCapabilities?: readonly ExtensionRuntimeHostCapability[]
    sessionIds?: string[]
    subscribeConfigurationCommits?: ConstructorParameters<
      typeof ExtensionRuntimeManager
    >[0]["subscribeConfigurationCommits"]
  } = {}
) {
  const launcher = params.launcher ?? new FakeRuntimeProcessLauncher()
  const sessionIds = [...(params.sessionIds ?? ["session-1", "session-2", "session-3"])]
  const executionLeaseOwner =
    params.executionLeaseOwner ??
    ({
      isCurrent: () => true,
      resolve: (kind, intent) =>
        createTestLease(intent, kind, params.runtimeCapabilities ?? DEFAULT_RUNTIME_CAPABILITIES)
    } satisfies ExtensionRuntimeExecutionLeaseOwner)
  const manager = new ExtensionRuntimeManager({
    createSessionId: () => {
      const sessionId = sessionIds.shift()
      assert.ok(sessionId)
      return sessionId
    },
    executionLeaseOwner,
    host: params.host ?? createHost(),
    onEventAck: params.onEventAck,
    onError: params.onError,
    onIssueSnapshot: params.onIssue,
    onSurface: params.onSurface,
    processLauncher: launcher,
    subscribeConfigurationCommits: params.subscribeConfigurationCommits
  })

  return {
    launcher,
    manager
  }
}

test("extension runtime JSON facts detach and deeply freeze plain finite data", () => {
  const source = {
    nested: {
      items: [{ count: -0, label: "before" }]
    }
  }
  const normalized = normalizeExtensionRuntimeJsonFact(source) as {
    nested: { items: Array<{ count: number; label: string }> }
  }

  source.nested.items[0]!.label = "after"

  assert.notEqual(normalized, source)
  assert.equal(normalized.nested.items[0]?.label, "before")
  assert.equal(Object.is(normalized.nested.items[0]?.count, -0), false)
  assert.equal(Object.isFrozen(normalized), true)
  assert.equal(Object.isFrozen(normalized.nested), true)
  assert.equal(Object.isFrozen(normalized.nested.items), true)
  assert.equal(Object.isFrozen(normalized.nested.items[0]), true)
})

test("recoverable runtime issues remain visible until their exact resolution", () => {
  const first = {
    code: "storage_legacy_unowned" as const,
    id: `storage-legacy-unowned:${"a".repeat(64)}`,
    message: "Legacy title storage has no typed owner.",
    recovery: {
      key: "form-field:title",
      scope: "command" as const,
      strategy: "replace-value" as const
    }
  }
  const second = {
    code: "storage_legacy_unowned" as const,
    id: `storage-legacy-unowned:${"b".repeat(64)}`,
    message: "Legacy filter storage has no typed owner.",
    recovery: {
      key: "form-field:filter",
      scope: "command" as const,
      strategy: "replace-value" as const
    }
  }
  let issueState = clearRuntimeSessionIssues()
  issueState = reduceRuntimeSessionIssues(issueState, {
    issues: [first, second],
    revision: 2,
    sessionId: "session-1",
    terminal: false
  })
  const currentState = issueState
  issueState = reduceRuntimeSessionIssues(issueState, {
    issues: [],
    revision: 1,
    sessionId: "session-1",
    terminal: false
  })
  assert.equal(issueState, currentState)
  issueState = reduceRuntimeSessionIssues(issueState, {
    issues: [second],
    revision: 3,
    sessionId: "session-1",
    terminal: false
  })
  assert.deepEqual(Array.from(issueState.issues.values()), [second])

  issueState = clearRuntimeSessionIssues()
  assert.equal(issueState.issues.size, 0)
  issueState = reduceRuntimeSessionIssues(issueState, {
    issues: [second, first],
    revision: 4,
    sessionId: "session-1",
    terminal: false
  })
  const markup = renderToStaticMarkup(
    createElement(RuntimeIssueBand, {
      issues: Array.from(issueState.issues.values()),
      onDiscardIssue: () => undefined
    })
  )
  assert.match(markup, /Stored values need attention/)
  assert.match(markup, /Legacy title storage has no typed owner/)
  assert.match(markup, /Legacy filter storage has no typed owner/)
  assert.match(markup, /data-runtime-recovery-strategy="replace-value"/)
  assert.match(markup, /Update the owning field to establish a current value/)
  assert.match(markup, /data-runtime-issue-band/)
  assert.doesNotMatch(markup, /\b(?:absolute|fixed|pointer-events-)\b/)

  for (const surface of ["runtime-detail", "runtime-form", "runtime-list"] as const) {
    const layout = renderToStaticMarkup(
      createElement(
        RuntimeIssueSurfaceLayout,
        {
          issues: Array.from(issueState.issues.values()),
          onDiscardIssue: () => undefined,
          surface
        },
        createElement("button", { type: "button" }, "Recovery control")
      )
    )
    assert.match(layout, new RegExp(`data-runtime-issue-layout="${surface}"`))
    assert.ok(layout.indexOf("data-runtime-issue-band") < layout.indexOf("Recovery control"))
    assert.match(layout, /data-runtime-issue-content/)
    assert.match(layout, /min-h-0/)
  }

  const extensionIssue: ExtensionRuntimeRecoverableIssue = {
    code: "storage_legacy_unowned",
    id: `storage-legacy-unowned:${"c".repeat(64)}`,
    message: "Legacy extension storage needs recovery.",
    recovery: {
      key: "recentPage",
      scope: "extension",
      strategy: "discard-value"
    }
  }
  const extensionMarkup = renderToStaticMarkup(
    createElement(RuntimeIssueBand, {
      issues: [extensionIssue],
      onDiscardIssue: () => undefined
    })
  )
  assert.match(extensionMarkup, /data-runtime-recovery-strategy="discard-value"/)
  assert.match(extensionMarkup, /Discard stored value/)
})

test("terminal projection wins when it races ahead of the foreground admission response", () => {
  const attempt = createRuntimeAdmissionAttempt("session-1")

  assert.equal(shouldCommitRuntimeAdmission(attempt, attempt), true)
  assert.equal(markRuntimeAdmissionTerminal(attempt, "session-1"), true)
  assert.equal(shouldCommitRuntimeAdmission(attempt, attempt), false)
  assert.equal(markRuntimeAdmissionTerminal(attempt, "different-session"), false)

  const replacement = createRuntimeAdmissionAttempt("session-2")
  assert.equal(shouldCommitRuntimeAdmission(replacement, attempt), false)
  assert.equal(shouldCommitRuntimeAdmission(replacement, replacement), true)
})

test("extension runtime JSON facts reject non-JSON identity and structure", () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  const sparse: unknown[] = []
  sparse.length = 1
  let accessorReads = 0
  const accessor = {}
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get: () => {
      accessorReads += 1
      return "hidden"
    }
  })
  const arrayAccessor = ["visible"]
  Object.defineProperty(arrayAccessor, "0", {
    enumerable: true,
    get: () => {
      accessorReads += 1
      return "hidden"
    }
  })
  const nonEnumerable = { visible: true }
  Object.defineProperty(nonEnumerable, "hidden", {
    enumerable: false,
    value: "secret"
  })
  const withSymbol = { value: "visible" } as Record<PropertyKey, unknown>
  withSymbol[Symbol("hidden")] = "secret"
  class CustomFact {
    value = "custom"
  }

  const invalidValues: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["bigint", BigInt(1)],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative Infinity", Number.NEGATIVE_INFINITY],
    ["Map", new Map([["key", "value"]])],
    ["Set", new Set(["value"])],
    ["Date", new Date(0)],
    ["custom prototype", new CustomFact()],
    ["cycle", circular],
    ["sparse array", sparse],
    ["typed array", new Uint8Array([1])],
    ["accessor", accessor],
    ["array accessor", arrayAccessor],
    ["symbol key", withSymbol],
    ["symbol value", Symbol("value")],
    ["function", () => undefined],
    ["nested undefined", { value: undefined }],
    ["non-enumerable", nonEnumerable]
  ]

  for (const [label, value] of invalidValues) {
    assert.throws(
      () => normalizeExtensionRuntimeJsonFact(value, `invalid ${label}`),
      TypeError,
      label
    )
  }
  assert.equal(accessorReads, 0)
})

test("launch intent and utility navigation reject opaque launch props before transport", async () => {
  const opaqueLaunchProps = {
    arguments: new Map([["issue", "123"]])
  } as unknown as Record<string, unknown>

  assert.throws(() =>
    normalizeExtensionRuntimeLaunchIntent({
      commandName: "open-issue",
      extensionName: "github",
      initialAction: "submit",
      launchProps: opaqueLaunchProps,
      seedQuery: ""
    })
  )
  assert.throws(() => normalizeExtensionRuntimeLaunchProps(undefined))
  assert.throws(() =>
    normalizeExtensionRuntimeLaunchIntent({
      commandName: "open-issue",
      extensionName: "github",
      initialAction: "submit",
      launchProps: undefined,
      seedQuery: ""
    })
  )

  let hostRequestCount = 0
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async () => {
      hostRequestCount += 1
      return { id: "unexpected", ok: true, result: null }
    }
  })
  await assert.rejects(
    navigation.openCommand(
      { commandName: "open-issue", extensionName: "github" },
      { launchProps: opaqueLaunchProps }
    )
  )
  await assert.rejects(
    navigation.openCommand({ commandName: "open-issue", extensionName: "github" }, {
      launchProps: undefined
    } as never)
  )
  let navigationGetterReads = 0
  const accessorOptions = {}
  Object.defineProperty(accessorOptions, "launchProps", {
    enumerable: true,
    get: () => {
      navigationGetterReads += 1
      return {}
    }
  })
  await assert.rejects(
    navigation.openCommand(
      { commandName: "open-issue", extensionName: "github" },
      accessorOptions as never
    )
  )
  assert.equal(hostRequestCount, 0)
  assert.equal(navigationGetterReads, 0)

  let launchCommandGetterReads = 0
  const launchOptions = { type: LaunchType.UserInitiated }
  Object.defineProperty(launchOptions, "arguments", {
    enumerable: true,
    get: () => {
      launchCommandGetterReads += 1
      return {}
    }
  })
  await assert.rejects(launchCommand(launchOptions))
  assert.equal(launchCommandGetterReads, 0)
})

test("public raw requestHost rejects invalid navigation facts before utility transport", async () => {
  const sentRequests: ExtensionHostRequest[] = []
  let requestIndex = 0
  const requestHost: ExtensionRuntimeSdkContextValue["requestHost"] = (request) =>
    sendExtensionRuntimeHostRequest(request, {
      createRequestId: () => `transport-${requestIndex++}`,
      send: async (transportRequest) => {
        sentRequests.push(transportRequest)
        return { id: transportRequest.id, ok: true, result: null }
      }
    })
  const launchContext = createTestLease(createLaunchIntent(), "run-once").utility.context
  const context: ExtensionRuntimeSdkContextValue = {
    ...launchContext,
    navigation: createExtensionRuntimeNavigation({ requestHost }),
    requestHost
  }
  class CustomArguments {
    issue = "123"
  }
  let accessorReads = 0
  const accessorPayload = {
    commandName: "open-issue",
    extensionName: "github"
  }
  Object.defineProperty(accessorPayload, "launchProps", {
    enumerable: true,
    get: () => {
      accessorReads += 1
      return {}
    }
  })
  const invalidPayloads = [
    { launchProps: { arguments: new CustomArguments() } },
    { launchProps: { arguments: new Map([["issue", "123"]]) } },
    { launchProps: undefined },
    accessorPayload
  ]

  for (const payload of invalidPayloads) {
    await assert.rejects(
      runWithExtensionRuntimeSdk(context, () =>
        getActiveExtensionRuntimeSdk().requestHost({
          capability: "navigation",
          method: "open-command",
          payload
        } as never)
      )
    )
  }
  assert.equal(accessorReads, 0)
  assert.equal(sentRequests.length, 0)

  const source = {
    commandName: "open-issue",
    extensionName: "github",
    launchProps: {
      arguments: { issue: "before" }
    }
  }
  await runWithExtensionRuntimeSdk(context, () =>
    getActiveExtensionRuntimeSdk().requestHost({
      capability: "navigation",
      method: "open-command",
      payload: source
    })
  )
  source.launchProps.arguments.issue = "after"

  assert.equal(sentRequests.length, 1)
  assert.equal(sentRequests[0]?.id, "transport-4")
  assert.equal(
    (sentRequests[0] as { payload?: { launchProps?: { arguments?: { issue?: string } } } }).payload
      ?.launchProps?.arguments?.issue,
    "before"
  )
  assert.equal(Object.isFrozen(sentRequests[0]), true)
})

test("extension runtime start request rejects outer shape before reading accessors", () => {
  let intentGetterReads = 0
  const accessorRequest = { sessionId: "session-1" }
  Object.defineProperty(accessorRequest, "intent", {
    enumerable: true,
    get: () => {
      intentGetterReads += 1
      return createLaunchIntent()
    }
  })

  assert.throws(() => normalizeExtensionRuntimeStartRequest(accessorRequest))
  assert.equal(intentGetterReads, 0)
  assert.throws(() =>
    normalizeExtensionRuntimeStartRequest({
      extra: true,
      intent: createLaunchIntent(),
      sessionId: "session-1"
    })
  )
  assert.throws(() =>
    normalizeExtensionRuntimeStartRequest({
      intent: createLaunchIntent(),
      sessionId: ""
    })
  )
})

test("navigation host request codec enforces its method-discriminated public shape", () => {
  assert.throws(() =>
    normalizeExtensionRuntimeNavigationHostRequest({
      capability: "navigation",
      id: "navigation-root-with-payload",
      method: "go-home",
      payload: {}
    })
  )
  assert.throws(() =>
    normalizeExtensionRuntimeNavigationHostRequest({
      capability: "navigation",
      id: "navigation-open-without-payload",
      method: "open-command"
    })
  )
})

test("navigation event normalization detaches session projections without cross-session pollution", () => {
  const source = {
    request: {
      capability: "navigation",
      id: "navigation-1",
      method: "open-command",
      payload: {
        commandName: "open-issue",
        extensionName: "github",
        launchProps: {
          arguments: { issue: "first" }
        }
      }
    },
    sessionId: "session-1"
  }
  const first = normalizeExtensionRuntimeNavigationRequestEvent(source)
  source.request.payload.launchProps.arguments.issue = "mutated"
  const second = normalizeExtensionRuntimeNavigationRequestEvent({
    ...source,
    request: {
      ...source.request,
      id: "navigation-2"
    },
    sessionId: "session-2"
  })

  assert.equal(first.request.payload?.launchProps?.arguments?.issue, "first")
  assert.equal(second.request.payload?.launchProps?.arguments?.issue, "mutated")
  assert.notEqual(first.request, second.request)
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.request), true)
  assert.equal(Object.isFrozen(first.request.payload), true)
  assert.equal(Object.isFrozen(first.request.payload?.launchProps?.arguments), true)
})

test("utility execution lease only exposes preferences to entitled runtimes", () => {
  const intent = createLaunchIntent()
  const withoutPreferences = createTestLease(intent, "foreground", ["rpc"])

  assert.deepEqual(withoutPreferences.utility.context.extensionPreferences, {})
  assert.deepEqual(withoutPreferences.utility.context.commandPreferences, {})
  assert.equal(JSON.stringify(withoutPreferences.utility).includes("secret-token"), false)
  assert.equal(withoutPreferences.invokeContext.extensionPreferences.accessToken, "secret-token")
  assert.deepEqual(withoutPreferences.utility.context.dataIdentity, {
    cache: {
      kind: "unavailable",
      reason: "artifact-revision-unavailable"
    },
    kind: "available",
    localStorage: {
      connectionId: "default",
      credentialGeneration: 0
    }
  })

  const withPreferences = createTestLease(intent, "foreground", ["preferences", "rpc"])
  assert.equal(withPreferences.utility.context.extensionPreferences.accessToken, "secret-token")
  assert.equal(withPreferences.utility.context.commandPreferences.accessToken, "secret-token")

  const installedUtility = createExtensionRuntimeUtilityExecutionLease({
    intent,
    invokeContext: withPreferences.invokeContext,
    locale: "zh-CN",
    mode: "view",
    runtime: {
      extensionName: intent.extensionName,
      kind: "module",
      modulePath: "/immutable/github/1.2.3/runtime.js",
      version: "1.2.3"
    },
    runtimeCapabilities: withPreferences.runtimeCapabilities
  })
  assert.equal(installedUtility.context.dataIdentity.kind, "available")
  if (installedUtility.context.dataIdentity.kind !== "available") {
    throw new Error("Expected installed utility data identity to be available")
  }
  assert.deepEqual(installedUtility.context.dataIdentity.cache, {
    kind: "unavailable",
    reason: "artifact-revision-unavailable"
  })
  assert.equal(JSON.stringify(installedUtility.context.dataIdentity).includes("/immutable/"), false)
})

test("foreground launch intent projection ignores renderer preference and locale facts", () => {
  const baseHost = {
    commandName: "create-issue",
    commandPreferences: { project: "first" },
    extensionName: "github",
    initialAction: "submit" as const,
    launchProps: {
      arguments: { title: "Ship it" }
    },
    locale: "en-US" as const
  }
  const updatedProjection = {
    ...baseHost,
    commandPreferences: { project: "second" },
    locale: "zh-CN" as const
  }

  assert.deepEqual(
    createRuntimeForegroundLaunchIntent(baseHost, "seed"),
    createRuntimeForegroundLaunchIntent(updatedProjection, "seed")
  )
  assert.throws(() =>
    createRuntimeForegroundLaunchIntent(
      {
        commandName: "create-issue",
        extensionName: "github",
        initialAction: "submit",
        launchProps: null as never
      },
      "seed"
    )
  )
  assert.deepEqual(
    createRuntimeForegroundLaunchIntent(
      {
        commandName: "create-issue",
        extensionName: "github",
        initialAction: "submit",
        launchProps: undefined
      },
      "seed"
    ),
    {
      commandName: "create-issue",
      extensionName: "github",
      initialAction: "submit",
      seedQuery: "seed"
    }
  )
})

test("run-once launch intent projection omits only undefined launch props", () => {
  const input = {
    commandName: "quick-add",
    extensionName: "reminders",
    initialAction: "submit" as const,
    seedQuery: "buy milk"
  }

  assert.deepEqual(
    createRuntimeRunOnceLaunchIntent(input),
    createRuntimeRunOnceLaunchIntent({ ...input, launchProps: undefined })
  )
  assert.throws(() =>
    createRuntimeRunOnceLaunchIntent({
      ...input,
      launchProps: null as never
    })
  )
})

function createMenuBarRuntimeHarness(failedStartAttempts: ReadonlySet<number>) {
  const intent: ExtensionRuntimeLaunchIntent = {
    commandName: "status",
    extensionName: "github",
    initialAction: "open",
    seedQuery: ""
  }
  const stoppedListeners = new Set<Parameters<ExtensionRuntimeManager["onSessionStopped"]>[0]>()
  let attempts = 0
  const emitConfigurationRevoked = (sessionId: string): void => {
    for (const listener of stoppedListeners) {
      listener(
        {
          intent,
          kind: "ambient",
          sessionId
        },
        "configuration-revoked"
      )
    }
  }
  const runtimeManager = {
    discardStorageIssue: async () => false,
    onError: () => () => undefined,
    onIssueSnapshot: () => () => undefined,
    onSessionStopped: (listener: Parameters<ExtensionRuntimeManager["onSessionStopped"]>[0]) => {
      stoppedListeners.add(listener)
      return () => stoppedListeners.delete(listener)
    },
    onSurface: () => () => undefined,
    sendEvent: () => false,
    startAmbient: async (
      startIntent: ExtensionRuntimeLaunchIntent,
      options?: { onSessionStart?: (session: ExtensionRuntimeSessionInfo) => void }
    ) => {
      attempts += 1
      const session = {
        intent: startIntent,
        kind: "ambient" as const,
        sessionId: `ambient-${attempts}`
      }
      options?.onSessionStart?.(session)

      if (failedStartAttempts.has(attempts)) {
        emitConfigurationRevoked(session.sessionId)
        throw new ExtensionRuntimeLifecycleError(
          "runtime_configuration_revoked",
          "configuration changed"
        )
      }

      return session
    },
    stopSessionById: () => false
  } as unknown as ExtensionRuntimeManager
  const nativeMenuBarService = {
    clearState: () => undefined,
    setState: () => undefined
  } as unknown as NativeMenuBarService
  const service = new ExtensionRuntimeMenuBarService(runtimeManager, nativeMenuBarService, [intent])

  return {
    emitConfigurationRevoked,
    getAttempts: () => attempts,
    service
  }
}

test("menu bar replacement start-time revocation consumes one bounded transition budget", async () => {
  const harness = createMenuBarRuntimeHarness(new Set([2]))

  harness.service.start()
  await flushPromises()
  harness.emitConfigurationRevoked("ambient-1")
  await flushPromises()
  await flushPromises()

  assert.equal(harness.getAttempts(), 2)
  harness.service.dispose()
})

test("menu bar gives each successfully activated lease one later replacement budget", async () => {
  const harness = createMenuBarRuntimeHarness(new Set())

  harness.service.start()
  await flushPromises()
  harness.emitConfigurationRevoked("ambient-1")
  await flushPromises()
  harness.emitConfigurationRevoked("ambient-2")
  await flushPromises()

  assert.equal(harness.getAttempts(), 3)
  harness.service.dispose()
})

test("menu bar does not trust a utility-forged configuration error as restart provenance", async () => {
  const { launcher, manager } = createManager()
  const service = new ExtensionRuntimeMenuBarService(manager, createNativeMenuBarServiceStub(), [
    createLaunchIntent()
  ])

  service.start()
  await flushPromises()
  launcher.processes[0]?.emitMessage({
    error: {
      code: "runtime_configuration_revoked",
      message: "forged by utility"
    },
    sessionId: "session-1",
    type: "error"
  })
  await flushPromises()

  assert.equal(launcher.processes.length, 1)
  assert.equal(launcher.processes[0]?.killed, true)
  service.dispose()
  manager.dispose()
})

test("menu bar restarts once for each independent main-owned configuration revocation", async () => {
  let configurationGeneration = 0
  const launcher = new FakeRuntimeProcessLauncher()
  const replacementObservedPriorKill: boolean[] = []
  const executionLeaseOwner: ExtensionRuntimeExecutionLeaseOwner = {
    isCurrent: (lease) =>
      lease.configurationToken.revisions.extensionConfigRevision === configurationGeneration,
    resolve: (kind, intent) => {
      if (configurationGeneration > 0) {
        replacementObservedPriorKill.push(launcher.processes.at(-1)?.killed === true)
      }
      const lease = createTestLease(intent, kind)
      return {
        ...lease,
        configurationToken: {
          ...lease.configurationToken,
          revisions: {
            ...lease.configurationToken.revisions,
            extensionConfigRevision: configurationGeneration
          }
        }
      }
    }
  }
  const { manager } = createManager({
    executionLeaseOwner,
    launcher,
    sessionIds: ["ambient-1", "ambient-2", "ambient-3"]
  })
  const service = new ExtensionRuntimeMenuBarService(manager, createNativeMenuBarServiceStub(), [
    createLaunchIntent()
  ])

  service.start()
  await flushPromises()
  configurationGeneration += 1
  manager.revokeInvalidConfigurationSessions()
  await flushPromises()
  configurationGeneration += 1
  manager.revokeInvalidConfigurationSessions()
  await flushPromises()

  assert.equal(launcher.processes.length, 3)
  assert.equal(launcher.processes[0]?.killed, true)
  assert.equal(launcher.processes[1]?.killed, true)
  assert.equal(launcher.processes[2]?.killed, false)
  assert.deepEqual(replacementObservedPriorKill, [true, true])
  service.dispose()
  manager.dispose()
})

test("menu bar bounds a second main-owned revocation during replacement startup", async () => {
  let configurationGeneration = 0
  let replacementLeaseChecks = 0
  let invalidateReplacementDuringStart = false
  const executionLeaseOwner: ExtensionRuntimeExecutionLeaseOwner = {
    isCurrent: (lease) => {
      if (lease.configurationToken.revisions.extensionConfigRevision !== configurationGeneration) {
        return false
      }
      if (invalidateReplacementDuringStart && configurationGeneration === 1) {
        replacementLeaseChecks += 1
        if (replacementLeaseChecks === 2) {
          configurationGeneration = 2
          return false
        }
      }
      return true
    },
    resolve: (kind, intent) => {
      const lease = createTestLease(intent, kind)
      return {
        ...lease,
        configurationToken: {
          ...lease.configurationToken,
          revisions: {
            ...lease.configurationToken.revisions,
            extensionConfigRevision: configurationGeneration
          }
        }
      }
    }
  }
  const { launcher, manager } = createManager({
    executionLeaseOwner,
    sessionIds: ["ambient-1", "ambient-2", "ambient-3"]
  })
  const service = new ExtensionRuntimeMenuBarService(manager, createNativeMenuBarServiceStub(), [
    createLaunchIntent()
  ])

  service.start()
  await flushPromises()
  configurationGeneration = 1
  invalidateReplacementDuringStart = true
  manager.revokeInvalidConfigurationSessions()
  await flushPromises()
  await flushPromises()

  assert.equal(launcher.processes.length, 2)
  assert.equal(launcher.processes[0]?.killed, true)
  assert.equal(launcher.processes[1]?.killed, true)
  service.dispose()
  manager.dispose()
})

test("menu bar removes an exhausted replacement when a second commit lands before activation", async () => {
  let configurationGeneration = 0
  const executionLeaseOwner: ExtensionRuntimeExecutionLeaseOwner = {
    isCurrent: (lease) =>
      lease.configurationToken.revisions.extensionConfigRevision === configurationGeneration,
    resolve: (kind, intent) => {
      const lease = createTestLease(intent, kind)
      return {
        ...lease,
        configurationToken: {
          ...lease.configurationToken,
          revisions: {
            ...lease.configurationToken.revisions,
            extensionConfigRevision: configurationGeneration
          }
        }
      }
    }
  }
  const { launcher, manager } = createManager({
    executionLeaseOwner,
    sessionIds: ["ambient-1", "ambient-2", "ambient-3"]
  })
  const service = new ExtensionRuntimeMenuBarService(manager, createNativeMenuBarServiceStub(), [
    createLaunchIntent()
  ])

  service.start()
  await flushPromises()
  configurationGeneration = 1
  manager.revokeInvalidConfigurationSessions()
  assert.equal(launcher.processes.length, 2)
  configurationGeneration = 2
  manager.revokeInvalidConfigurationSessions()
  await flushPromises()

  const commandStates = (service as unknown as { commandStatesByKey: Map<string, unknown> })
    .commandStatesByKey
  assert.equal(launcher.processes.length, 2)
  assert.equal(commandStates.size, 0)
  service.dispose()
  manager.dispose()
})

function createNativeMenuBarServiceStub(): NativeMenuBarService {
  return {
    clearState: () => undefined,
    setState: () => undefined
  } as unknown as NativeMenuBarService
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

  const session = await manager.startForeground(createLaunchIntent())

  assert.equal(session.sessionId, "session-1")
  assert.deepEqual(session, {
    intent: createLaunchIntent(),
    kind: "foreground",
    sessionId: "session-1"
  })
  assert.deepEqual(launcher.processes[0]?.messages[0], {
    lease: createTestLease(createLaunchIntent(), "foreground").utility,
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

test("runtime manager owns a normal terminal transition before issue projection reentrancy", async () => {
  const reentrantStops: boolean[] = []
  const stoppedSessions: string[] = []
  const managerRef: { current: ExtensionRuntimeManager | null } = { current: null }
  const harness = createManager({
    onIssue: (snapshot) => {
      if (snapshot.terminal) {
        assert.ok(managerRef.current)
        reentrantStops.push(managerRef.current.stopSessionById(snapshot.sessionId))
      }
    }
  })
  managerRef.current = harness.manager
  harness.manager.onSessionStopped((session) => stoppedSessions.push(session.sessionId))

  await harness.manager.startForeground(createLaunchIntent())
  const process = harness.launcher.processes[0]
  assert.ok(process)

  assert.equal(harness.manager.stopSessionById("session-1"), true)

  assert.deepEqual(reentrantStops, [false])
  assert.equal(process.messages.filter((message) => message.type === "stop").length, 1)
  assert.equal(process.killCalls, 1)
  assert.deepEqual(stoppedSessions, ["session-1"])
  assert.equal(harness.manager.getLastError(), null)
})

test("runtime manager owns a fatal terminal transition before issue projection reentrancy", async () => {
  const errors: ExtensionRuntimeSessionError[] = []
  const reentrantStops: boolean[] = []
  const stoppedSessions: string[] = []
  const managerRef: { current: ExtensionRuntimeManager | null } = { current: null }
  const harness = createManager({
    onError: (error) => errors.push(error),
    onIssue: (snapshot) => {
      if (snapshot.terminal) {
        assert.ok(managerRef.current)
        reentrantStops.push(
          managerRef.current.stopSessionById(snapshot.sessionId, {
            code: "reentrant_stop",
            message: "A duplicate stop must be rejected."
          })
        )
      }
    }
  })
  managerRef.current = harness.manager
  harness.manager.onSessionStopped((session) => stoppedSessions.push(session.sessionId))

  await harness.manager.startForeground(createLaunchIntent())
  const process = harness.launcher.processes[0]
  assert.ok(process)
  process.emitMessage({
    error: { code: "runtime_failed", message: "Fatal runtime failure." },
    sessionId: "session-1",
    type: "error"
  })

  assert.deepEqual(reentrantStops, [false])
  assert.equal(process.messages.filter((message) => message.type === "stop").length, 1)
  assert.equal(process.killCalls, 1)
  assert.deepEqual(stoppedSessions, ["session-1"])
  assert.deepEqual(errors, [
    {
      error: { code: "runtime_failed", message: "Fatal runtime failure." },
      issueRevision: 1,
      sessionId: "session-1"
    }
  ])
})

test("runtime manager drops messages from a stopped foreground session", async () => {
  const surfaces: ExtensionSurfaceSnapshot[] = []
  const { launcher, manager } = createManager({
    onSurface: (surface) => {
      surfaces.push(surface)
    }
  })

  await manager.startForeground(createLaunchIntent())
  await manager.startForeground(createLaunchIntent())

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

  await manager.startForeground(createLaunchIntent())
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

  await manager.startForeground(createLaunchIntent())
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

  await manager.startForeground(createLaunchIntent())
  await manager.startForeground(createLaunchIntent())
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
  const deferredAi = createDeferred<string>()
  const host = createHost({
    askAI: () => deferredAi.promise
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchIntent())
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
  manager.stopForeground("session-1")
  deferredAi.resolve("done")
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

  await manager.startForeground(createLaunchIntent())
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

test("runtime manager rejects invalid navigation launch facts before renderer projection", async () => {
  let navigationRequestCount = 0
  const host = createHost({
    handleNavigationRequest: () => {
      navigationRequestCount += 1
    }
  })
  const { launcher, manager } = createManager({ host })
  await manager.startForeground(createLaunchIntent())

  const request = {
    capability: "navigation",
    id: "navigation-invalid",
    method: "open-command",
    payload: {
      commandName: "my-pull-requests",
      extensionName: "github",
      launchProps: {
        arguments: new Map([["issue", "123"]])
      }
    }
  } as unknown as ExtensionHostRequest
  launcher.processes[0]?.emitMessage({
    request,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  const response = launcher.processes[0]?.messages.find(
    (message) => message.type === "host-response"
  )
  assert.equal(navigationRequestCount, 0)
  assert.equal(response?.type, "host-response")
  assert.equal(response?.response.ok, false)
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

  await manager.startForeground(createLaunchIntent())
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

  await manager.startForeground(createLaunchIntent())
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

  await manager.startForeground(createLaunchIntent())
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

  await manager.startForeground(createLaunchIntent())
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

  await manager.startForeground(createLaunchIntent())
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

  await manager.startForeground(createLaunchIntent())
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

  await manager.startForeground(createLaunchIntent())
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
  const intent = createLaunchIntent()
  const context = createTestLease(intent, "foreground").utility.context

  await manager.startForeground(intent)
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

test("runtime manager preserves typed host storage errors on the wire", async () => {
  const host = createHost({
    getStorageValue: () => {
      throw new ExtensionRuntimeHostError(
        "storage_legacy_unowned",
        "Legacy LocalStorage key has no typed owner.",
        {
          keys: ["recentPage"],
          kind: "storage-legacy-unowned",
          scope: "extension"
        }
      )
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchIntent())
  launcher.processes[0]?.emitMessage({
    request: {
      capability: "storage",
      id: "storage-get",
      method: "get",
      payload: {
        key: "recentPage",
        scope: "extension"
      }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  assert.deepEqual(
    launcher.processes[0]?.messages.find((message) => message.type === "host-response"),
    {
      response: {
        error: {
          code: "storage_legacy_unowned",
          details: {
            keys: ["recentPage"],
            kind: "storage-legacy-unowned",
            scope: "extension"
          },
          message: "Legacy LocalStorage key has no typed owner."
        },
        id: "storage-get",
        ok: false
      },
      sessionId: "session-1",
      type: "host-response"
    }
  )
})

test("runtime manager fails closed on malformed recoverable host errors", async () => {
  const issues: ExtensionRuntimeSessionIssue[] = []
  const host = createHost({
    getStorageValue: () => {
      throw new ExtensionRuntimeHostError(
        "storage_legacy_unowned",
        "Legacy storage conflict without structured recovery details."
      )
    }
  })
  const { launcher, manager } = createManager({
    host,
    onIssue: (issue) => issues.push(issue)
  })

  await manager.startForeground(createLaunchIntent())
  launcher.processes[0]?.emitMessage({
    request: {
      capability: "storage",
      id: "storage-get-malformed",
      method: "get",
      payload: { key: "recentPage", scope: "extension" }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  const response = launcher.processes[0]?.messages.find(
    (message) => message.type === "host-response"
  )
  assert.equal(response?.type, "host-response")
  assert.deepEqual(response?.type === "host-response" ? response.response : null, {
    error: {
      code: "host_request_failed",
      message: "Extension storage request failed."
    },
    id: "storage-get-malformed",
    ok: false
  })
  assert.deepEqual(issues, [])
})

test("runtime manager bounds and redacts unexpected storage host errors on the public wire", async () => {
  const rawMessage = `/Users/alice/private-extension-data/${"x".repeat(2048)}`
  const host = createHost({
    getStorageValue: () => {
      throw new Error(rawMessage)
    }
  })
  const { launcher, manager } = createManager({ host })
  await manager.startForeground(createLaunchIntent())
  const process = launcher.processes[0]
  assert.ok(process)

  process.emitMessage({
    request: {
      capability: "storage",
      id: "storage-read-io-failure",
      method: "get",
      payload: { key: "recentPage", scope: "extension" }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  const response = process.messages.find((message) => message.type === "host-response")
  assert.deepEqual(response?.type === "host-response" ? response.response : null, {
    error: {
      code: "host_request_failed",
      message: "Extension storage request failed."
    },
    id: "storage-read-io-failure",
    ok: false
  })
  assert.equal(JSON.stringify(response).includes("/Users/alice"), false)
  assert.ok(JSON.stringify(response).length < 512)
})

test("runtime manager rejects storage recovery details that do not match their request", async () => {
  for (const mismatch of [
    { keys: ["requested"], scope: "extension" as const },
    { keys: ["different"], scope: "command" as const }
  ]) {
    const issues: ExtensionRuntimeSessionIssue[] = []
    const host = createHost({
      getStorageValue: () => {
        throw new ExtensionRuntimeHostError(
          "storage_legacy_unowned",
          "Mismatched legacy storage recovery details.",
          {
            keys: mismatch.keys,
            kind: "storage-legacy-unowned",
            scope: mismatch.scope
          }
        )
      }
    })
    const { launcher, manager } = createManager({
      host,
      onIssue: (issue) => issues.push(issue)
    })
    await manager.startForeground(createLaunchIntent())
    const process = launcher.processes[0]
    assert.ok(process)

    process.emitMessage({
      request: {
        capability: "storage",
        id: `storage-mismatch-${mismatch.scope}`,
        method: "get",
        payload: { key: "requested", scope: "command" }
      },
      sessionId: "session-1",
      type: "host-request"
    })
    await flushPromises()

    const response = process.messages.find((message) => message.type === "host-response")
    assert.deepEqual(response?.type === "host-response" ? response.response : null, {
      error: {
        code: "runtime_response_invalid",
        message: "The storage host returned recovery details that do not match the request."
      },
      id: `storage-mismatch-${mismatch.scope}`,
      ok: false
    })
    assert.deepEqual(issues, [])
  }
})

test("runtime manager rejects legacy conflicts from storage recovery methods", async () => {
  const snapshots: ExtensionRuntimeSessionIssueSnapshot[] = []
  const throwRecoveryConflict = () => {
    throw new ExtensionRuntimeHostError(
      "storage_legacy_unowned",
      "A recovery method returned a legacy conflict.",
      {
        keys: ["requested"],
        kind: "storage-legacy-unowned",
        scope: "command"
      }
    )
  }
  const host = createHost({
    clearStorageValues: throwRecoveryConflict,
    removeStorageValue: throwRecoveryConflict,
    setStorageValue: throwRecoveryConflict
  })
  const { launcher, manager } = createManager({
    host,
    onIssue: (snapshot) => snapshots.push(snapshot)
  })
  await manager.startForeground(createLaunchIntent())
  const process = launcher.processes[0]
  assert.ok(process)
  const requests: ExtensionHostRequest[] = [
    {
      capability: "storage",
      id: "storage-set-conflict",
      method: "set",
      payload: { key: "requested", scope: "command", value: "current" }
    },
    {
      capability: "storage",
      id: "storage-remove-conflict",
      method: "remove",
      payload: { key: "requested", scope: "command" }
    },
    {
      capability: "storage",
      id: "storage-clear-conflict",
      method: "clear",
      payload: { scope: "command" }
    }
  ]
  for (const request of requests) {
    process.emitMessage({ request, sessionId: "session-1", type: "host-request" })
    await flushPromises()
  }

  const responses = process.messages.filter((message) => message.type === "host-response")
  assert.deepEqual(
    responses.map((message) => (message.type === "host-response" ? message.response : null)),
    requests.map((request) => ({
      error: {
        code: "runtime_response_invalid",
        message: "The storage host returned recovery details that do not match the request."
      },
      id: request.id,
      ok: false
    }))
  )
  assert.deepEqual(snapshots, [])
})

test("runtime manager observes recoverable storage issues and keeps command recovery active", async () => {
  const currentValues = new Map<string, unknown>()
  const quarantinedKeys = new Set(["form-field:title", "form-field:filter"])
  const issues: ExtensionRuntimeSessionIssue[] = []
  const hostIssueMessage = `Legacy command storage key has no typed owner. ${"x".repeat(600)}`
  const host = createHost({
    getStorageValue: ({ key }) => {
      if (currentValues.has(key)) {
        return currentValues.get(key)
      }
      if (quarantinedKeys.has(key)) {
        throw new ExtensionRuntimeHostError("storage_legacy_unowned", hostIssueMessage, {
          keys: [key],
          kind: "storage-legacy-unowned",
          scope: "command"
        })
      }
      return undefined
    },
    setStorageValue: ({ key, value }) => {
      currentValues.set(key, value)
    }
  })
  const { launcher, manager } = createManager({
    host,
    onIssue: (issue) => issues.push(issue)
  })

  await manager.startForeground(createLaunchIntent())
  const process = launcher.processes[0]
  assert.ok(process)
  process.emitMessage({
    request: {
      capability: "storage",
      id: "storage-conflict",
      method: "get",
      payload: {
        key: "form-field:title",
        scope: "command"
      }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()
  assert.equal(
    process.messages.find(
      (message) => message.type === "host-response" && message.response.id === "storage-conflict"
    )?.type,
    "host-response"
  )

  assert.equal(issues.length, 1)
  const activeSnapshot = issues[0]
  const activeIssue = activeSnapshot?.issues[0]
  assert.equal(activeSnapshot?.sessionId, "session-1")
  assert.equal(activeSnapshot?.revision, 1)
  assert.equal(activeIssue?.code, "storage_legacy_unowned")
  assert.match(activeIssue?.id ?? "", /^storage-legacy-unowned:[a-f0-9]{64}$/)
  assert.match(activeIssue?.message ?? "", /form-field:title/)
  assert.deepEqual(activeIssue?.recovery, {
    key: "form-field:title",
    scope: "command",
    strategy: "replace-value"
  })
  assert.equal(manager.getForegroundSession()?.sessionId, "session-1")
  assert.equal(manager.getLastError(), null)
  assert.equal(process.killed, false)

  process.emitMessage({
    request: {
      capability: "storage",
      id: "storage-conflict-repeat",
      method: "get",
      payload: {
        key: "form-field:title",
        scope: "command"
      }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()
  assert.equal(issues.length, 1)
  assert.deepEqual(manager.getIssueSnapshots(), [activeSnapshot])

  process.emitMessage({
    request: {
      capability: "storage",
      id: "storage-filter-conflict",
      method: "get",
      payload: {
        key: "form-field:filter",
        scope: "command"
      }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()
  assert.equal(issues.length, 2)
  assert.deepEqual(
    issues[1]?.issues.map((issue) => issue.recovery.key),
    ["form-field:title", "form-field:filter"]
  )

  process.emitMessage({
    request: {
      capability: "storage",
      id: "storage-recover",
      method: "set",
      payload: {
        key: "form-field:title",
        scope: "command",
        value: "Current title"
      }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()
  assert.equal(currentValues.get("form-field:title"), "Current title")
  assert.equal(quarantinedKeys.has("form-field:title"), true)
  assert.equal(process.killed, false)

  assert.equal(issues.length, 3)
  assert.deepEqual(
    issues[2]?.issues.map((issue) => issue.recovery.key),
    ["form-field:filter"]
  )

  currentValues.delete("form-field:title")
  process.emitMessage({
    request: {
      capability: "storage",
      id: "storage-conflict-after-recovery",
      method: "get",
      payload: {
        key: "form-field:title",
        scope: "command"
      }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()
  assert.equal(issues.length, 4)
  assert.deepEqual(
    issues[3]?.issues.map((issue) => issue.recovery.key),
    ["form-field:filter", "form-field:title"]
  )
})

test("runtime manager resolves a legacy-key issue only after its exact discard", async () => {
  const currentValues = new Map<string, unknown>()
  let legacyConflict = true
  const issues: ExtensionRuntimeSessionIssue[] = []
  const host = createHost({
    getStorageValue: ({ key }) => {
      if (currentValues.has(key)) {
        return currentValues.get(key)
      }
      if (key === "legacy-value" && legacyConflict) {
        throw new ExtensionRuntimeHostError(
          "storage_legacy_unowned",
          "Legacy command storage key has no typed owner.",
          {
            keys: [key],
            kind: "storage-legacy-unowned",
            scope: "command"
          }
        )
      }
      return undefined
    },
    removeStorageValue: ({ key }) => {
      if (key === "legacy-value") {
        legacyConflict = false
      }
    },
    setStorageValue: ({ key, value }) => {
      currentValues.set(key, value)
    }
  })
  const { launcher, manager } = createManager({
    host,
    onIssue: (issue) => issues.push(issue)
  })
  await manager.startForeground(createLaunchIntent())
  const process = launcher.processes[0]
  assert.ok(process)
  const emitStorageRequest = (
    id: string,
    method: "get" | "remove" | "set",
    key: string,
    value?: unknown
  ): void => {
    const request: ExtensionHostRequest =
      method === "set"
        ? {
            capability: "storage",
            id,
            method,
            payload: { key, scope: "command", value }
          }
        : method === "get"
          ? {
              capability: "storage",
              id,
              method,
              payload: { key, scope: "command" }
            }
          : {
              capability: "storage",
              id,
              method,
              payload: { key, scope: "command" }
            }
    process.emitMessage({
      request,
      sessionId: "session-1",
      type: "host-request"
    })
  }

  emitStorageRequest("legacy-get", "get", "legacy-value")
  await flushPromises()
  const activeIssue = issues[0]?.issues[0]
  assert.equal(activeIssue?.recovery.key, "legacy-value")

  emitStorageRequest("primary-set", "set", "primary-value", "current")
  await flushPromises()
  assert.equal(issues.length, 1)

  emitStorageRequest("legacy-remove", "remove", "legacy-value")
  await flushPromises()
  assert.deepEqual(issues[1], {
    issues: [],
    revision: 2,
    sessionId: "session-1",
    terminal: false
  })

  emitStorageRequest("primary-reload", "get", "primary-value")
  await flushPromises()
  assert.equal(currentValues.get("primary-value"), "current")
  assert.equal(issues.length, 2)
  assert.equal(legacyConflict, false)
})

test("runtime manager discards only an active session-owned extension storage issue", async () => {
  const removed: Array<{ key: string; scope: string }> = []
  const issues: ExtensionRuntimeSessionIssue[] = []
  const host = createHost({
    getStorageValue: () => {
      throw new ExtensionRuntimeHostError(
        "storage_legacy_unowned",
        "Legacy extension storage key has no typed owner.",
        {
          keys: ["recentPage"],
          kind: "storage-legacy-unowned",
          scope: "extension"
        }
      )
    },
    removeStorageValue: ({ key, scope }) => {
      removed.push({ key, scope })
    }
  })
  const { launcher, manager } = createManager({
    host,
    onIssue: (issue) => issues.push(issue)
  })
  await manager.startForeground(createLaunchIntent())
  const process = launcher.processes[0]
  assert.ok(process)

  process.emitMessage({
    request: {
      capability: "storage",
      id: "extension-storage-conflict",
      method: "get",
      payload: { key: "recentPage", scope: "extension" }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()
  const activeIssue = issues[0]?.issues[0]
  assert.equal(activeIssue?.recovery.strategy, "discard-value")
  const issueId = activeIssue?.id ?? ""

  assert.equal(await manager.discardStorageIssue("other-session", issueId), false)
  assert.equal(
    await manager.discardStorageIssue("session-1", `storage-legacy-unowned:${"0".repeat(64)}`),
    false
  )
  assert.deepEqual(removed, [])

  assert.equal(await manager.discardStorageIssue("session-1", issueId), true)
  assert.deepEqual(removed, [{ key: "recentPage", scope: "extension" }])
  assert.deepEqual(issues[1], {
    issues: [],
    revision: 2,
    sessionId: "session-1",
    terminal: false
  })
  assert.equal(process.killed, false)
  assert.equal(await manager.discardStorageIssue("session-1", issueId), false)
})

test("runtime manager fails closed when run-once storage recovery has no surface", async () => {
  const issues: ExtensionRuntimeSessionIssue[] = []
  const host = createHost({
    getStorageValue: () => {
      throw new ExtensionRuntimeHostError(
        "storage_legacy_unowned",
        "Legacy command storage key has no typed owner.",
        {
          keys: ["form-field:title"],
          kind: "storage-legacy-unowned",
          scope: "command"
        }
      )
    }
  })
  const { launcher, manager } = createManager({
    host,
    onIssue: (issue) => issues.push(issue)
  })
  const resultPromise = manager.runOnce(createLaunchIntent())
  await flushPromises()
  const process = launcher.processes[0]
  assert.ok(process)

  process.emitMessage({
    request: {
      capability: "storage",
      id: "run-once-storage-conflict",
      method: "get",
      payload: {
        key: "form-field:title",
        scope: "command"
      }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()
  assert.equal(process.killed, true)
  assert.deepEqual(await resultPromise, {
    error: {
      code: "runtime_storage_recovery_unavailable",
      message: "Stored values need user recovery, but this runtime mode has no recovery surface."
    },
    sessionId: "session-1",
    status: "error"
  })
  assert.deepEqual(issues, [{ issues: [], revision: 1, sessionId: "session-1", terminal: true }])
})

test("Figma menu bar exposes ambient LocalStorage recovery as an exact discard action", async () => {
  const states: NativeMenuBarState[] = []
  const cleared: string[] = []
  const actionHandlers: Array<Record<string, () => void> | undefined> = []
  let hasConflict = true
  const host = createHost({
    getStorageValue: () => {
      if (!hasConflict) {
        return undefined
      }
      throw new ExtensionRuntimeHostError(
        "storage_legacy_unowned",
        "Legacy ambient storage key has no typed owner.",
        {
          keys: ["recentPage"],
          kind: "storage-legacy-unowned",
          scope: "extension"
        }
      )
    },
    removeStorageValue: () => {
      hasConflict = false
    }
  })
  const { launcher, manager } = createManager({ host, sessionIds: ["ambient-1"] })
  const intent: ExtensionRuntimeLaunchIntent = {
    commandName: "menu-bar",
    extensionName: "figma-files",
    initialAction: "open",
    seedQuery: ""
  }
  const nativeMenuBarService = {
    clearState: (commandKey: string) => cleared.push(commandKey),
    setState: (state: NativeMenuBarState, handlers?: Record<string, () => void>) => {
      states.push(state)
      actionHandlers.push(handlers)
    }
  } as unknown as NativeMenuBarService
  const service = new ExtensionRuntimeMenuBarService(manager, nativeMenuBarService, [intent])
  service.start()
  await flushPromises()
  const process = launcher.processes[0]
  assert.ok(process)

  process.emitMessage({
    sessionId: "ambient-1",
    surface: {
      commandName: "menu-bar",
      extensionName: "figma-files",
      isLoading: false,
      kind: "menu-bar",
      revision: 1,
      sections: [
        {
          id: "status",
          items: [{ disabled: false, id: "open", title: "Open" }]
        }
      ],
      title: "Figma"
    },
    type: "surface"
  })

  process.emitMessage({
    request: {
      capability: "storage",
      id: "ambient-storage-conflict",
      method: "get",
      payload: { key: "recentPage", scope: "extension" }
    },
    sessionId: "ambient-1",
    type: "host-request"
  })
  await flushPromises()

  assert.equal(process.killed, false)
  assert.deepEqual(states.at(-1), {
    commandKey: JSON.stringify(["figma-files", "menu-bar"]),
    iconName: "bell",
    sections: [
      {
        items: [
          {
            id: states.at(-1)?.sections[0]?.items[0]?.id,
            subtitle: "recentPage",
            title: "Discard stored value"
          }
        ]
      }
    ],
    title: "menu-bar",
    tooltip: "Stored values need attention"
  })
  const discardId = states.at(-1)?.sections[0]?.items[0]?.id
  assert.ok(discardId)
  actionHandlers.at(-1)?.[discardId]?.()
  await flushPromises()

  assert.equal(hasConflict, false)
  assert.deepEqual(states.at(-1), {
    commandKey: JSON.stringify(["figma-files", "menu-bar"]),
    extensionIcon: undefined,
    iconName: undefined,
    isLoading: false,
    sections: [
      {
        items: [{ disabled: false, extensionIcon: undefined, id: "open", title: "Open" }],
        title: undefined
      }
    ],
    title: "Figma",
    tooltip: undefined
  })
  assert.deepEqual(cleared, [])
  service.dispose()
  manager.dispose()
})

test("ambient command storage recovery exposes only the manager-approved discard action", async () => {
  const handlers: Array<Record<string, () => void> | undefined> = []
  const states: NativeMenuBarState[] = []
  const cleared: string[] = []
  const removed: Array<{ key: string; scope: string }> = []
  const host = createHost({
    getStorageValue: () => {
      throw new ExtensionRuntimeHostError(
        "storage_legacy_unowned",
        "Legacy ambient command key has no typed owner.",
        {
          keys: ["selected-file"],
          kind: "storage-legacy-unowned",
          scope: "command"
        }
      )
    },
    removeStorageValue: ({ key, scope }) => {
      removed.push({ key, scope })
    }
  })
  const { launcher, manager } = createManager({ host, sessionIds: ["ambient-command"] })
  const intent: ExtensionRuntimeLaunchIntent = {
    commandName: "menu-bar",
    extensionName: "figma-files",
    initialAction: "open",
    seedQuery: ""
  }
  const service = new ExtensionRuntimeMenuBarService(
    manager,
    {
      clearState: (commandKey: string) => cleared.push(commandKey),
      setState: (state: NativeMenuBarState, actionHandlers?: Record<string, () => void>) => {
        states.push(state)
        handlers.push(actionHandlers)
      }
    } as unknown as NativeMenuBarService,
    [intent]
  )
  service.start()
  await flushPromises()
  const process = launcher.processes[0]
  assert.ok(process)

  process.emitMessage({
    request: {
      capability: "storage",
      id: "ambient-command-conflict",
      method: "get",
      payload: { key: "selected-file", scope: "command" }
    },
    sessionId: "ambient-command",
    type: "host-request"
  })
  await flushPromises()

  const discardId = states.at(-1)?.sections[0]?.items[0]?.id
  assert.ok(discardId)
  assert.equal(states.at(-1)?.sections[0]?.items[0]?.title, "Discard stored value")
  assert.equal(process.killed, false)
  handlers.at(-1)?.[discardId]?.()
  await flushPromises()

  assert.deepEqual(removed, [{ key: "selected-file", scope: "command" }])
  assert.deepEqual(cleared, [JSON.stringify(["figma-files", "menu-bar"])])
  assert.equal(process.killed, false)
  service.dispose()
  manager.dispose()
})

test("ambient discard failure is terminal, bounded, and remains visible in the menu bar", async () => {
  const states: NativeMenuBarState[] = []
  const handlers: Array<Record<string, () => void> | undefined> = []
  const rawMessage = `/Users/alice/private-extension-data/${"y".repeat(2048)}`
  const host = createHost({
    getStorageValue: () => {
      throw new ExtensionRuntimeHostError(
        "storage_legacy_unowned",
        "Legacy ambient storage key has no typed owner.",
        {
          keys: ["recentPage"],
          kind: "storage-legacy-unowned",
          scope: "extension"
        }
      )
    },
    removeStorageValue: () => {
      throw new Error(rawMessage)
    }
  })
  const { launcher, manager } = createManager({ host, sessionIds: ["ambient-failure"] })
  const service = new ExtensionRuntimeMenuBarService(
    manager,
    {
      clearState: () => undefined,
      setState: (state: NativeMenuBarState, actionHandlers?: Record<string, () => void>) => {
        states.push(state)
        handlers.push(actionHandlers)
      }
    } as unknown as NativeMenuBarService,
    [
      {
        commandName: "menu-bar",
        extensionName: "figma-files",
        initialAction: "open",
        seedQuery: ""
      }
    ]
  )
  service.start()
  await flushPromises()
  const process = launcher.processes[0]
  assert.ok(process)
  process.emitMessage({
    request: {
      capability: "storage",
      id: "ambient-discard-failure",
      method: "get",
      payload: { key: "recentPage", scope: "extension" }
    },
    sessionId: "ambient-failure",
    type: "host-request"
  })
  await flushPromises()

  const issueId = states.at(-1)?.sections[0]?.items[0]?.id
  assert.ok(issueId)
  handlers.at(-1)?.[issueId]?.()
  await flushPromises()

  assert.equal(process.killed, true)
  assert.deepEqual(manager.getLastError(), {
    error: {
      code: "storage_issue_discard_failed",
      message: "The stored value could not be discarded."
    },
    issueRevision: 2,
    sessionId: "ambient-failure"
  })
  assert.equal(states.at(-1)?.sections[0]?.items[0]?.title, "Storage recovery unavailable")
  assert.equal(
    states.at(-1)?.sections[0]?.items[0]?.subtitle,
    "The stored value could not be discarded."
  )
  assert.equal(JSON.stringify(states.at(-1)).includes("/Users/alice"), false)
  service.dispose()
  manager.dispose()
})

test("ambient runtime crash remains visible as a bounded unavailable menu state", async () => {
  const states: NativeMenuBarState[] = []
  const { launcher, manager } = createManager({ sessionIds: ["ambient-crash"] })
  const service = new ExtensionRuntimeMenuBarService(
    manager,
    {
      clearState: () => undefined,
      setState: (state: NativeMenuBarState) => states.push(state)
    } as unknown as NativeMenuBarService,
    [
      {
        commandName: "menu-bar",
        extensionName: "figma-files",
        initialAction: "open",
        seedQuery: ""
      }
    ]
  )
  service.start()
  await flushPromises()
  launcher.processes[0]?.emitExit(47)

  assert.deepEqual(states.at(-1), {
    commandKey: JSON.stringify(["figma-files", "menu-bar"]),
    iconName: "bell",
    sections: [
      {
        items: [
          {
            disabled: true,
            id: "runtime-unavailable",
            subtitle:
              "The extension menu bar stopped unexpectedly. Reload the extension to continue.",
            title: "Extension unavailable"
          }
        ]
      }
    ],
    title: "menu-bar",
    tooltip: "The extension menu bar stopped unexpectedly. Reload the extension to continue."
  })
  service.dispose()
  manager.dispose()
})

test("runtime manager splits scope conflicts into exact per-key recovery issues", async () => {
  let hasAggregateConflict = true
  const issues: ExtensionRuntimeSessionIssue[] = []
  const host = createHost({
    listStorageValues: () => {
      if (hasAggregateConflict) {
        throw new ExtensionRuntimeHostError(
          "storage_legacy_unowned",
          "Legacy command storage keys have no typed owner.",
          {
            keys: ["title", "filter"],
            kind: "storage-legacy-unowned",
            scope: "command"
          }
        )
      }
      return { title: "Current title" }
    }
  })
  const { launcher, manager } = createManager({
    host,
    onIssue: (issue) => issues.push(issue)
  })
  await manager.startForeground(createLaunchIntent())
  const process = launcher.processes[0]
  assert.ok(process)

  const requestAllItems = (id: string): void => {
    process.emitMessage({
      request: {
        capability: "storage",
        id,
        method: "all-items",
        payload: { scope: "command" }
      },
      sessionId: "session-1",
      type: "host-request"
    })
  }
  requestAllItems("storage-all-conflict")
  await flushPromises()
  assert.equal(issues.length, 1)
  assert.deepEqual(
    issues[0]?.issues.map((issue) => issue.recovery.key),
    ["title", "filter"]
  )

  process.emitMessage({
    request: {
      capability: "storage",
      id: "storage-title-set",
      method: "set",
      payload: {
        key: "title",
        scope: "command",
        value: "Current title"
      }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()
  assert.deepEqual(
    issues[1]?.issues.map((issue) => issue.recovery.key),
    ["filter"]
  )

  process.emitMessage({
    request: {
      capability: "storage",
      id: "storage-filter-set",
      method: "set",
      payload: {
        key: "filter",
        scope: "command",
        value: "Current filter"
      }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()
  assert.deepEqual(issues[2], {
    issues: [],
    revision: 3,
    sessionId: "session-1",
    terminal: false
  })

  requestAllItems("storage-all-conflict-again")
  await flushPromises()
  assert.deepEqual(
    issues[3]?.issues.map((issue) => issue.recovery.key),
    ["title", "filter"]
  )

  hasAggregateConflict = false
  requestAllItems("storage-all-recovered")
  await flushPromises()
  assert.deepEqual(issues[4], {
    issues: [],
    revision: 5,
    sessionId: "session-1",
    terminal: false
  })
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

  await manager.startForeground(createLaunchIntent())
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
  let settingsOpenCount = 0
  const host = createHost({
    openExtensionSettings: () => {
      settingsOpenCount += 1
    }
  })
  const { launcher, manager } = createManager({ host })

  await manager.startForeground(createLaunchIntent())
  const request: ExtensionHostRequest = {
    capability: "settings",
    id: "settings-1",
    method: "open-extension",
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
  assert.equal(settingsOpenCount, 0)
})

test("runtime manager stops run-once sessions after ready", async () => {
  const { launcher, manager } = createManager()
  const resultPromise = manager.runOnce(createLaunchIntent())
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
  const resultPromise = manager.runOnce(createLaunchIntent(), {
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
  const resultPromise = manager.runOnce(createLaunchIntent())
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
    writeClipboardText: () => {
      clipboardWriteCount += 1
    }
  })
  const { launcher, manager } = createManager({ host, runtimeCapabilities: ["preferences"] })

  await manager.startForeground(createLaunchIntent())
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

  await manager.startForeground(createLaunchIntent())
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
    }
  })
  const { launcher, manager } = createManager({ host, runtimeCapabilities: ["preferences"] })

  await manager.startForeground(createLaunchIntent())
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

test("runtime manager fail-closes an entitled legacy preferences wire request", async () => {
  const { launcher, manager } = createManager({ runtimeCapabilities: ["preferences"] })

  await manager.startForeground(createLaunchIntent())
  const legacyRequest = {
    capability: "preferences",
    id: "legacy-preferences-1",
    method: "get-extension-preferences",
    payload: {
      extensionName: "github"
    }
  } as unknown as ExtensionHostRequest

  launcher.processes[0]?.emitMessage({
    request: legacyRequest,
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  const response = launcher.processes[0]?.messages.find(
    (message) => message.type === "host-response"
  )
  assert.equal(response?.type, "host-response")
  assert.equal(response?.response.ok, false)
  assert.equal(
    response?.response.ok === false ? response.response.error.code : null,
    "host_request_unsupported"
  )
})

test("runtime manager rejects unknown methods for every capability without host side effects", async () => {
  const hostCalls: string[] = []
  const baseHost = createHost()
  const host = new Proxy(baseHost, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== "function") {
        return value
      }
      return (...args: unknown[]) => {
        hostCalls.push(String(property))
        return Reflect.apply(value, target, args)
      }
    }
  })
  const runtimeCapabilities: ExtensionRuntimeHostCapability[] = [
    ...DEFAULT_RUNTIME_CAPABILITIES,
    "scheduler"
  ]
  const { launcher, manager } = createManager({ host, runtimeCapabilities })
  await manager.startForeground(createLaunchIntent())
  const payload = {
    allowedUrlSchemes: ["https"],
    commandName: "my-issues",
    extensionName: "github",
    intervalMs: null,
    key: "key",
    link: "https://example.com",
    method: "mutate",
    payload: null,
    prompt: "prompt",
    scope: "command",
    text: "text",
    title: "title",
    url: "https://example.com",
    value: "value"
  }
  const capabilities: ExtensionRuntimeHostCapability[] = [
    "agent",
    "ai",
    "clipboard",
    "dialog",
    "navigation",
    "preferences",
    "quicklinks",
    "rpc",
    "scheduler",
    "settings",
    "shell",
    "storage",
    "toast"
  ]

  for (const capability of capabilities) {
    launcher.processes[0]?.emitMessage({
      request: {
        capability,
        id: `unknown-${capability}`,
        method: "legacy-unknown",
        payload
      } as unknown as ExtensionHostRequest,
      sessionId: "session-1",
      type: "host-request"
    })
  }
  await flushPromises()

  for (const capability of capabilities) {
    const response = launcher.processes[0]?.messages.find(
      (message) =>
        message.type === "host-response" && message.response.id === `unknown-${capability}`
    )
    assert.equal(response?.type, "host-response", capability)
    assert.equal(response?.response.ok, false, capability)
    assert.equal(
      response?.type === "host-response" && response.response.ok === false
        ? response.response.error.code
        : null,
      "host_request_unsupported",
      capability
    )
  }
  assert.deepEqual(hostCalls, [])
})

test("runtime manager fail-closes post-commit host requests before capability invocation", async () => {
  let current = true
  let clipboardWriteCount = 0
  const executionLeaseOwner: ExtensionRuntimeExecutionLeaseOwner = {
    isCurrent: () => current,
    resolve: (kind, intent) => createTestLease(intent, kind)
  }
  const host = createHost({
    writeClipboardText: () => {
      clipboardWriteCount += 1
    }
  })
  const { launcher, manager } = createManager({ executionLeaseOwner, host })
  await manager.startForeground(createLaunchIntent())

  current = false
  launcher.processes[0]?.emitMessage({
    request: {
      capability: "clipboard",
      id: "clipboard-after-commit",
      method: "write-text",
      payload: { text: "must not be written" }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  await flushPromises()

  assert.equal(clipboardWriteCount, 0)
  assert.equal(launcher.processes[0]?.killed, true)
  assert.equal(manager.getLastError()?.error.code, "runtime_configuration_revoked")
  assert.equal(
    launcher.processes[0]?.messages.some((message) => message.type === "host-response"),
    false
  )
})

test("runtime manager lets admitted RPC finish with its captured context and drops the late response", async () => {
  let current = true
  let completedSideEffects = 0
  let capturedAccessToken: unknown
  const rpcResult = createDeferred<string>()
  const executionLeaseOwner: ExtensionRuntimeExecutionLeaseOwner = {
    isCurrent: () => current,
    resolve: (kind, intent) => createTestLease(intent, kind)
  }
  const host = createHost({
    invokeNativeExtension: async (_request, context) => {
      capturedAccessToken = context.extensionPreferences.accessToken
      const result = await rpcResult.promise
      completedSideEffects += 1
      return result
    }
  })
  const { launcher, manager } = createManager({ executionLeaseOwner, host })
  await manager.startForeground(createLaunchIntent())

  launcher.processes[0]?.emitMessage({
    request: {
      capability: "rpc",
      id: "rpc-before-commit",
      method: "invoke-native-extension",
      payload: {
        extensionName: "github",
        method: "mutate",
        payload: null
      }
    },
    sessionId: "session-1",
    type: "host-request"
  })
  assert.equal(capturedAccessToken, "secret-token")

  current = false
  manager.revokeInvalidConfigurationSessions()
  rpcResult.resolve("committed externally")
  await flushPromises()

  assert.equal(completedSideEffects, 1)
  assert.equal(launcher.processes[0]?.killed, true)
  assert.equal(
    launcher.processes[0]?.messages.some((message) => message.type === "host-response"),
    false
  )
})

test("runtime manager treats configuration notifications only as revalidation triggers", async () => {
  let current = true
  let notifyConfigurationCommit: () => void = () => undefined
  let subscriptionDisposed = false
  const executionLeaseOwner: ExtensionRuntimeExecutionLeaseOwner = {
    isCurrent: () => current,
    resolve: (kind, intent) => createTestLease(intent, kind)
  }
  const { launcher, manager } = createManager({
    executionLeaseOwner,
    subscribeConfigurationCommits: (listener) => {
      notifyConfigurationCommit = listener
      return () => {
        subscriptionDisposed = true
      }
    }
  })
  await manager.startForeground(createLaunchIntent())

  notifyConfigurationCommit()
  assert.equal(launcher.processes[0]?.killed, false)

  current = false
  notifyConfigurationCommit()
  assert.equal(launcher.processes[0]?.killed, true)

  manager.dispose()
  assert.equal(subscriptionDisposed, true)
})

test("runtime manager settles revoked run-once exactly once before killing its process", async () => {
  let current = true
  const executionLeaseOwner: ExtensionRuntimeExecutionLeaseOwner = {
    isCurrent: () => current,
    resolve: (kind, intent) => createTestLease(intent, kind)
  }
  const { launcher, manager } = createManager({ executionLeaseOwner })
  const resultPromise = manager.runOnce(createLaunchIntent())
  await flushPromises()

  current = false
  manager.revokeInvalidConfigurationSessions()
  const result = await resultPromise
  assert.equal(result.status, "error")
  assert.equal(
    result.status === "error" ? result.error.code : null,
    "runtime_configuration_revoked"
  )
  assert.equal(launcher.processes[0]?.killed, true)

  launcher.processes[0]?.emitMessage({ sessionId: "session-1", type: "ready" })
  launcher.processes[0]?.emitExit(1)
  assert.equal(manager.getLastError()?.error.code, "runtime_configuration_revoked")
})

test("runtime manager does not launch a process for a stale resolved lease", async () => {
  const executionLeaseOwner: ExtensionRuntimeExecutionLeaseOwner = {
    isCurrent: () => false,
    resolve: (kind, intent) => createTestLease(intent, kind)
  }
  const { launcher, manager } = createManager({ executionLeaseOwner })
  await assert.rejects(manager.startForeground(createLaunchIntent()), /configuration changed/i)
  assert.equal(launcher.processes.length, 0)
})

test("runtime manager rejects duplicate session ids without replacing the live process", async () => {
  const { launcher, manager } = createManager()
  await manager.startForeground(createLaunchIntent(), {
    sessionId: "shared-session"
  })
  const secondStart = manager.startForeground(createLaunchIntent(), {
    sessionId: "shared-session"
  })

  await assert.rejects(secondStart, /already exists/i)
  assert.equal(launcher.processes.length, 1)
})

test("runtime manager dispose settles an active run-once instead of leaving it pending", async () => {
  const { launcher, manager } = createManager()
  const resultPromise = manager.runOnce(createLaunchIntent())
  await flushPromises()

  manager.dispose()
  const result = await resultPromise
  assert.equal(result.status, "error")
  assert.equal(result.status === "error" ? result.error.code : null, "runtime_manager_disposed")
  assert.equal(launcher.processes[0]?.killed, true)
})
