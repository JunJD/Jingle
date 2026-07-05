import assert from "node:assert/strict"
import test, { mock } from "node:test"
import { imageGenerationManifest } from "../../extensions/image-generation/manifest"
import { appleRemindersManifest } from "../../installable-extensions/apple-reminders/manifest"
import { appleRemindersRuntime } from "../../installable-extensions/apple-reminders/runtime"
import { createAppleRemindersTools } from "../../installable-extensions/apple-reminders/main/tools"
import { githubManifest } from "../../installable-extensions/github/manifest"
import { githubRuntime } from "../../installable-extensions/github/runtime"
import { createGitHubTools } from "../../installable-extensions/github/main/tools"
import { figmaFilesManifest } from "../../installable-extensions/figma-files/manifest"
import { notionManifest } from "../../installable-extensions/notion/manifest"
import {
  buildNativeExtensionAiCapabilityCatalogItem,
  listNativeExtensionAiCapabilityCatalog,
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

const appleRemindersRef: ComposerMessageRef = {
  extensionName: "apple-reminders",
  name: "Apple Reminders",
  sourceId: "appleReminders",
  type: "extension-source"
}

const imageGenerationRef: ComposerMessageRef = {
  extensionName: "image-generation",
  name: "Image Generation",
  sourceId: "image",
  type: "extension-source"
}

const livePackageManifests = [
  githubManifest,
  notionManifest,
  appleRemindersManifest,
  figmaFilesManifest
]

function resolveNativeExtensionAiCapabilitiesForRefs(
  refs: ComposerMessageRef[],
  input?: Parameters<typeof resolveNativeExtensionAiCapabilitiesForRefsFromManifests>[2]
) {
  return resolveNativeExtensionAiCapabilitiesForRefsFromManifests(
    refs,
    livePackageManifests,
    input
  )
}

function resolveNativeExtensionAiCapabilityForExtensionName(
  extensionName: string,
  input?: Parameters<typeof resolveNativeExtensionAiCapabilityForExtensionNameFromManifests>[2]
) {
  return resolveNativeExtensionAiCapabilityForExtensionNameFromManifests(
    extensionName,
    livePackageManifests,
    input
  )
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

test("Notion live package uses platform OAuth instead of manual token preferences", () => {
  assert.deepEqual(notionManifest.connection?.auth, {
    authorizationUrl: "https://jingle.cool/oauth/notion/start",
    clientId: "jingle-desktop",
    redirect: {
      callbackPath: "/oauth/callback",
      method: "app-scheme",
      scheme: "jingle"
    },
    scopes: [],
    secretNames: ["accessToken"],
    tokenUrl: "https://jingle.cool/oauth/notion/token",
    type: "oauth"
  })
  assert.equal(
    (notionManifest.preferences ?? []).some((preference) => preference.name === "accessToken"),
    false
  )
})

test("Figma Files live package uses platform OAuth instead of manual token preferences", () => {
  assert.deepEqual(figmaFilesManifest.connection?.auth, {
    authorizationUrl: "https://jingle.cool/oauth/figma/start",
    clientId: "jingle-desktop",
    redirect: {
      callbackPath: "/oauth/callback",
      method: "app-scheme",
      scheme: "jingle"
    },
    scopes: ["current_user:read", "projects:read", "file_metadata:read", "file_content:read"],
    secretNames: ["accessToken"],
    tokenUrl: "https://jingle.cool/oauth/figma/token",
    type: "oauth"
  })
  assert.equal(
    (figmaFilesManifest.preferences ?? []).some((preference) => preference.name === "accessToken"),
    false
  )
  assert.deepEqual(figmaFilesManifest.connection?.publicPreferenceNames, ["TEAM_ID", "open_in"])
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
    "agent",
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
  const [darwinCapability] = resolveNativeExtensionAiCapabilitiesForRefsFromManifests(
    [appleRemindersRef],
    livePackageManifests,
    {
      getConnection: (extensionName) => connectedExtensionConnection(extensionName),
      platform: "darwin"
    }
  )
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

  const [linuxCapability] = resolveNativeExtensionAiCapabilitiesForRefsFromManifests(
    [appleRemindersRef],
    livePackageManifests,
    {
      getConnection: (extensionName) => connectedExtensionConnection(extensionName),
      platform: "linux"
    }
  )
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
        extensionName: "image-generation",
        icon: "assets/icon.svg",
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
})

test("Image Generation live package uses API key connection auth", () => {
  assert.deepEqual(imageGenerationManifest.connection?.auth, {
    secretNames: ["apiKey"],
    type: "apiKey"
  })
  assert.equal(imageGenerationManifest.aiCapability?.connectionId, "default")
  assert.deepEqual(imageGenerationManifest.connection?.publicPreferenceNames, ["baseUrl"])
})

test("Image Generation AI capability reads connection-scoped auth", () => {
  const [capability] = resolveNativeExtensionAiCapabilitiesForRefsFromManifests(
    [imageGenerationRef],
    [imageGenerationManifest],
    {
      getConnection: () => ({
        connectionId: "default",
        extensionName: "image-generation",
        missingSecretNames: [],
        provider: "image-generation",
        publicConfig: {
          baseUrl: "https://images.example.test"
        },
        status: "connected"
      })
    }
  )

  assert.equal(capability?.authStatus, "connected")
  assert.deepEqual(
    capability?.enabledToolNames,
    imageGenerationManifest.aiCapability?.toolNames
  )
  assert.deepEqual(
    capability?.toolExposures.map((tool) => tool.toolName),
    imageGenerationManifest.aiCapability?.toolNames
  )
  assert.deepEqual(capability?.publicConfig, {
    baseUrl: "https://images.example.test"
  })
})

test("Image Generation AI capability reports missing auth when API key is absent", () => {
  const [capability] = resolveNativeExtensionAiCapabilitiesForRefsFromManifests(
    [imageGenerationRef],
    [imageGenerationManifest],
    {
      getConnection: () => ({
        connectionId: "default",
        extensionName: "image-generation",
        missingSecretNames: ["apiKey"],
        provider: "image-generation",
        publicConfig: {
          baseUrl: "https://images.example.test"
        },
        status: "missing"
      })
    }
  )

  assert.equal(capability?.authStatus, "missing")
  assert.deepEqual(capability?.enabledToolNames, [])
  assert.deepEqual(capability?.toolExposures, [])
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
    ["image-generation"]
  )
  assert.deepEqual(
    listNativeExtensionAiCapabilityCatalogFromManifests(livePackageManifests, "darwin").map(
      (item) => item.extensionName
    ),
    ["github", "notion", "apple-reminders"]
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

test("GitHub AI capability becomes connected from resolved connection and exposes live tools", () => {
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
