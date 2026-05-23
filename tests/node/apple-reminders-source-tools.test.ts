import assert from "node:assert/strict"
import test, { mock } from "node:test"
import { createExtensionAiRuntime } from "../../src/main/agent/extension-ai-runtime"
import { ExtensionToolExecutor } from "../../src/main/extension-tools/executor"
import { ExtensionToolRegistry } from "../../src/main/extension-tools/registry"
import {
  AppleRemindersRequestError,
  normalizeAppleRemindersError
} from "../../src/extensions/apple-reminders/main/service"
import { createAppleRemindersTools } from "../../src/extensions/apple-reminders/main/tools"
import { resolveNativeExtensionAiCapabilitiesForRefs } from "../../src/extensions/sources"
import {
  listNativeExtensionSourceMentions,
  nativeExtensionSourceMentions
} from "../../src/extensions/source-mentions"
import type { ComposerMessageRef } from "../../src/shared/message-content"

const fakeReminder = {
  completionDate: null,
  creationDate: "2026-04-30T00:00:00.000Z",
  dueDate: null,
  id: "reminder-1",
  isCompleted: false,
  list: {
    color: "#ff0000",
    id: "list-1",
    isDefault: true,
    title: "Reminders"
  },
  notes: "",
  openUrl: "x-apple-reminderkit://REMCDReminder/reminder-1",
  priority: null,
  title: "Ship source tools"
} as const

function createRegistry(): ExtensionToolRegistry {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["apple-reminders"]
  })
  registry.registerExtensionTools(
    "apple-reminders",
    createAppleRemindersTools({
      createReminder: async (input) => ({
        ...fakeReminder,
        notes: input.notes ?? "",
        priority: input.priority ?? null,
        title: input.title
      }),
      getData: async () => ({
        lists: [fakeReminder.list],
        reminders: [
          fakeReminder,
          {
            ...fakeReminder,
            id: "reminder-2",
            isCompleted: true,
            title: "Completed item"
          }
        ]
      })
    })
  )
  return registry
}

const appleRemindersRef: ComposerMessageRef = {
  extensionName: "apple-reminders",
  name: "Apple Reminders",
  sourceId: "appleReminders",
  type: "extension-source"
}

function resolveAppleRemindersCapabilities(platform = "darwin") {
  return resolveNativeExtensionAiCapabilitiesForRefs([appleRemindersRef], {
    platform
  })
}

test("Apple Reminders AI capability is enabled only on macOS", () => {
  const [darwinCapability] = resolveAppleRemindersCapabilities("darwin")
  assert.equal(darwinCapability?.enabled, true)
  assert.equal(darwinCapability?.authStatus, "connected")
  assert.deepEqual(darwinCapability?.enabledToolNames, ["listReminders", "createReminder"])

  const [linuxCapability] = resolveAppleRemindersCapabilities("linux")
  assert.equal(linuxCapability?.enabled, false)
  assert.equal(linuxCapability?.authStatus, "missing")
  assert.deepEqual(linuxCapability?.enabledToolNames, [])
})

test("AI capability is loaded only from an explicit extension source ref", () => {
  assert.deepEqual(resolveNativeExtensionAiCapabilitiesForRefs([]), [])
  assert.deepEqual(nativeExtensionSourceMentions, [
    {
      extensionName: "apple-reminders",
      iconName: "reminders",
      label: "Apple Reminders",
      sourceId: "appleReminders",
      supportedPlatforms: ["darwin"],
      value: "apple-reminders"
    },
    {
      extensionName: "github",
      iconName: "github",
      label: "GitHub",
      sourceId: "github",
      supportedPlatforms: undefined,
      value: "github"
    },
    {
      extensionName: "notion",
      iconName: "notion",
      label: "Notion",
      sourceId: "notion",
      supportedPlatforms: undefined,
      value: "notion"
    }
  ])
  assert.deepEqual(
    listNativeExtensionSourceMentions("darwin").map((mention) => mention.sourceId),
    ["appleReminders", "github", "notion"]
  )
  assert.deepEqual(
    listNativeExtensionSourceMentions("linux").map((mention) => mention.sourceId),
    ["github", "notion"]
  )

  const [capability] = resolveNativeExtensionAiCapabilitiesForRefs([appleRemindersRef], {
    platform: "darwin"
  })

  assert.equal(capability?.capability.id, "appleReminders")
  assert.equal(capability?.capability.title, "Apple Reminders")
  assert.match(capability?.capability.guide ?? "", /local Reminders database/)
})

test("empty AI capability refs do not read extension preferences", () => {
  const calls: string[] = []

  assert.deepEqual(
    resolveNativeExtensionAiCapabilitiesForRefs([], {
      getPreferences: (extensionName) => {
        calls.push(extensionName)
        return {}
      }
    }),
    []
  )
  assert.deepEqual(calls, [])
})

test("single GitHub AI capability ref reads only GitHub preferences", () => {
  const calls: string[] = []
  const [capability] = resolveNativeExtensionAiCapabilitiesForRefs(
    [
      {
        extensionName: "github",
        name: "GitHub",
        sourceId: "github",
        type: "extension-source"
      }
    ],
    {
      getPreferences: (extensionName) => {
        calls.push(extensionName)
        return {}
      }
    }
  )

  assert.deepEqual(calls, ["github"])
  assert.equal(capability?.extensionName, "github")
  assert.equal(capability?.authStatus, "missing")
  assert.deepEqual(capability?.enabledToolNames, [])
  assert.deepEqual(capability?.toolExposures, [])
})

test("selected AI capability preference read failures become failed auth without tools", () => {
  const calls: string[] = []
  const consoleWarn = mock.method(console, "warn", () => {})

  try {
    const [capability] = resolveNativeExtensionAiCapabilitiesForRefs(
      [
        {
          extensionName: "github",
          name: "GitHub",
          sourceId: "github",
          type: "extension-source"
        }
      ],
      {
        getPreferences: (extensionName) => {
          calls.push(extensionName)
          throw new Error("secret store unavailable")
        }
      }
    )

    assert.deepEqual(calls, ["github"])
    assert.equal(consoleWarn.mock.callCount(), 1)
    assert.equal(capability?.extensionName, "github")
    assert.equal(capability?.authStatus, "failed")
    assert.deepEqual(capability?.enabledToolNames, [])
    assert.deepEqual(capability?.toolExposures, [])
  } finally {
    consoleWarn.mock.restore()
  }
})

test("GitHub and Notion mentions load missing AI capabilities without tools", () => {
  const aiCapabilities = resolveNativeExtensionAiCapabilitiesForRefs(
    [
      {
        extensionName: "github",
        name: "GitHub",
        sourceId: "github",
        type: "extension-source"
      },
      {
        extensionName: "notion",
        name: "Notion",
        sourceId: "notion",
        type: "extension-source"
      }
    ],
    {
      platform: "darwin"
    }
  )

  assert.deepEqual(
    aiCapabilities.map((capability) => ({
      authStatus: capability.authStatus,
      extensionName: capability.extensionName,
      tools: capability.enabledToolNames
    })),
    [
      {
        authStatus: "missing",
        extensionName: "github",
        tools: []
      },
      {
        authStatus: "missing",
        extensionName: "notion",
        tools: []
      }
    ]
  )
})

test("GitHub AI capability becomes connected from persisted auth but still exposes no tools", () => {
  const [capability] = resolveNativeExtensionAiCapabilitiesForRefs(
    [
      {
        extensionName: "github",
        name: "GitHub",
        sourceId: "github",
        type: "extension-source"
      }
    ],
    {
      preferencesByExtension: {
        github: {
          accessToken: "ghp_secret",
          apiBaseUrl: "https://github.example.test/api/v3",
          defaultSearchTerms: "",
          numberOfResults: "25"
        }
      }
    }
  )

  assert.equal(capability?.authStatus, "connected")
  assert.deepEqual(capability?.capability.toolNames, [])
  assert.deepEqual(capability?.enabledToolNames, [])
  assert.deepEqual(capability?.toolExposures, [])
  assert.deepEqual(capability?.publicConfig, {
    apiBaseUrl: "https://github.example.test/api/v3"
  })
})

test("unknown extension source refs are ignored", () => {
  const consoleWarn = mock.method(console, "warn", () => {})
  try {
    assert.deepEqual(
      resolveNativeExtensionAiCapabilitiesForRefs([
        {
          extensionName: "unknown",
          name: "Unknown",
          sourceId: "unknown",
          type: "extension-source"
        }
      ]),
      []
    )
  } finally {
    consoleWarn.mock.restore()
  }
})

test("Apple Reminders source exposes read tools and protects write tools with Permission Mode", async () => {
  const runtime = createExtensionAiRuntime({
    aiCapabilities: resolveAppleRemindersCapabilities(),
    registry: createRegistry(),
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  assert.deepEqual(
    runtime.aiToolBindings.map((binding) => binding.agentToolName),
    ["ext__appleReminders__listReminders", "ext__appleReminders__createReminder"]
  )
  assert.equal(
    runtime.approvalPolicyProvider.getPolicy("ext__appleReminders__listReminders")?.decision
      .disposition,
    "allow"
  )
  assert.equal(
    runtime.approvalPolicyProvider.getPolicy("ext__appleReminders__createReminder")?.decision
      .disposition,
    "require_approval"
  )
})

test("Apple Reminders tools validate input and call main-side services", async () => {
  const aiCapabilities = resolveAppleRemindersCapabilities()
  const [listBinding, createBinding] =
    createRegistry().createAiCapabilityToolBindings(aiCapabilities)
  const executor = new ExtensionToolExecutor({
    bindings: [listBinding, createBinding]
  })

  const listOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__listReminders",
    args: {},
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(listOutput, /Ship source tools/)
  assert.doesNotMatch(listOutput, /Completed item/)

  const createOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__createReminder",
    args: {
      notes: "From agent",
      priority: "high",
      title: "Create through source"
    },
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(createOutput, /Create through source/)
  assert.match(createOutput, /From agent/)

  assert.equal(aiCapabilities[0]?.capability.id, "appleReminders")
  await assert.rejects(
    executor.executeAgentTool({
      agentToolName: "ext__appleReminders__createReminder",
      args: {
        title: ""
      },
      threadId: "thread-1",
      workspacePath: "/workspace"
    }),
    /input validation failed/i
  )
})

test("Apple Reminders tools return external Reminders failures as tool output", async () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["apple-reminders"]
  })
  registry.registerExtensionTools(
    "apple-reminders",
    createAppleRemindersTools({
      createReminder: async () => {
        throw new AppleRemindersRequestError(
          "Openwork needs permission to access Reminders.",
          "PERMISSION_DENIED"
        )
      },
      getData: async () => {
        throw new AppleRemindersRequestError(
          "Openwork needs permission to access Reminders.",
          "PERMISSION_DENIED"
        )
      }
    })
  )
  const aiCapabilities = resolveAppleRemindersCapabilities()
  const [listBinding, createBinding] = registry.createAiCapabilityToolBindings(aiCapabilities)
  const executor = new ExtensionToolExecutor({
    bindings: [listBinding, createBinding]
  })

  const listOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__listReminders",
    args: {},
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(listOutput, /Apple Reminders list reminders failed/)
  assert.match(listOutput, /permission to access Reminders/)

  const createOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__createReminder",
    args: {
      title: "Create through source"
    },
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(createOutput, /Apple Reminders create reminder failed/)
  assert.match(createOutput, /permission to access Reminders/)
})

test("Apple Reminders helper access denial maps to permission errors", () => {
  const normalized = normalizeAppleRemindersError({
    stderr: "OpenworkRemindersAccessDenied",
    stdout: ""
  })

  assert.equal(
    normalized.message,
    "Openwork needs permission to access Reminders. Grant Reminders access in System Settings and try again."
  )
  assert.equal(normalized.code, "PERMISSION_DENIED")
})

test("Apple Reminders helper timeout asks for Reminders access", () => {
  const normalized = normalizeAppleRemindersError({
    code: "ETIMEDOUT",
    killed: true,
    stderr: "",
    stdout: ""
  })

  assert.equal(
    normalized.message,
    "Timed out while talking to Reminders. Grant Reminders access if macOS is showing a permission prompt, then try again."
  )
})

test("Apple Reminders unknown helper methods stay user-facing", () => {
  const normalized = normalizeAppleRemindersError({
    stderr: "OpenworkUnsupportedMethod: get-data",
    stdout: ""
  })

  assert.equal(
    normalized.message,
    "Openwork could not complete the Reminders request. Restart Openwork and try again."
  )
})
