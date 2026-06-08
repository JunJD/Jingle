import assert from "node:assert/strict"
import test, { mock } from "node:test"
import { appleRemindersManifest } from "../../extensions/apple-reminders/manifest"
import { appleRemindersRuntime } from "../../extensions/apple-reminders/runtime"
import { createAppleRemindersTools } from "../../extensions/apple-reminders/main/tools"
import { githubManifest } from "../../extensions/github/manifest"
import { githubRuntime } from "../../extensions/github/runtime"
import { createGitHubTools } from "../../extensions/github/main/tools"
import { notionManifest } from "../../extensions/notion/manifest"
import {
  buildNativeExtensionAiCapabilityCatalogItem,
  listNativeExtensionAiCapabilityCatalog,
  resolveNativeExtensionAiCapabilityForExtensionName,
  resolveNativeExtensionAiCapabilitiesForRefs
} from "../../src/extensions/sources"
import {
  listNativeExtensionSourceMentions,
  nativeExtensionSourceMentions
} from "../../src/extensions/source-mentions"
import type { ComposerMessageRef } from "../../src/shared/message-content"
import { resolveLocalizedText } from "../../src/shared/i18n"

const appleRemindersRef: ComposerMessageRef = {
  extensionName: "apple-reminders",
  name: "Apple Reminders",
  sourceId: "appleReminders",
  type: "extension-source"
}

const APPLE_REMINDERS_RUNTIME_COMMANDS = [
  "create-reminder",
  "menu-bar-reminders",
  "my-reminders",
  "quick-add-reminder"
]

const GITHUB_RUNTIME_COMMANDS = [
  "create-issue",
  "create-pull-request",
  "my-issues",
  "my-latest-repositories",
  "my-pull-requests",
  "my-starred-repositories",
  "notifications",
  "search-issues",
  "search-pull-requests",
  "search-repositories",
  "unread-notifications",
  "workflow-runs"
]

function sorted(values: string[] | readonly string[]): string[] {
  return [...values].sort()
}

test("Apple Reminders live package keeps runtime and AI tool contracts", () => {
  const runtimeCommands = appleRemindersManifest.commands
    .filter((command) => command.runtime)
    .map((command) => command.name)

  assert.deepEqual(sorted(runtimeCommands), sorted(APPLE_REMINDERS_RUNTIME_COMMANDS))
  assert.deepEqual(
    sorted(Object.keys(appleRemindersRuntime.commands)),
    sorted(APPLE_REMINDERS_RUNTIME_COMMANDS)
  )
  assert.deepEqual(appleRemindersManifest.connection?.auth, {
    type: "none"
  })
  assert.deepEqual(appleRemindersManifest.aiCapability?.toolNames, [
    "listReminders",
    "createReminder",
    "completeReminder",
    "deleteReminder",
    "openReminder"
  ])
  assert.deepEqual(
    sorted(Object.keys(appleRemindersManifest.aiCapability?.toolDisplays ?? {})),
    sorted(appleRemindersManifest.aiCapability?.toolNames ?? [])
  )
  assert.deepEqual(appleRemindersManifest.runtimeCapabilities, ["navigation", "preferences", "rpc"])
  assert.deepEqual(appleRemindersManifest.supportedPlatforms, ["darwin"])
  assert.deepEqual(
    createAppleRemindersTools().map((tool) => tool.name),
    appleRemindersManifest.aiCapability?.toolNames
  )

  const quickAddManifestCommand = appleRemindersManifest.commands.find(
    (command) => command.name === "quick-add-reminder"
  )
  const quickAddRuntimeCommand = appleRemindersRuntime.commands["quick-add-reminder"]
  assert.equal(quickAddManifestCommand?.mode, "no-view")
  assert.equal(quickAddManifestCommand?.arguments, undefined)
  assert.equal(quickAddRuntimeCommand.mode, "no-view")
  assert.equal(typeof quickAddRuntimeCommand.run, "function")
  assert.equal("Component" in quickAddRuntimeCommand, false)

  const menuBarCommand = appleRemindersManifest.commands.find(
    (command) => command.name === "menu-bar-reminders"
  )
  assert.equal(menuBarCommand?.mode, "menu-bar")
  assert.equal(appleRemindersRuntime.commands["menu-bar-reminders"].mode, "menu-bar")
})

test("GitHub live package keeps runtime, connection, and AI tool contracts", () => {
  const githubRuntimeCommands = githubManifest.commands
    .filter((command) => command.mode !== "background" && command.runtime)
    .map((command) => command.name)

  assert.deepEqual(sorted(githubRuntimeCommands), sorted(GITHUB_RUNTIME_COMMANDS))
  assert.deepEqual(sorted(Object.keys(githubRuntime.commands)), sorted(GITHUB_RUNTIME_COMMANDS))
  assert.deepEqual(githubManifest.connection?.auth, {
    authorizationUrl: "https://jingle.cool/oauth/github/start",
    clientId: "jingle-desktop",
    redirect: {
      callbackPath: "/oauth/callback",
      method: "app-scheme",
      scheme: "jingle"
    },
    scopes: ["repo", "read:user", "notifications"],
    secretNames: ["accessToken"],
    tokenUrl: "https://jingle.cool/oauth/github/token",
    type: "oauth"
  })
  assert.deepEqual(githubManifest.aiCapability?.toolNames, [
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
  assert.deepEqual(
    sorted(Object.keys(githubManifest.aiCapability?.toolDisplays ?? {})),
    sorted(githubManifest.aiCapability?.toolNames ?? [])
  )
  assert.deepEqual(githubManifest.runtimeCapabilities, [
    "navigation",
    "preferences",
    "rpc",
    "settings",
    "shell"
  ])
  assert.deepEqual(
    createGitHubTools().map((tool) => tool.name),
    githubManifest.aiCapability?.toolNames
  )

  const runtimeCommandByName = githubRuntime.commands as Record<
    string,
    { Component?: unknown; mode: string }
  >

  for (const commandName of GITHUB_RUNTIME_COMMANDS) {
    const manifestCommand = githubManifest.commands.find((command) => command.name === commandName)
    const runtimeCommand = runtimeCommandByName[commandName]
    assert.equal(runtimeCommand?.mode, manifestCommand?.mode)
    assert.equal(runtimeCommand.mode === "view" || runtimeCommand.mode === "menu-bar", true)
    assert.equal(typeof runtimeCommand.Component, "function")
  }
})

test("Apple Reminders live AI capability is mentionable on macOS and exposes tools", () => {
  const [darwinCapability] = resolveNativeExtensionAiCapabilitiesForRefs([appleRemindersRef], {
    platform: "darwin"
  })
  assert.equal(darwinCapability?.enabled, true)
  assert.equal(darwinCapability?.authStatus, "connected")
  assert.deepEqual(
    darwinCapability?.enabledToolNames,
    appleRemindersManifest.aiCapability?.toolNames
  )
  assert.deepEqual(
    darwinCapability?.toolExposures.map((tool) => tool.toolName),
    appleRemindersManifest.aiCapability?.toolNames
  )
  assert.equal(darwinCapability?.capability.id, "appleReminders")
  assert.equal(resolveLocalizedText(darwinCapability?.capability.title, "en-US"), "Apple Reminders")
  assert.match(darwinCapability?.capability.guide ?? "", /local Reminders database/)

  const [linuxCapability] = resolveNativeExtensionAiCapabilitiesForRefs([appleRemindersRef], {
    platform: "linux"
  })
  assert.equal(linuxCapability?.enabled, false)
  assert.equal(linuxCapability?.authStatus, "missing")
  assert.deepEqual(linuxCapability?.enabledToolNames, [])
})

test("AI capability is loaded only from an explicit extension source ref", () => {
  assert.deepEqual(resolveNativeExtensionAiCapabilitiesForRefs([]), [])
  assert.deepEqual(
    nativeExtensionSourceMentions.map((mention) => ({
      extensionName: mention.extensionName,
      icon: mention.icon,
      label: mention.label,
      sourceId: mention.sourceId,
      supportedPlatforms: mention.supportedPlatforms,
      value: mention.value
    })),
    [
      {
        extensionName: "github",
        icon: "assets/icon.svg",
        label: "GitHub",
        sourceId: "github",
        supportedPlatforms: undefined,
        value: "github"
      },
      {
        extensionName: "notion",
        icon: "assets/notion-logo.png",
        label: "Notion",
        sourceId: "notion",
        supportedPlatforms: undefined,
        value: "notion"
      },
      {
        extensionName: "apple-reminders",
        icon: "assets/icon.png",
        label: "提醒事项",
        sourceId: "appleReminders",
        supportedPlatforms: ["darwin"],
        value: "apple-reminders"
      }
    ]
  )
  assert.deepEqual(
    listNativeExtensionSourceMentions("darwin").map((mention) => mention.sourceId),
    ["github", "notion", "appleReminders"]
  )
  assert.deepEqual(
    listNativeExtensionSourceMentions("linux").map((mention) => mention.sourceId),
    ["github", "notion"]
  )
  assert.deepEqual(
    listNativeExtensionSourceMentions("darwin", "zh-CN").map((mention) => ({
      label: mention.label,
      sourceId: mention.sourceId
    })),
    [
      { label: "GitHub", sourceId: "github" },
      { label: "Notion", sourceId: "notion" },
      { label: "提醒事项", sourceId: "appleReminders" }
    ]
  )
})

test("empty AI capability refs do not read extension connection state", () => {
  const calls: string[] = []

  assert.deepEqual(
    resolveNativeExtensionAiCapabilitiesForRefs([], {
      getConnection: (extensionName) => {
        calls.push(`connection:${extensionName}`)
        throw new Error("connection should not be read")
      },
      getPreferences: (extensionName) => {
        calls.push(`preferences:${extensionName}`)
        return {}
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
  assert.deepEqual(capability?.capability.toolNames, githubManifest.aiCapability?.toolNames)
  assert.deepEqual(capability?.enabledToolNames, capability?.capability.toolNames)
  assert.deepEqual(
    capability?.toolExposures.map((tool) => tool.toolName),
    capability?.capability.toolNames
  )
  const createIssueExposure = capability?.toolExposures.find(
    (tool) => tool.toolName === "createIssue"
  )
  assert.deepEqual(createIssueExposure?.display, {
    description: "在仓库中创建 GitHub Issue。",
    title: "创建 Issue"
  })
  assert.deepEqual(capability?.publicConfig, {
    apiBaseUrl: "https://github.example.test/api/v3"
  })
})

test("extension AI capability display resolves in the requested locale", () => {
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
      }),
      locale: "zh-CN"
    }
  )

  assert.equal(capability?.displayName, "GitHub")
  const createIssueExposure = capability?.toolExposures.find(
    (tool) => tool.toolName === "createIssue"
  )
  assert.deepEqual(createIssueExposure?.display, {
    description: "在仓库中创建 GitHub Issue。",
    title: "创建 Issue"
  })
})

test("extension AI capability catalog does not read preferences", () => {
  assert.deepEqual(
    listNativeExtensionAiCapabilityCatalog("darwin").map((item) => item.extensionName),
    ["github", "notion", "apple-reminders"]
  )
})

test("extension AI capability catalog items are still built without mention metadata", () => {
  const item = buildNativeExtensionAiCapabilityCatalogItem({
    capability: {
      description: "Mock source without mention.",
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
    sourceId: "mockSource",
    supportedPlatforms: undefined,
    title: "Mock Source"
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

test("GitHub AI capability becomes connected from persisted auth and exposes live tools", () => {
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
  assert.deepEqual(capability?.capability.toolNames, githubManifest.aiCapability?.toolNames)
  assert.deepEqual(capability?.enabledToolNames, githubManifest.aiCapability?.toolNames)
  assert.deepEqual(
    capability?.toolExposures.map((tool) => tool.toolName),
    githubManifest.aiCapability?.toolNames
  )
  assert.deepEqual(capability?.publicConfig, {
    apiBaseUrl: "https://github.example.test/api/v3"
  })
})

test("Notion AI capability becomes connected from persisted auth and exposes read tools", () => {
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
      preferencesByExtension: {
        notion: {
          accessToken: "secret_token",
          apiBaseUrl: "https://api.notion.com/v1"
        }
      }
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
