import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const requireFromTest = createRequire(import.meta.url)
const originalOpenworkHome = process.env.OPENWORK_HOME
let openworkHome = ""
let connectionResolver!: typeof import("../../src/main/native-extensions/connection-resolver")
let extensionSources!: typeof import("../../src/extensions/sources")
let preferences!: typeof import("../../src/main/preferences")
let DefaultExtensionRuntimeHostCapabilities!: typeof import("../../src/main/services/extension-runtime/host-capabilities").DefaultExtensionRuntimeHostCapabilities

function saveGitHubSecret(): void {
  preferences.setNativeExtensionPreferenceRecord("github", {
    accessToken: "ghp_secret",
    apiBaseUrl: "https://github.example.test/api/v3",
    defaultSearchTerms: "author:@me",
    numberOfResults: "13"
  })
}

function encodeMockSecret(value: string): string {
  return Buffer.from(`encrypted:${value}`, "utf8").toString("base64")
}

function seedLegacyGitHubCommandToken(accessToken: string): void {
  writeFileSync(
    join(openworkHome, "settings.json"),
    JSON.stringify(
      {
        nativeExtensionPreferences: {
          commandPreferences: {
            "github:my-issues": {
              accessToken,
              showAssigned: true,
              showCreated: true,
              showMentioned: true,
              showRecentlyClosed: false
            }
          },
          extensionPreferences: {}
        }
      },
      null,
      2
    )
  )
  writeFileSync(
    join(openworkHome, "secrets.json"),
    JSON.stringify(
      {
        nativeExtensionSecrets: {
          commandSecrets: {
            "github:my-issues": {
              accessToken: encodeMockSecret(accessToken)
            }
          },
          extensionSecrets: {}
        }
      },
      null,
      2
    )
  )
}

function installElectronSafeStorageMock(): void {
  const electronModuleId = requireFromTest.resolve("electron")
  requireFromTest("electron")
  const electronModule = requireFromTest.cache[electronModuleId]
  assert.ok(electronModule, "Expected electron module to be loaded before mocking safeStorage.")

  electronModule.exports = {
    dialog: {
      showMessageBox: async () => ({ response: 0 })
    },
    safeStorage: {
      decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
      isEncryptionAvailable: () => true
    },
    shell: {
      openExternal: async (url: string) => {
        ;(
          globalThis as typeof globalThis & {
            __OPENWORK_TEST_SHELL_OPEN_EXTERNAL_URLS__?: string[]
          }
        ).__OPENWORK_TEST_SHELL_OPEN_EXTERNAL_URLS__?.push(url)
      }
    }
  }
}

function createRuntimeHostQuicklinkServiceMock(): ConstructorParameters<
  typeof DefaultExtensionRuntimeHostCapabilities
>[2] {
  return { registerQuicklink: () => undefined } as unknown as ConstructorParameters<
    typeof DefaultExtensionRuntimeHostCapabilities
  >[2]
}

test.after(async () => {
  if (originalOpenworkHome === undefined) {
    delete process.env.OPENWORK_HOME
  } else {
    process.env.OPENWORK_HOME = originalOpenworkHome
  }

  if (openworkHome) {
    await rm(openworkHome, { force: true, recursive: true })
  }
})

test.before(async () => {
  openworkHome = await mkdtemp(join(tmpdir(), "openwork-native-extension-preferences-"))
  process.env.OPENWORK_HOME = openworkHome
  installElectronSafeStorageMock()
  preferences = await import("../../src/main/preferences")
  connectionResolver = await import("../../src/main/native-extensions/connection-resolver")
  extensionSources = await import("../../src/extensions/sources")
  ;({ DefaultExtensionRuntimeHostCapabilities } =
    await import("../../src/main/services/extension-runtime/host-capabilities"))
})

test("native extension password preferences are redacted from public reads", () => {
  const savedRecord = preferences.setNativeExtensionPreferenceRecord("github", {
    accessToken: "ghp_secret",
    apiBaseUrl: "https://github.example.test/api/v3",
    defaultSearchTerms: "author:@me",
    numberOfResults: "13"
  })

  assert.equal(savedRecord.accessToken, "")

  const publicRecord = preferences.getNativeExtensionPreferenceRecord("github")
  assert.equal(publicRecord.accessToken, "")
  assert.equal(publicRecord.apiBaseUrl, "https://github.example.test/api/v3")

  const resolvedRecord = preferences.getResolvedNativeExtensionPreferenceRecord("github")
  assert.equal(resolvedRecord.accessToken, "ghp_secret")
  assert.equal(resolvedRecord.apiBaseUrl, "https://github.example.test/api/v3")
})

test("resolved command preferences include extension secrets for main-side runtime use", () => {
  saveGitHubSecret()

  const publicRecord = preferences.getNativeExtensionCommandPreferenceRecord("github", "my-issues")
  assert.equal(publicRecord.accessToken, "")
  assert.equal(publicRecord.showCreated, true)

  const resolvedRecord = preferences.getResolvedNativeExtensionCommandPreferenceRecord(
    "github",
    "my-issues"
  )
  assert.equal(resolvedRecord.accessToken, "ghp_secret")
  assert.equal(resolvedRecord.showCreated, true)
})

test("saving non-secret extension preferences preserves stored password secrets", () => {
  saveGitHubSecret()

  preferences.setNativeExtensionPreferenceRecord("github", {
    apiBaseUrl: "https://github.changed.test/api/v3",
    defaultSearchTerms: "assignee:@me",
    numberOfResults: "21"
  })

  const resolvedRecord = preferences.getResolvedNativeExtensionPreferenceRecord("github")
  assert.equal(resolvedRecord.accessToken, "ghp_secret")
  assert.equal(resolvedRecord.apiBaseUrl, "https://github.changed.test/api/v3")
})

test("native extension appPicker preferences normalize to application records", () => {
  const defaultRecord = preferences.getNativeExtensionPreferenceRecord("notion")
  assert.deepEqual(defaultRecord.open_in, { name: "Notion" })

  const stringRecord = preferences.setNativeExtensionPreferenceRecord("notion", {
    open_in: " Notion "
  })
  assert.deepEqual(stringRecord.open_in, { name: "Notion" })
  assert.deepEqual(preferences.getResolvedNativeExtensionPreferenceRecord("notion").open_in, {
    name: "Notion"
  })

  const objectRecord = preferences.setNativeExtensionPreferenceRecord("notion", {
    open_in: {
      bundleId: " notion.id ",
      name: " Notion ",
      path: " /Applications/Notion.app "
    }
  })
  assert.deepEqual(objectRecord.open_in, {
    bundleId: "notion.id",
    name: "Notion",
    path: "/Applications/Notion.app"
  })
})

test("resolved extension preferences do not read legacy command-scoped shared secrets", () => {
  seedLegacyGitHubCommandToken("ghp_legacy_secret")

  const resolvedExtensionRecord = preferences.getResolvedNativeExtensionPreferenceRecord("github")
  assert.equal(resolvedExtensionRecord.accessToken, "")
  assert.equal(resolvedExtensionRecord.apiBaseUrl, "https://api.github.com")
})

test("connection resolver reads legacy command-scoped shared secrets during migration", () => {
  seedLegacyGitHubCommandToken("ghp_legacy_secret")

  const context = connectionResolver.resolveNativeExtensionExecutionContext({
    commandName: "my-issues",
    extensionName: "github"
  })

  assert.equal(context.connection.status, "connected")
  assert.equal(context.extensionPreferences.accessToken, "ghp_legacy_secret")
  assert.equal(context.commandPreferences?.accessToken, "ghp_legacy_secret")
  assert.deepEqual(context.connection.publicConfig, {
    apiBaseUrl: "https://api.github.com"
  })
})

test("extension-scoped shared secrets override resolver legacy command-scoped secrets", () => {
  seedLegacyGitHubCommandToken("ghp_legacy_secret")
  preferences.setNativeExtensionPreferenceRecord("github", {
    accessToken: "ghp_extension_secret",
    apiBaseUrl: "https://github.example.test/api/v3"
  })

  const context = connectionResolver.resolveNativeExtensionExecutionContext({
    commandName: "my-issues",
    extensionName: "github"
  })

  assert.equal(context.connection.status, "connected")
  assert.equal(context.extensionPreferences.accessToken, "ghp_extension_secret")
  assert.equal(context.commandPreferences?.accessToken, "ghp_extension_secret")
  assert.deepEqual(context.connection.publicConfig, {
    apiBaseUrl: "https://github.example.test/api/v3"
  })
})

test("connection resolver resolves formal Notion secrets and rejects retired generated package", () => {
  preferences.setNativeExtensionPreferenceRecord("notion", {
    accessToken: "notion_provider_secret",
    apiBaseUrl: "https://api.notion.com/v1"
  })

  const context = connectionResolver.resolveNativeExtensionExecutionContext({
    commandName: "search-page",
    extensionName: "notion"
  })

  assert.equal(context.connection.status, "connected")
  assert.equal(context.connection.provider, "notion")
  assert.equal(context.extensionPreferences.accessToken, "notion_provider_secret")
  assert.equal(context.extensionPreferences.apiBaseUrl, "https://api.notion.com/v1")
  assert.equal(context.commandPreferences?.accessToken, "notion_provider_secret")
  assert.equal(context.commandPreferences?.apiBaseUrl, "https://api.notion.com/v1")
  assert.deepEqual(context.connection.publicConfig, {
    apiBaseUrl: "https://api.notion.com/v1"
  })

  assert.throws(
    () =>
      connectionResolver.resolveNativeExtensionExecutionContext({
        commandName: "search-page",
        extensionName: "notion-generated"
      }),
    /Unknown native extension "notion-generated"/
  )
})

test("formal Notion secrets connect AI capabilities and generated capability is retired", () => {
  preferences.setNativeExtensionPreferenceRecord("notion", {
    accessToken: "notion_provider_secret",
    apiBaseUrl: "https://api.notion.com/v1"
  })

  const connection = connectionResolver.resolveNativeExtensionConnection({
    extensionName: "notion"
  })

  assert.equal(connection.status, "connected")
  assert.equal(connection.provider, "notion")
  assert.deepEqual(connection.missingSecretNames, [])

  const capability = extensionSources.resolveNativeExtensionAiCapabilityForExtensionName(
    "notion",
    {
      getConnection: (extensionName) =>
        connectionResolver.resolveNativeExtensionConnection({ extensionName })
    }
  )

  assert.equal(capability?.authStatus, "connected")
  assert.deepEqual(capability?.enabledToolNames, [
    "searchPages",
    "getPage",
    "retrievePage",
    "getPageMarkdown",
    "listBlockChildren",
    "getDatabases",
    "retrieveDataSource",
    "searchDatabase",
    "queryDataSource",
    "addToPage",
    "createPage",
    "createDatabasePage"
  ])
  assert.equal(
    extensionSources.resolveNativeExtensionAiCapabilityForExtensionName("notion-generated"),
    null
  )
})

test("formal Notion settings token feeds runtime host and AI capability through the same connection", async () => {
  preferences.setNativeExtensionPreferenceRecord("notion", {
    accessToken: "notion_settings_token",
    apiBaseUrl: "https://api.notion.com/v1"
  })

  const { NativeExtensionsService } = await import("../../src/main/native-extensions/service")
  const nativeExtensionsService = new NativeExtensionsService()

  assert.deepEqual(nativeExtensionsService.getPreferences("notion"), {
    accessToken: "",
    apiBaseUrl: "https://api.notion.com/v1",
    open_in: {
      name: "Notion"
    },
    properties_in_page_previews: false
  })
  assert.deepEqual(nativeExtensionsService.getResolvedPreferences("notion"), {
    accessToken: "notion_settings_token",
    apiBaseUrl: "https://api.notion.com/v1",
    open_in: {
      name: "Notion"
    },
    properties_in_page_previews: false
  })
  assert.deepEqual(nativeExtensionsService.getResolvedCommandPreferences("notion", "search-page"), {
    accessToken: "notion_settings_token",
    apiBaseUrl: "https://api.notion.com/v1",
    open_in: {
      name: "Notion"
    },
    primaryAction: "notion",
    properties_in_page_previews: false
  })

  const host = new DefaultExtensionRuntimeHostCapabilities(
    nativeExtensionsService,
    { openExternal: async () => undefined } as ConstructorParameters<
      typeof DefaultExtensionRuntimeHostCapabilities
    >[1],
    createRuntimeHostQuicklinkServiceMock(),
    { openWindow: () => undefined } as ConstructorParameters<
      typeof DefaultExtensionRuntimeHostCapabilities
    >[3],
    { handleNavigationRequest: async () => undefined } as unknown as ConstructorParameters<
      typeof DefaultExtensionRuntimeHostCapabilities
    >[4]
  )

  assert.equal(host.getExtensionPreferences("notion").accessToken, "notion_settings_token")
  assert.equal(
    host.getCommandPreferences({
      commandName: "search-page",
      extensionName: "notion"
    }).accessToken,
    "notion_settings_token"
  )

  const capability = extensionSources.resolveNativeExtensionAiCapabilityForExtensionName(
    "notion",
    {
      getConnection: (extensionName) =>
        connectionResolver.resolveNativeExtensionConnection({ extensionName })
    }
  )
  assert.equal(capability?.authStatus, "connected")
  assert.deepEqual(capability?.publicConfig, {
    apiBaseUrl: "https://api.notion.com/v1"
  })
  assert.deepEqual(capability?.enabledToolNames, capability?.capability.toolNames)
})

test("extension runtime host resolves preferences with secrets through main-side service methods", () => {
  const publicReadCalls: string[] = []
  const nativeExtensionsService = {
    getCommandPreferences: () => {
      publicReadCalls.push("command")
      return {}
    },
    getPreferences: () => {
      publicReadCalls.push("extension")
      return {}
    },
    getResolvedCommandPreferences: (extensionName: string, commandName: string) => ({
      accessToken: "ghp_secret",
      commandName,
      extensionName
    }),
    getResolvedPreferences: (extensionName: string) => ({
      accessToken: "ghp_secret",
      extensionName
    }),
    invoke: async () => null
  } as unknown as ConstructorParameters<typeof DefaultExtensionRuntimeHostCapabilities>[0]

  const host = new DefaultExtensionRuntimeHostCapabilities(
    nativeExtensionsService,
    { openExternal: async () => undefined } as ConstructorParameters<
      typeof DefaultExtensionRuntimeHostCapabilities
    >[1],
    createRuntimeHostQuicklinkServiceMock(),
    { openWindow: () => undefined } as ConstructorParameters<
      typeof DefaultExtensionRuntimeHostCapabilities
    >[3],
    { handleNavigationRequest: async () => undefined } as unknown as ConstructorParameters<
      typeof DefaultExtensionRuntimeHostCapabilities
    >[4]
  )

  assert.deepEqual(
    host.getCommandPreferences({
      commandName: "my-issues",
      extensionName: "github"
    }),
    {
      accessToken: "ghp_secret",
      commandName: "my-issues",
      extensionName: "github"
    }
  )
  assert.deepEqual(host.getExtensionPreferences("github"), {
    accessToken: "ghp_secret",
    extensionName: "github"
  })
  assert.deepEqual(publicReadCalls, [])
})

test("extension runtime shell host only opens declared desktop URL schemes", async () => {
  const publicOpenedUrls: string[] = []
  const shellOpenedUrls: string[] = []
  ;(
    globalThis as typeof globalThis & {
      __OPENWORK_TEST_SHELL_OPEN_EXTERNAL_URLS__?: string[]
    }
  ).__OPENWORK_TEST_SHELL_OPEN_EXTERNAL_URLS__ = shellOpenedUrls
  const nativeExtensionsService = {
    getManifest: (extensionName: string) => ({
      commands: [{ mode: "view", name: "search-page" }],
      name: extensionName,
      runtimeShell: extensionName === "notion" ? { allowedUrlSchemes: ["notion"] } : undefined
    }),
    getResolvedCommandPreferences: () => ({}),
    getResolvedPreferences: () => ({}),
    invoke: async () => null
  } as unknown as ConstructorParameters<typeof DefaultExtensionRuntimeHostCapabilities>[0]

  const host = new DefaultExtensionRuntimeHostCapabilities(
    nativeExtensionsService,
    {
      openExternal: async (url: string) => {
        publicOpenedUrls.push(url)
      }
    } as ConstructorParameters<typeof DefaultExtensionRuntimeHostCapabilities>[1],
    createRuntimeHostQuicklinkServiceMock(),
    { openWindow: () => undefined } as ConstructorParameters<
      typeof DefaultExtensionRuntimeHostCapabilities
    >[3],
    { handleNavigationRequest: async () => undefined } as unknown as ConstructorParameters<
      typeof DefaultExtensionRuntimeHostCapabilities
    >[4]
  )

  await host.openExternal({
    allowedUrlSchemes: [],
    context: {
      commandName: "search-page",
      commandPreferences: {},
      extensionName: "notion",
      extensionPreferences: {},
      initialAction: "open",
      locale: "zh-CN",
      mode: "view",
      seedQuery: ""
    },
    url: "https://example.com/docs"
  })

  await assert.rejects(
    () =>
      host.openExternal({
        allowedUrlSchemes: ["notion"],
        context: {
          commandName: "search-page",
          commandPreferences: {},
          extensionName: "github",
          extensionPreferences: {},
          initialAction: "open",
          locale: "zh-CN",
          mode: "view",
          seedQuery: ""
        },
        url: "notion://www.notion.so/page-1"
      }),
    /cannot open URL scheme "notion"/
  )

  await host.openExternal({
    allowedUrlSchemes: ["notion"],
    context: {
      commandName: "search-page",
      commandPreferences: {},
      extensionName: "notion",
      extensionPreferences: {},
      initialAction: "open",
      locale: "zh-CN",
      mode: "view",
      seedQuery: ""
    },
    url: "notion://www.notion.so/page-1"
  })

  assert.deepEqual(publicOpenedUrls, ["https://example.com/docs"])
  assert.deepEqual(shellOpenedUrls, ["notion://www.notion.so/page-1"])
})

test("extension runtime shell host opens URLs with a requested desktop application target", async () => {
  const openedWithApplications: Array<{
    application: { bundleId?: string; name?: string; path?: string }
    url: string
  }> = []
  const nativeExtensionsService = {
    getManifest: (extensionName: string) => ({
      commands: [{ mode: "view", name: "search-page" }],
      name: extensionName,
      runtimeShell: { allowedUrlSchemes: ["notion"] }
    }),
    getResolvedCommandPreferences: () => ({}),
    getResolvedPreferences: () => ({}),
    invoke: async () => null
  } as unknown as ConstructorParameters<typeof DefaultExtensionRuntimeHostCapabilities>[0]

  const host = new DefaultExtensionRuntimeHostCapabilities(
    nativeExtensionsService,
    {
      openExternal: async () => {
        throw new Error("Expected application-targeted open to bypass public external links")
      }
    } as ConstructorParameters<typeof DefaultExtensionRuntimeHostCapabilities>[1],
    createRuntimeHostQuicklinkServiceMock(),
    { openWindow: () => undefined } as ConstructorParameters<
      typeof DefaultExtensionRuntimeHostCapabilities
    >[3],
    { handleNavigationRequest: async () => undefined } as unknown as ConstructorParameters<
      typeof DefaultExtensionRuntimeHostCapabilities
    >[4],
    async (url, application) => {
      openedWithApplications.push({ application, url })
    }
  )

  await host.openExternal({
    allowedUrlSchemes: [],
    application: {
      bundleId: "notion.id",
      name: "Notion"
    },
    context: {
      commandName: "search-page",
      commandPreferences: {},
      extensionName: "notion",
      extensionPreferences: {},
      initialAction: "open",
      locale: "zh-CN",
      mode: "view",
      seedQuery: ""
    },
    url: "https://www.notion.so/page-1"
  })

  await host.openExternal({
    allowedUrlSchemes: ["notion"],
    application: {
      bundleId: "notion.id",
      name: "Notion"
    },
    context: {
      commandName: "search-page",
      commandPreferences: {},
      extensionName: "notion",
      extensionPreferences: {},
      initialAction: "open",
      locale: "zh-CN",
      mode: "view",
      seedQuery: ""
    },
    url: "notion://www.notion.so/page-1"
  })

  assert.deepEqual(openedWithApplications, [
    {
      application: {
        bundleId: "notion.id",
        name: "Notion"
      },
      url: "https://www.notion.so/page-1"
    },
    {
      application: {
        bundleId: "notion.id",
        name: "Notion"
      },
      url: "notion://www.notion.so/page-1"
    }
  ])
})
