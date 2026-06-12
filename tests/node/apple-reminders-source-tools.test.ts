import assert from "node:assert/strict"
import test, { mock } from "node:test"
import { createExtensionAiRuntime } from "../../src/main/agent/extension-ai-runtime"
import { ExtensionToolExecutor } from "../../src/main/extension-tools/executor"
import { ExtensionToolRegistry } from "../../src/main/extension-tools/registry"
import {
  AppleRemindersRequestError,
  normalizeAppleRemindersError
} from "../../installable-extensions/apple-reminders/main/service"
import { createAppleRemindersTools } from "../../installable-extensions/apple-reminders/main/tools"
import { appleRemindersManifest } from "../../installable-extensions/apple-reminders/manifest"
import { githubManifest } from "../../installable-extensions/github/manifest"
import { imageGenerationManifest } from "../../extensions/image-generation/manifest"
import { notionManifest } from "../../installable-extensions/notion/manifest"
import {
  buildNativeExtensionAiCapabilityCatalogItem,
  listNativeExtensionAiCapabilityCatalogFromManifests,
  resolveNativeExtensionAiCapabilityForExtensionNameFromManifests,
  resolveNativeExtensionAiCapabilitiesForRefsFromManifests
} from "../../src/extensions/sources"
import {
  listNativeExtensionSourceMentions,
  nativeExtensionSourceMentions
} from "../../src/extensions/source-mentions"
import type { ComposerMessageRef } from "../../src/shared/message-content"
import type { NativeExtensionResolvedConnection } from "../../src/shared/native-extensions"
import { resolveLocalizedText } from "../../src/shared/i18n"

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

function connectedExtensionConnection(
  extensionName: string,
  publicConfig: Record<string, unknown> = {}
): NativeExtensionResolvedConnection {
  return {
    connectionId: "default",
    extensionName,
    missingSecretNames: [],
    provider: extensionName,
    publicConfig,
    status: "connected"
  }
}

function missingTokenConnection(extensionName: string): NativeExtensionResolvedConnection {
  return {
    connectionId: "default",
    extensionName,
    missingSecretNames: ["accessToken"],
    provider: extensionName,
    publicConfig: {},
    status: "missing"
  }
}

function createRegistry(): { getDataCalls: unknown[]; registry: ExtensionToolRegistry } {
  const getDataCalls: unknown[] = []
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
      deleteReminder: async (input) => ({
        reminderId: input.reminderId
      }),
      getData: async (input) => {
        getDataCalls.push(input)
        return {
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
        }
      },
      setReminderCompleted: async (input) => ({
        ...fakeReminder,
        completionDate: input.completed ? "2026-05-01T00:00:00.000Z" : null,
        isCompleted: input.completed
      }),
      showReminder: async () => null
    })
  )
  return {
    getDataCalls,
    registry
  }
}

const appleRemindersRef: ComposerMessageRef = {
  extensionName: "apple-reminders",
  name: "Apple Reminders",
  sourceId: "appleReminders",
  type: "extension-source"
}

const sourceTestManifests = [
  githubManifest,
  notionManifest,
  appleRemindersManifest,
  imageGenerationManifest
]

function resolveNativeExtensionAiCapabilitiesForRefs(
  refs: ComposerMessageRef[],
  input?: Parameters<typeof resolveNativeExtensionAiCapabilitiesForRefsFromManifests>[2]
) {
  return resolveNativeExtensionAiCapabilitiesForRefsFromManifests(
    refs,
    sourceTestManifests,
    input
  )
}

function resolveNativeExtensionAiCapabilityForExtensionName(
  extensionName: string,
  input?: Parameters<typeof resolveNativeExtensionAiCapabilityForExtensionNameFromManifests>[2]
) {
  return resolveNativeExtensionAiCapabilityForExtensionNameFromManifests(
    extensionName,
    sourceTestManifests,
    input
  )
}

function resolveAppleRemindersCapabilities(platform = "darwin") {
  return resolveNativeExtensionAiCapabilitiesForRefs([appleRemindersRef], {
    getConnection: (extensionName) => connectedExtensionConnection(extensionName),
    platform
  })
}

test("Apple Reminders AI capability is enabled only on macOS", () => {
  const [darwinCapability] = resolveAppleRemindersCapabilities("darwin")
  assert.equal(darwinCapability?.enabled, true)
  assert.equal(darwinCapability?.authStatus, "connected")
  assert.deepEqual(darwinCapability?.enabledToolNames, [
    "listReminders",
    "createReminder",
    "completeReminder",
    "deleteReminder",
    "openReminder"
  ])

  const [linuxCapability] = resolveAppleRemindersCapabilities("linux")
  assert.equal(linuxCapability?.enabled, false)
  assert.equal(linuxCapability?.authStatus, "missing")
  assert.deepEqual(linuxCapability?.enabledToolNames, [])
})

test("AI capability is loaded only from an explicit extension source ref", () => {
  assert.deepEqual(resolveNativeExtensionAiCapabilitiesForRefs([]), [])
  assert.deepEqual(
    nativeExtensionSourceMentions.map((mention) => mention.sourceId),
    ["image"]
  )
  assert.deepEqual(
    sourceTestManifests
      .flatMap((manifest) => {
        const capability = manifest.aiCapability
        if (!capability?.mention) {
          return []
        }
        return [
          {
            extensionName: manifest.name,
            icon: manifest.icon,
            iconName: manifest.iconName,
            label: resolveLocalizedText(capability.mention.label ?? capability.title, "zh-CN"),
            sourceId: capability.id,
            supportedPlatforms: capability.supportedPlatforms ?? manifest.supportedPlatforms,
            value: capability.mention.value ?? manifest.name
          }
        ]
      }),
    [
      {
        extensionName: "github",
        icon: "assets/icon.svg",
        iconName: "github",
        label: "GitHub",
        sourceId: "github",
        supportedPlatforms: undefined,
        value: "github"
      },
      {
        extensionName: "notion",
        icon: "assets/notion-logo.png",
        iconName: "notion",
        label: "Notion",
        sourceId: "notion",
        supportedPlatforms: undefined,
        value: "notion"
      },
      {
        extensionName: "apple-reminders",
        icon: "assets/icon.svg",
        iconName: "reminders",
        label: "提醒事项",
        sourceId: "appleReminders",
        supportedPlatforms: ["darwin"],
        value: "apple-reminders"
      },
      {
        extensionName: "image-generation",
        icon: "assets/icon.svg",
        iconName: "image",
        label: "生图",
        sourceId: "image",
        supportedPlatforms: undefined,
        value: "image"
      }
    ]
  )
  assert.deepEqual(
    listNativeExtensionSourceMentions("darwin").map((mention) => mention.sourceId),
    ["image"]
  )
  assert.deepEqual(
    listNativeExtensionSourceMentions("linux").map((mention) => mention.sourceId),
    ["image"]
  )
  assert.deepEqual(
    listNativeExtensionSourceMentions("darwin", "zh-CN").map((mention) => ({
      label: mention.label,
      sourceId: mention.sourceId
    })),
    [{ label: "生图", sourceId: "image" }]
  )

  const [capability] = resolveAppleRemindersCapabilities("darwin")

  assert.equal(capability?.capability.id, "appleReminders")
  assert.equal(resolveLocalizedText(capability?.capability.title, "en-US"), "Apple Reminders")
  assert.match(capability?.capability.guide ?? "", /local Reminders database/)
})

test("empty AI capability refs do not read extension connection state", () => {
  const calls: string[] = []

  assert.deepEqual(
    resolveNativeExtensionAiCapabilitiesForRefs([], {
      getConnection: (extensionName) => {
        calls.push(`connection:${extensionName}`)
        throw new Error("connection should not be read")
      }
    }),
    []
  )
  assert.deepEqual(calls, [])
})

test("single GitHub AI capability ref reads only GitHub connection state", () => {
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
      getConnection: (extensionName) => {
        calls.push(extensionName)
        return {
          connectionId: "default",
          extensionName,
          missingSecretNames: ["accessToken"],
          provider: "github",
          publicConfig: {
            apiBaseUrl: "https://api.github.com"
          },
          status: "missing"
        }
      }
    }
  )

  assert.deepEqual(calls, ["github"])
  assert.equal(capability?.extensionName, "github")
  assert.equal(capability?.authStatus, "missing")
  assert.deepEqual(capability?.enabledToolNames, [])
  assert.deepEqual(capability?.toolExposures, [])
})

test("GitHub connected connection state exposes the current manifest tool names", () => {
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
      getConnection: (extensionName) => ({
        connectionId: "default",
        extensionName,
        missingSecretNames: [],
        provider: "github",
        publicConfig: {
          apiBaseUrl: "https://github.example.test/api/v3"
        },
        status: "connected"
      })
    }
  )

  assert.equal(capability?.authStatus, "connected")
  assert.deepEqual(capability?.enabledToolNames, capability?.capability.toolNames)
  assert.deepEqual(
    capability?.toolExposures.map((tool) => tool.toolName),
    capability?.capability.toolNames
  )
  assert.deepEqual(capability?.publicConfig, {
    apiBaseUrl: "https://github.example.test/api/v3"
  })
})

test("extension AI capability catalog does not read preferences", () => {
  assert.deepEqual(
    listNativeExtensionAiCapabilityCatalogFromManifests(sourceTestManifests, "darwin").map(
      (item) => item.extensionName
    ),
    ["github", "notion", "apple-reminders", "image-generation"]
  )
})

test("extension AI capability catalog items are still built without mention metadata", () => {
  const item = buildNativeExtensionAiCapabilityCatalogItem({
    capability: {
      description: "Mock source without mention.",
      guide: "Use the mock source.",
      id: "mockSource",
      title: "Mock Source",
      toolNames: []
    } as never,
    manifest: {
      description: "Mock manifest.",
      name: "mock-extension",
      title: "Mock Extension"
    } as never
  })

  assert.deepEqual(item, {
    description: "Mock source without mention.",
    extensionName: "mock-extension",
    guide: "Use the mock source.",
    sourceId: "mockSource",
    supportedPlatforms: undefined,
    title: "Mock Source",
    toolNames: [],
    tools: []
  })
})

test("loadExtension resolution reads only the requested extension connection state", () => {
  const calls: string[] = []
  const capability = resolveNativeExtensionAiCapabilityForExtensionName("github", {
    getConnection: (extensionName) => {
      calls.push(extensionName)
      return {
        connectionId: "default",
        extensionName,
        missingSecretNames: ["accessToken"],
        provider: "github",
        publicConfig: {},
        status: "missing"
      }
    },
    platform: "darwin"
  })

  assert.deepEqual(calls, ["github"])
  assert.equal(capability?.extensionName, "github")
  assert.equal(capability?.authStatus, "missing")
  assert.deepEqual(capability?.enabledToolNames, [])
})

test("selected AI capability connection read failures become failed auth without tools", () => {
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
        getConnection: (extensionName) => {
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
      getConnection: missingTokenConnection,
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

test("GitHub AI capability becomes connected from resolved connection and exposes AI tools", () => {
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
      getConnection: (extensionName) =>
        connectedExtensionConnection(extensionName, {
          apiBaseUrl: "https://github.example.test/api/v3"
        })
    }
  )

  assert.equal(capability?.authStatus, "connected")
  assert.deepEqual(capability?.capability.toolNames, [
    "listMyIssues",
    "listMyPullRequests",
    "searchIssues",
    "searchPullRequests",
    "searchRepositories",
    "listRepositories",
    "listNotifications",
    "listWorkflowRuns",
    "createIssue"
  ])
  assert.deepEqual(capability?.enabledToolNames, capability?.capability.toolNames)
  assert.deepEqual(
    capability?.toolExposures.map((tool) => tool.toolName),
    capability?.capability.toolNames
  )
  assert.deepEqual(capability?.publicConfig, {
    apiBaseUrl: "https://github.example.test/api/v3"
  })
})

test("Notion AI capability becomes connected from resolved connection and exposes read tools", () => {
  const [capability] = resolveNativeExtensionAiCapabilitiesForRefs(
    [
      {
        extensionName: "notion",
        name: "Notion",
        sourceId: "notion",
        type: "extension-source"
      }
    ],
    {
      getConnection: (extensionName) =>
        connectedExtensionConnection(extensionName, {
          apiBaseUrl: "https://api.notion.com/v1"
        })
    }
  )

  assert.equal(capability?.authStatus, "connected")
  const expectedToolNames = notionManifest.aiCapability?.toolNames
  assert.ok(expectedToolNames)
  assert.deepEqual(capability?.capability.toolNames, expectedToolNames)
  assert.deepEqual(capability?.enabledToolNames, capability?.capability.toolNames)
  assert.deepEqual(
    capability?.toolExposures.map((tool) => tool.toolName),
    capability?.capability.toolNames
  )
  assert.deepEqual(capability?.publicConfig, {
    apiBaseUrl: "https://api.notion.com/v1"
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
  const { registry } = createRegistry()
  const runtime = createExtensionAiRuntime({
    aiCapabilities: resolveAppleRemindersCapabilities(),
    registry,
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  assert.deepEqual(
    runtime.aiToolBindings.map((binding) => binding.agentToolName),
    [
      "ext__appleReminders__listReminders",
      "ext__appleReminders__createReminder",
      "ext__appleReminders__completeReminder",
      "ext__appleReminders__deleteReminder",
      "ext__appleReminders__openReminder"
    ]
  )
  assert.equal(
    runtime.approvalPolicyProvider.getCallToolPolicy({
      args: {
        limit: 10
      },
      extensionName: "apple-reminders",
      toolName: "listReminders"
    })?.decision.disposition,
    "allow"
  )
  assert.equal(
    runtime.approvalPolicyProvider.getCallToolPolicy({
      args: {
        title: "Ship it"
      },
      extensionName: "apple-reminders",
      toolName: "createReminder"
    })?.decision.disposition,
    "require_approval"
  )
  assert.equal(
    runtime.approvalPolicyProvider.getCallToolPolicy({
      args: {
        completed: true,
        reminderId: "reminder-1"
      },
      extensionName: "apple-reminders",
      toolName: "completeReminder"
    })?.decision.disposition,
    "require_approval"
  )
  assert.equal(
    runtime.approvalPolicyProvider.getCallToolPolicy({
      args: {
        reminderId: "reminder-1"
      },
      extensionName: "apple-reminders",
      toolName: "deleteReminder"
    })?.decision.disposition,
    "require_approval"
  )
  assert.equal(
    runtime.approvalPolicyProvider.getCallToolPolicy({
      args: {
        reminderId: "reminder-1"
      },
      extensionName: "apple-reminders",
      toolName: "openReminder"
    })?.decision.disposition,
    "require_approval"
  )
})

test("Apple Reminders tools validate input and call main-side services", async () => {
  const aiCapabilities = resolveAppleRemindersCapabilities()
  const { getDataCalls, registry } = createRegistry()
  const [listBinding, createBinding, completeBinding, deleteBinding, openBinding] =
    registry.createAiCapabilityToolBindings(aiCapabilities)
  const executor = new ExtensionToolExecutor({
    bindings: [listBinding, createBinding, completeBinding, deleteBinding, openBinding]
  })

  const listOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__listReminders",
    args: {},
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(listOutput, /Ship source tools/)
  assert.doesNotMatch(listOutput, /Completed item/)
  assert.deepEqual(getDataCalls, [
    {
      includeCompleted: false,
      limit: 25
    }
  ])

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

  const completeOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__completeReminder",
    args: {
      reminderId: "reminder-1"
    },
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(completeOutput, /2026-05-01/)
  assert.match(completeOutput, /"isCompleted": true/)

  const deleteOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__deleteReminder",
    args: {
      reminderId: "reminder-1"
    },
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(deleteOutput, /"reminderId": "reminder-1"/)

  const openOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__openReminder",
    args: {
      reminderId: "reminder-1"
    },
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(openOutput, /"opened": true/)
  assert.match(openOutput, /"reminderId": "reminder-1"/)

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
      deleteReminder: async () => {
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
      },
      setReminderCompleted: async () => {
        throw new AppleRemindersRequestError(
          "Openwork needs permission to access Reminders.",
          "PERMISSION_DENIED"
        )
      },
      showReminder: async () => {
        throw new AppleRemindersRequestError(
          "Openwork needs permission to access Reminders.",
          "PERMISSION_DENIED"
        )
      }
    })
  )
  const aiCapabilities = resolveAppleRemindersCapabilities()
  const [listBinding, createBinding, completeBinding, deleteBinding, openBinding] =
    registry.createAiCapabilityToolBindings(aiCapabilities)
  const executor = new ExtensionToolExecutor({
    bindings: [listBinding, createBinding, completeBinding, deleteBinding, openBinding]
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

  const completeOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__completeReminder",
    args: {
      reminderId: "reminder-1"
    },
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(completeOutput, /Apple Reminders complete reminder failed/)
  assert.match(completeOutput, /permission to access Reminders/)

  const deleteOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__deleteReminder",
    args: {
      reminderId: "reminder-1"
    },
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(deleteOutput, /Apple Reminders delete reminder failed/)
  assert.match(deleteOutput, /permission to access Reminders/)

  const openOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__openReminder",
    args: {
      reminderId: "reminder-1"
    },
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(openOutput, /Apple Reminders open reminder failed/)
  assert.match(openOutput, /permission to access Reminders/)
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
