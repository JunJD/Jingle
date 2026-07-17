import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import Store from "electron-store"
import { notionManifest } from "../../installable-extensions/notion/manifest"

const figmaPlatformSupported = process.platform === "darwin" || process.platform === "win32"
const requireFromTest = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const originalJingleHome = process.env.JINGLE_HOME
const originalElectronRendererUrl = process.env.ELECTRON_RENDERER_URL
let jingleHome = ""
let connectionResolver!: typeof import("../../src/main/native-extensions/connection-resolver")
let executionContext!: typeof import("../../src/main/native-extensions/execution-context")
let extensionSources!: typeof import("../../src/extensions/sources")
let preferences!: typeof import("../../src/main/preferences")
let DefaultExtensionRuntimeHostCapabilities!: typeof import("../../src/main/services/extension-runtime/host-capabilities").DefaultExtensionRuntimeHostCapabilities

const desktopOAuthContract = {
  clientId: "jingle-desktop",
  codeChallengeMethod: "S256",
  redirectUri: "jingle://oauth/callback",
  responseType: "code"
} as const

function saveNotionSecret(): void {
  seedLegacyNotionExtensionToken("notion_secret", "https://api.notion.example.test/v1")
}

function saveGitHubConnectionSecret(accessToken: string): void {
  preferences.setNativeExtensionConnectionSecretRecord({
    connectionId: "default",
    extensionName: "github",
    mode: "replace",
    nextRecord: { accessToken },
    provider: "github"
  })
}

function saveNotionConnectionSecret(accessToken: string): void {
  preferences.setNativeExtensionConnectionSecretRecord({
    connectionId: "default",
    extensionName: "notion",
    mode: "replace",
    nextRecord: { accessToken },
    provider: "notion"
  })
}

function saveFigmaConnectionSecret(accessToken: string): void {
  preferences.setNativeExtensionConnectionSecretRecord({
    connectionId: "default",
    extensionName: "figma-files",
    mode: "replace",
    nextRecord: { accessToken },
    provider: "figma"
  })
}

function encodeMockSecret(value: string): string {
  return Buffer.from(`encrypted:${value}`, "utf8").toString("base64")
}

function assertDesktopOAuthAuthorizationContract(authorizationUrl: URL): void {
  assert.equal(authorizationUrl.searchParams.get("client_id"), desktopOAuthContract.clientId)
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), desktopOAuthContract.redirectUri)
  assert.equal(
    authorizationUrl.searchParams.get("response_type"),
    desktopOAuthContract.responseType
  )
  assert.equal(
    authorizationUrl.searchParams.get("code_challenge_method"),
    desktopOAuthContract.codeChallengeMethod
  )
  assert.equal(typeof authorizationUrl.searchParams.get("code_challenge"), "string")
  assert.ok(authorizationUrl.searchParams.get("code_challenge"))
  assert.ok(authorizationUrl.searchParams.get("state"))
}

function assertDesktopOAuthTokenRequestContract(
  body: Record<string, unknown>,
  state: string
): void {
  assert.equal(body.client_id, desktopOAuthContract.clientId)
  assert.equal(body.redirect_uri, desktopOAuthContract.redirectUri)
  assert.equal(typeof body.code_verifier, "string")
  assert.ok(body.code_verifier)
  assert.equal(body.state, state)
}

function seedLegacyGitHubTokens(params: {
  commandAccessToken?: string
  extensionAccessToken?: string
  apiBaseUrl?: string
}): void {
  const commandPreferences = params.commandAccessToken
    ? {
        "github:my-issues": {
          accessToken: params.commandAccessToken,
          showAssigned: true,
          showCreated: true,
          showMentioned: true,
          showRecentlyClosed: false
        }
      }
    : {}
  const extensionPreferences = params.extensionAccessToken
    ? {
        github: {
          accessToken: params.extensionAccessToken,
          apiBaseUrl: params.apiBaseUrl ?? "https://api.github.com",
          defaultSearchTerms: "",
          numberOfResults: "25"
        }
      }
    : {}
  const commandSecrets = params.commandAccessToken
    ? {
        "github:my-issues": {
          accessToken: encodeMockSecret(params.commandAccessToken)
        }
      }
    : {}
  const extensionSecrets = params.extensionAccessToken
    ? {
        github: {
          accessToken: encodeMockSecret(params.extensionAccessToken)
        }
      }
    : {}

  writeFileSync(
    join(jingleHome, "settings.json"),
    JSON.stringify(
      {
        nativeExtensionPreferences: {
          commandPreferences,
          extensionPreferences
        }
      },
      null,
      2
    )
  )
  writeFileSync(
    join(jingleHome, "secrets.json"),
    JSON.stringify(
      {
        nativeExtensionSecrets: {
          commandSecrets,
          extensionSecrets
        }
      },
      null,
      2
    )
  )
}

function seedLegacyGitHubCommandToken(accessToken: string): void {
  seedLegacyGitHubTokens({ commandAccessToken: accessToken })
}

function seedLegacyNotionExtensionToken(
  accessToken: string,
  apiBaseUrl = "https://api.notion.com/v1"
): void {
  writeFileSync(
    join(jingleHome, "settings.json"),
    JSON.stringify(
      {
        nativeExtensionPreferences: {
          commandPreferences: {},
          extensionPreferences: {
            notion: {
              accessToken,
              apiBaseUrl
            }
          }
        }
      },
      null,
      2
    )
  )
  writeFileSync(
    join(jingleHome, "secrets.json"),
    JSON.stringify(
      {
        nativeExtensionSecrets: {
          commandSecrets: {},
          extensionSecrets: {
            notion: {
              accessToken: encodeMockSecret(accessToken)
            }
          }
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
    BrowserWindow: {
      getAllWindows: () =>
        (
          globalThis as typeof globalThis & {
            __JINGLE_TEST_NATIVE_EXTENSION_WINDOWS__?: unknown[]
          }
        ).__JINGLE_TEST_NATIVE_EXTENSION_WINDOWS__ ?? []
    },
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
        const shellError = (
          globalThis as typeof globalThis & {
            __JINGLE_TEST_SHELL_OPEN_EXTERNAL_ERROR__?: Error
          }
        ).__JINGLE_TEST_SHELL_OPEN_EXTERNAL_ERROR__
        if (shellError) {
          throw shellError
        }
        ;(
          globalThis as typeof globalThis & {
            __JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__?: string[]
          }
        ).__JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__?.push(url)
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
  delete (
    globalThis as typeof globalThis & {
      __JINGLE_TEST_NATIVE_EXTENSION_WINDOWS__?: unknown[]
    }
  ).__JINGLE_TEST_NATIVE_EXTENSION_WINDOWS__
  if (originalJingleHome === undefined) {
    delete process.env.JINGLE_HOME
  } else {
    process.env.JINGLE_HOME = originalJingleHome
  }
  if (originalElectronRendererUrl === undefined) {
    delete process.env.ELECTRON_RENDERER_URL
  } else {
    process.env.ELECTRON_RENDERER_URL = originalElectronRendererUrl
  }

  if (jingleHome) {
    await rm(jingleHome, { force: true, recursive: true })
  }
})

test.before(async () => {
  process.env.ELECTRON_RENDERER_URL = originalElectronRendererUrl ?? "http://localhost"
  await execFileAsync(
    process.execPath,
    [
      "packages/extension-cli/src/cli.mjs",
      "build",
      "apple-reminders",
      "figma-files",
      "github",
      "notion"
    ],
    { cwd: process.cwd() }
  )
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-native-extension-preferences-"))
  process.env.JINGLE_HOME = jingleHome
  installElectronSafeStorageMock()
  preferences = await import("../../src/main/preferences")
  connectionResolver = await import("../../src/main/native-extensions/connection-resolver")
  executionContext = await import("../../src/main/native-extensions/execution-context")
  extensionSources = await import("../../src/extensions/sources")
  ;({ DefaultExtensionRuntimeHostCapabilities } =
    await import("../../src/main/services/extension-runtime/host-capabilities"))
})

test("native extension connection secrets are not exposed through public preference reads", () => {
  preferences.setNativeExtensionPreferenceRecord("notion", {
    apiBaseUrl: "https://api.notion.example.test/v1"
  })
  saveNotionConnectionSecret("notion_secret")

  const publicRecord = preferences.getNativeExtensionPreferenceRecord("notion")
  assert.equal(Object.hasOwn(publicRecord, "accessToken"), false)
  assert.equal(publicRecord.apiBaseUrl, "https://api.notion.example.test/v1")

  const resolvedRecord = preferences.getResolvedNativeExtensionPreferenceRecord("notion")
  assert.equal(Object.hasOwn(resolvedRecord, "accessToken"), false)
  assert.equal(resolvedRecord.apiBaseUrl, "https://api.notion.example.test/v1")

  const context = executionContext.resolveNativeExtensionExecutionContext({
    commandName: "search-page",
    extensionName: "notion"
  })
  assert.equal(context.extensionPreferences.accessToken, "notion_secret")
  assert.equal(context.commandPreferences?.accessToken, "notion_secret")
})

test("OAuth command preferences ignore legacy extension secrets without a connection token", () => {
  saveNotionSecret()

  const publicRecord = preferences.getNativeExtensionCommandPreferenceRecord(
    "notion",
    "search-page"
  )
  assert.equal(Object.hasOwn(publicRecord, "accessToken"), false)
  assert.equal(publicRecord.apiBaseUrl, "https://api.notion.example.test/v1")

  const resolvedRecord = preferences.getResolvedNativeExtensionCommandPreferenceRecord(
    "notion",
    "search-page"
  )
  assert.equal(Object.hasOwn(resolvedRecord, "accessToken"), false)
  assert.equal(resolvedRecord.apiBaseUrl, "https://api.notion.example.test/v1")

  const context = executionContext.resolveNativeExtensionExecutionContext({
    commandName: "search-page",
    extensionName: "notion"
  })
  assert.ok(context.connection)
  assert.equal(context.connection.status, "missing")
  assert.equal(Object.hasOwn(context.extensionPreferences, "accessToken"), false)
  assert.equal(Object.hasOwn(context.commandPreferences ?? {}, "accessToken"), false)
})

test("saving OAuth extension preferences removes retired legacy extension secrets", () => {
  saveNotionSecret()

  preferences.setNativeExtensionPreferenceRecord("notion", {
    apiBaseUrl: "https://api.notion.changed.test/v1"
  })

  const resolvedRecord = preferences.getResolvedNativeExtensionPreferenceRecord("notion")
  assert.equal(Object.hasOwn(resolvedRecord, "accessToken"), false)
  assert.equal(resolvedRecord.apiBaseUrl, "https://api.notion.changed.test/v1")

  const context = executionContext.resolveNativeExtensionExecutionContext({
    commandName: "search-page",
    extensionName: "notion"
  })
  assert.ok(context.connection)
  assert.equal(context.connection.status, "missing")
  assert.deepEqual(
    preferences.getNativeExtensionConnectionSecretRecord({
      connectionId: "default",
      extensionName: "notion",
      provider: "notion"
    }),
    {}
  )
  assert.equal(Object.hasOwn(context.extensionPreferences, "accessToken"), false)
  assert.equal(Object.hasOwn(context.commandPreferences ?? {}, "accessToken"), false)
})

test("native extension appPicker preferences normalize to application records", () => {
  const defaultRecord = preferences.getNativeExtensionPreferenceRecord("notion")
  assert.deepEqual(defaultRecord.open_in, { name: "Notion" })

  const stringRecord = preferences.setNativeExtensionPreferenceRecord("notion", {
    open_in: " Notion "
  }).value
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
  }).value
  assert.deepEqual(objectRecord.open_in, {
    bundleId: "notion.id",
    name: "Notion",
    path: "/Applications/Notion.app"
  })
})

test("native extension configuration writes advance only their owned revisions", () => {
  const originalExtensionRecord = preferences.getNativeExtensionPreferenceRecord("notion")
  const beforeExtension = preferences.getNativeExtensionConfigurationSnapshot({
    commandName: "search-page",
    extensionName: "notion"
  })
  const sameExtensionCommit = preferences.setNativeExtensionPreferenceRecord(
    "notion",
    originalExtensionRecord
  )

  assert.deepEqual(sameExtensionCommit.mutation.changed, ["extension-config"])
  assert.equal(
    sameExtensionCommit.snapshot.token.revisions.extensionConfigRevision,
    beforeExtension.token.revisions.extensionConfigRevision + 1
  )
  assert.equal(
    sameExtensionCommit.snapshot.token.revisions.connectionConfigRevision,
    beforeExtension.token.revisions.connectionConfigRevision
  )
  assert.equal(
    sameExtensionCommit.snapshot.token.revisions.credentialRevision,
    beforeExtension.token.revisions.credentialRevision
  )
  assert.equal(sameExtensionCommit.mutation.revisions, sameExtensionCommit.snapshot.token.revisions)

  const publicConfigCommit = preferences.setNativeExtensionPreferenceRecord("notion", {
    ...sameExtensionCommit.value,
    apiBaseUrl: "https://api.notion.revision.test/v1"
  })
  assert.deepEqual(publicConfigCommit.mutation.changed, ["extension-config", "connection-config"])
  assert.equal(
    publicConfigCommit.snapshot.token.revisions.extensionConfigRevision,
    sameExtensionCommit.snapshot.token.revisions.extensionConfigRevision + 1
  )
  assert.equal(
    publicConfigCommit.snapshot.token.revisions.connectionConfigRevision,
    sameExtensionCommit.snapshot.token.revisions.connectionConfigRevision + 1
  )

  const beforeCommand = preferences.getNativeExtensionConfigurationSnapshot({
    commandName: "search-page",
    extensionName: "notion"
  })
  const commandCommit = preferences.setNativeExtensionCommandPreferenceRecord(
    "notion",
    "search-page",
    preferences.getNativeExtensionCommandPreferenceRecord("notion", "search-page")
  )
  assert.deepEqual(commandCommit.mutation.changed, ["command-config"])
  assert.equal(
    commandCommit.snapshot.token.revisions.commandConfigRevision,
    beforeCommand.token.revisions.commandConfigRevision + 1
  )
  assert.equal(
    commandCommit.snapshot.token.revisions.extensionConfigRevision,
    beforeCommand.token.revisions.extensionConfigRevision
  )
  assert.equal(
    commandCommit.snapshot.token.revisions.connectionConfigRevision,
    beforeCommand.token.revisions.connectionConfigRevision
  )

  const currentSecretRecord = preferences.getNativeExtensionConnectionSecretRecord({
    connectionId: "default",
    extensionName: "notion",
    provider: "notion"
  })
  const beforeCredential = preferences.getNativeExtensionConfigurationSnapshot({
    extensionName: "notion"
  })
  const credentialCommit = preferences.setNativeExtensionConnectionSecretRecord({
    connectionId: "default",
    extensionName: "notion",
    mode: "replace",
    nextRecord: currentSecretRecord,
    provider: "notion"
  })
  assert.deepEqual(credentialCommit.mutation.changed, ["credential"])
  assert.equal(
    credentialCommit.snapshot.token.revisions.credentialRevision,
    beforeCredential.token.revisions.credentialRevision + 1
  )
  assert.equal(
    credentialCommit.snapshot.token.revisions.extensionConfigRevision,
    beforeCredential.token.revisions.extensionConfigRevision
  )
  assert.equal(
    credentialCommit.snapshot.token.revisions.connectionConfigRevision,
    beforeCredential.token.revisions.connectionConfigRevision
  )

  preferences.setNativeExtensionPreferenceRecord("notion", originalExtensionRecord)
})

test("native extension configuration tokens are secret-free and connection owners are isolated", () => {
  assert.notEqual(
    preferences.getNativeExtensionConnectionOwnerKey({
      connectionId: "default",
      extensionName: "github",
      provider: "shared-provider"
    }),
    preferences.getNativeExtensionConnectionOwnerKey({
      connectionId: "default",
      extensionName: "notion",
      provider: "shared-provider"
    })
  )

  const commit = preferences.setNativeExtensionConnectionSecretRecord({
    connectionId: "default",
    extensionName: "notion",
    mode: "replace",
    nextRecord: { accessToken: "notion_revision_secret" },
    provider: "notion"
  })
  const context = executionContext.resolveNativeExtensionExecutionContextFromSnapshot(
    commit.snapshot
  )

  assert.equal(context.configurationToken, commit.snapshot.token)
  assert.equal(context.extensionPreferences.accessToken, "notion_revision_secret")
  assert.equal(Object.hasOwn(context.connection.publicConfig, "accessToken"), false)
  assert.equal(JSON.stringify(context.configurationToken).includes("notion_revision_secret"), false)
  assert.equal(Object.isFrozen(commit.snapshot), true)
  assert.equal(Object.isFrozen(commit.snapshot.connectionSecrets), true)
  assert.notEqual(commit.value, commit.snapshot.connectionSecrets)
  commit.value.accessToken = "mutated_return_value"
  assert.equal(commit.snapshot.connectionSecrets.accessToken, "notion_revision_secret")

  const beforeStaleCommit = preferences.getNativeExtensionConfigurationSnapshot({
    extensionName: "notion"
  })
  assert.throws(
    () =>
      preferences.setNativeExtensionConnectionSecretRecord({
        connectionId: "default",
        expectedConnection: {
          ...commit.snapshot.connection,
          connectGuide: "stale connection definition"
        },
        extensionName: "notion",
        mode: "replace",
        nextRecord: { accessToken: "must_not_commit" },
        provider: "notion"
      }),
    /connection changed before credential commit/
  )
  assert.equal(
    preferences.getNativeExtensionConfigurationSnapshot({ extensionName: "notion" }).token.revisions
      .credentialRevision,
    beforeStaleCommit.token.revisions.credentialRevision
  )

  preferences.setNativeExtensionConnectionSecretRecord({
    connectionId: "default",
    extensionName: "notion",
    mode: "replace",
    nextRecord: {},
    provider: "notion"
  })
})

test("native extension revision overflow fails before changing persisted facts", () => {
  const settingsPath = join(jingleHome, "settings.json")
  const originalSettings = readFileSync(settingsPath, "utf8")
  const originalRecord = preferences.getNativeExtensionPreferenceRecord("notion")
  const persisted = JSON.parse(originalSettings) as {
    nativeExtensionPreferences: {
      revisions: {
        extensionConfigs: Record<string, number>
      }
    }
  }
  persisted.nativeExtensionPreferences.revisions.extensionConfigs.notion = Number.MAX_SAFE_INTEGER
  writeFileSync(settingsPath, JSON.stringify(persisted, null, 2))

  try {
    assert.throws(
      () => preferences.setNativeExtensionPreferenceRecord("notion", originalRecord),
      /revision overflow/
    )
    assert.deepEqual(preferences.getNativeExtensionPreferenceRecord("notion"), originalRecord)
    assert.equal(
      preferences.getNativeExtensionConfigurationSnapshot({ extensionName: "notion" }).token
        .revisions.extensionConfigRevision,
      Number.MAX_SAFE_INTEGER
    )
  } finally {
    writeFileSync(settingsPath, originalSettings)
  }
})

test("versioned revision corruption and non-JSON preferences fail closed", () => {
  const settingsPath = join(jingleHome, "settings.json")
  const originalSettings = readFileSync(settingsPath, "utf8")
  const persisted = JSON.parse(originalSettings) as {
    nativeExtensionPreferences: {
      revisions: {
        commandConfigs: unknown
      }
    }
  }
  persisted.nativeExtensionPreferences.revisions.commandConfigs = null
  writeFileSync(settingsPath, JSON.stringify(persisted, null, 2))
  try {
    assert.throws(
      () => preferences.getNativeExtensionConfigurationSnapshot({ extensionName: "notion" }),
      /revision map/
    )
  } finally {
    writeFileSync(settingsPath, originalSettings)
  }

  const before = preferences.getNativeExtensionConfigurationSnapshot({
    extensionName: "notion"
  })
  assert.throws(
    () =>
      preferences.setNativeExtensionPreferenceRecord("notion", {
        ...before.extensionPreferences,
        apiBaseUrl: new Date()
      }),
    /plain JSON object/
  )
  const after = preferences.getNativeExtensionConfigurationSnapshot({
    extensionName: "notion"
  })
  assert.deepEqual(after.token.revisions, before.token.revisions)
  assert.deepEqual(after.extensionPreferences, before.extensionPreferences)
})

test("native extension service publishes the committed mutation before renderer projection", async () => {
  const order: string[] = []
  const mutations: import("../../src/main/preferences").NativeExtensionConfigurationMutation[] = []
  ;(
    globalThis as typeof globalThis & {
      __JINGLE_TEST_NATIVE_EXTENSION_WINDOWS__?: unknown[]
    }
  ).__JINGLE_TEST_NATIVE_EXTENSION_WINDOWS__ = [
    {
      isDestroyed: () => false,
      webContents: {
        send: () => {
          order.push("renderer")
        }
      }
    }
  ]

  try {
    const { NativeExtensionsService } = await import("../../src/main/native-extensions/service")
    const service = new NativeExtensionsService()
    const unsubscribe = service.onConfigurationCommitted((mutation) => {
      order.push("main")
      mutations.push(mutation)
    })
    const before = preferences.getNativeExtensionConfigurationSnapshot({
      extensionName: "notion"
    })
    const record = preferences.getNativeExtensionPreferenceRecord("notion")

    assert.deepEqual(service.setPreferences("notion", record), record)
    unsubscribe()
    assert.deepEqual(order, ["main", "renderer"])
    assert.equal(mutations.length, 1)
    assert.equal(
      mutations[0]?.revisions.extensionConfigRevision,
      before.token.revisions.extensionConfigRevision + 1
    )
  } finally {
    ;(
      globalThis as typeof globalThis & {
        __JINGLE_TEST_NATIVE_EXTENSION_WINDOWS__?: unknown[]
      }
    ).__JINGLE_TEST_NATIVE_EXTENSION_WINDOWS__ = []
  }
})

test("resolved extension preferences do not read legacy command-scoped shared secrets", () => {
  seedLegacyGitHubCommandToken("ghp_legacy_secret")

  const resolvedExtensionRecord = preferences.getResolvedNativeExtensionPreferenceRecord("github")
  assert.equal(Object.hasOwn(resolvedExtensionRecord, "accessToken"), false)
  assert.equal(resolvedExtensionRecord.apiBaseUrl, "https://api.github.com")
})

test("connection resolver ignores command-scoped shared secrets", () => {
  seedLegacyGitHubCommandToken("ghp_legacy_secret")

  const context = executionContext.resolveNativeExtensionExecutionContext({
    commandName: "my-issues",
    extensionName: "github"
  })

  assert.ok(context.connection)
  assert.equal(context.connection.status, "missing")
  assert.deepEqual(context.connection.missingSecretNames, ["accessToken"])
  assert.equal(Object.hasOwn(context.extensionPreferences, "accessToken"), false)
  assert.equal(Object.hasOwn(context.commandPreferences ?? {}, "accessToken"), false)
  assert.deepEqual(context.connection.publicConfig, {
    apiBaseUrl: "https://api.github.com"
  })
})

test("connection resolver ignores legacy extension-scoped shared secrets", () => {
  seedLegacyGitHubTokens({
    apiBaseUrl: "https://github.example.test/api/v3",
    commandAccessToken: "ghp_legacy_secret",
    extensionAccessToken: "ghp_extension_secret"
  })

  const context = executionContext.resolveNativeExtensionExecutionContext({
    commandName: "my-issues",
    extensionName: "github"
  })

  assert.ok(context.connection)
  assert.equal(context.connection.status, "missing")
  assert.deepEqual(context.connection.missingSecretNames, ["accessToken"])
  assert.equal(Object.hasOwn(context.extensionPreferences, "accessToken"), false)
  assert.equal(Object.hasOwn(context.commandPreferences ?? {}, "accessToken"), false)
  assert.deepEqual(context.connection.publicConfig, {
    apiBaseUrl: "https://github.example.test/api/v3"
  })
})

test("connection-scoped secrets connect GitHub without manual token preferences", () => {
  preferences.setNativeExtensionPreferenceRecord("github", {
    apiBaseUrl: "https://github.oauth.test/api/v3",
    defaultSearchTerms: "assignee:@me",
    numberOfResults: "21"
  })
  saveGitHubConnectionSecret("ghp_oauth_secret")

  const publicRecord = preferences.getNativeExtensionPreferenceRecord("github")
  assert.equal(Object.hasOwn(publicRecord, "accessToken"), false)
  assert.deepEqual(
    preferences.getNativeExtensionConnectionSecretRecord({
      connectionId: "default",
      extensionName: "github",
      provider: "github"
    }),
    {
      accessToken: "ghp_oauth_secret"
    }
  )

  const context = executionContext.resolveNativeExtensionExecutionContext({
    commandName: "my-issues",
    extensionName: "github"
  })

  assert.ok(context.connection)
  assert.equal(context.connection.status, "connected")
  assert.deepEqual(context.connection.missingSecretNames, [])
  assert.equal(context.extensionPreferences.accessToken, "ghp_oauth_secret")
  assert.equal(context.commandPreferences?.accessToken, "ghp_oauth_secret")
  assert.deepEqual(context.connection.publicConfig, {
    apiBaseUrl: "https://github.oauth.test/api/v3"
  })
})

test("connection-scoped GitHub secret overrides retired legacy extension token", () => {
  seedLegacyGitHubTokens({
    apiBaseUrl: "https://github.example.test/api/v3",
    commandAccessToken: "ghp_legacy_secret",
    extensionAccessToken: "ghp_extension_secret"
  })
  saveGitHubConnectionSecret("ghp_oauth_secret")

  const context = executionContext.resolveNativeExtensionExecutionContext({
    commandName: "my-issues",
    extensionName: "github"
  })

  assert.ok(context.connection)
  assert.equal(context.connection.status, "connected")
  assert.equal(context.extensionPreferences.accessToken, "ghp_oauth_secret")
  assert.equal(context.commandPreferences?.accessToken, "ghp_oauth_secret")
})

test("platform OAuth callback exchanges handoff code and stores GitHub connection secret", async () => {
  const shellOpenedUrls: string[] = []
  ;(
    globalThis as typeof globalThis & {
      __JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__?: string[]
    }
  ).__JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__ = shellOpenedUrls
  const originalFetch = globalThis.fetch
  const tokenRequests: Array<{ body: Record<string, unknown>; url: string }> = []
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    tokenRequests.push({
      body,
      url: String(input)
    })
    return new Response(JSON.stringify({ access_token: "ghp_callback_secret" }), {
      headers: {
        "content-type": "application/json"
      },
      status: 200
    })
  }) as typeof fetch

  try {
    const { NativeExtensionsService } = await import("../../src/main/native-extensions/service")
    const nativeExtensionsService = new NativeExtensionsService()
    const mutations: import("../../src/main/preferences").NativeExtensionConfigurationMutation[] =
      []
    const unsubscribe = nativeExtensionsService.onConfigurationCommitted((mutation) => {
      mutations.push(mutation)
    })
    const beforeCredential = preferences.getNativeExtensionConfigurationSnapshot({
      extensionName: "github"
    })
    const start = await nativeExtensionsService.startOAuthConnection({ extensionName: "github" })
    const authorizationUrl = new URL(start.authorizationUrl)
    const state = authorizationUrl.searchParams.get("state")

    assert.equal(shellOpenedUrls.length, 1)
    assert.equal(new URL(shellOpenedUrls[0] ?? "").origin, "https://jingle.cool")
    assert.equal(authorizationUrl.pathname, "/oauth/github/start")
    assert.equal(authorizationUrl.searchParams.get("provider"), "github")
    assert.equal(authorizationUrl.searchParams.get("extension_name"), "github")
    assert.equal(authorizationUrl.searchParams.get("connection_id"), "default")
    assertDesktopOAuthAuthorizationContract(authorizationUrl)
    assert.equal(authorizationUrl.searchParams.get("scope"), "repo read:user notifications")
    assert.ok(state)

    const result = await nativeExtensionsService.finishOAuthCallback(
      `jingle://oauth/callback?state=${encodeURIComponent(state)}&provider=github&code=handoff-code`
    )
    unsubscribe()

    assert.equal(result.status, "connected")
    assert.deepEqual(mutations[0]?.changed, ["credential"])
    assert.equal(
      mutations[0]?.revisions.credentialRevision,
      beforeCredential.token.revisions.credentialRevision + 1
    )
    assert.equal(tokenRequests.length, 1)
    assert.equal(tokenRequests[0]?.url, "https://jingle.cool/oauth/github/token")
    assertDesktopOAuthTokenRequestContract(tokenRequests[0]?.body ?? {}, state)
    assert.equal(tokenRequests[0]?.body.code, "handoff-code")
    assert.equal(tokenRequests[0]?.body.connection_id, "default")
    assert.equal(tokenRequests[0]?.body.extension_name, "github")
    assert.equal(tokenRequests[0]?.body.provider, "github")
    assert.deepEqual(
      preferences.getNativeExtensionConnectionSecretRecord({
        connectionId: "default",
        extensionName: "github",
        provider: "github"
      }),
      {
        accessToken: "ghp_callback_secret"
      }
    )
  } finally {
    preferences.setNativeExtensionConnectionSecretRecord({
      connectionId: "default",
      extensionName: "github",
      mode: "replace",
      nextRecord: {},
      provider: "github"
    })
    globalThis.fetch = originalFetch
    ;(
      globalThis as typeof globalThis & {
        __JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__?: string[]
      }
    ).__JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__ = []
  }
})

test("OAuth rejects an empty token without committing a credential revision", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ access_token: "   " }), {
      headers: {
        "content-type": "application/json"
      },
      status: 200
    })) as typeof fetch

  try {
    const { NativeExtensionsService } = await import("../../src/main/native-extensions/service")
    const nativeExtensionsService = new NativeExtensionsService()
    const mutations: import("../../src/main/preferences").NativeExtensionConfigurationMutation[] =
      []
    nativeExtensionsService.onConfigurationCommitted((mutation) => {
      mutations.push(mutation)
    })
    const before = preferences.getNativeExtensionConfigurationSnapshot({
      extensionName: "github"
    })
    const start = await nativeExtensionsService.startOAuthConnection({ extensionName: "github" })
    const state = new URL(start.authorizationUrl).searchParams.get("state")
    assert.ok(state)

    await assert.rejects(
      () =>
        nativeExtensionsService.finishOAuthCallback(
          `jingle://oauth/callback?state=${encodeURIComponent(state)}&provider=github&code=handoff-code`
        ),
      /did not return access_token/
    )

    const after = preferences.getNativeExtensionConfigurationSnapshot({
      extensionName: "github"
    })
    assert.equal(
      after.token.revisions.credentialRevision,
      before.token.revisions.credentialRevision
    )
    assert.deepEqual(mutations, [])
  } finally {
    globalThis.fetch = originalFetch
    ;(
      globalThis as typeof globalThis & {
        __JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__?: string[]
      }
    ).__JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__ = []
  }
})

test("platform OAuth callback exchanges handoff code and stores Notion connection secret", async () => {
  const shellOpenedUrls: string[] = []
  ;(
    globalThis as typeof globalThis & {
      __JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__?: string[]
    }
  ).__JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__ = shellOpenedUrls
  const originalFetch = globalThis.fetch
  const tokenRequests: Array<{ body: Record<string, unknown>; url: string }> = []
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    tokenRequests.push({
      body,
      url: String(input)
    })
    return new Response(JSON.stringify({ access_token: "notion_callback_secret" }), {
      headers: {
        "content-type": "application/json"
      },
      status: 200
    })
  }) as typeof fetch

  try {
    const { NativeExtensionsService } = await import("../../src/main/native-extensions/service")
    const nativeExtensionsService = new NativeExtensionsService()
    const start = await nativeExtensionsService.startOAuthConnection({ extensionName: "notion" })
    const authorizationUrl = new URL(start.authorizationUrl)
    const state = authorizationUrl.searchParams.get("state")

    assert.equal(shellOpenedUrls.length, 1)
    assert.equal(authorizationUrl.pathname, "/oauth/notion/start")
    assert.equal(authorizationUrl.searchParams.get("provider"), "notion")
    assert.equal(authorizationUrl.searchParams.get("extension_name"), "notion")
    assert.equal(authorizationUrl.searchParams.get("connection_id"), "default")
    assertDesktopOAuthAuthorizationContract(authorizationUrl)
    assert.equal(authorizationUrl.searchParams.has("scope"), false)
    assert.ok(state)

    const result = await nativeExtensionsService.finishOAuthCallback(
      `jingle://oauth/callback?state=${encodeURIComponent(state)}&provider=notion&code=handoff-code`
    )

    assert.equal(result.status, "connected")
    assert.equal(tokenRequests.length, 1)
    assert.equal(tokenRequests[0]?.url, "https://jingle.cool/oauth/notion/token")
    assertDesktopOAuthTokenRequestContract(tokenRequests[0]?.body ?? {}, state)
    assert.equal(tokenRequests[0]?.body.code, "handoff-code")
    assert.equal(tokenRequests[0]?.body.extension_name, "notion")
    assert.equal(tokenRequests[0]?.body.provider, "notion")
    assert.deepEqual(
      preferences.getNativeExtensionConnectionSecretRecord({
        connectionId: "default",
        extensionName: "notion",
        provider: "notion"
      }),
      {
        accessToken: "notion_callback_secret"
      }
    )
  } finally {
    preferences.setNativeExtensionConnectionSecretRecord({
      connectionId: "default",
      extensionName: "notion",
      mode: "replace",
      nextRecord: {},
      provider: "notion"
    })
    globalThis.fetch = originalFetch
    ;(
      globalThis as typeof globalThis & {
        __JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__?: string[]
      }
    ).__JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__ = []
  }
})

test("platform OAuth callback exchanges handoff code and stores Figma connection secret", async () => {
  if (!figmaPlatformSupported) {
    return
  }

  const shellOpenedUrls: string[] = []
  ;(
    globalThis as typeof globalThis & {
      __JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__?: string[]
    }
  ).__JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__ = shellOpenedUrls
  const originalFetch = globalThis.fetch
  const tokenRequests: Array<{ body: Record<string, unknown>; url: string }> = []
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    tokenRequests.push({
      body,
      url: String(input)
    })
    return new Response(JSON.stringify({ access_token: "figma_callback_secret" }), {
      headers: {
        "content-type": "application/json"
      },
      status: 200
    })
  }) as typeof fetch

  try {
    const { NativeExtensionsService } = await import("../../src/main/native-extensions/service")
    const nativeExtensionsService = new NativeExtensionsService()
    const start = await nativeExtensionsService.startOAuthConnection({
      extensionName: "figma-files"
    })
    const authorizationUrl = new URL(start.authorizationUrl)
    const state = authorizationUrl.searchParams.get("state")

    assert.equal(shellOpenedUrls.length, 1)
    assert.equal(authorizationUrl.pathname, "/oauth/figma/start")
    assert.equal(authorizationUrl.searchParams.get("provider"), "figma")
    assert.equal(authorizationUrl.searchParams.get("extension_name"), "figma-files")
    assert.equal(authorizationUrl.searchParams.get("connection_id"), "default")
    assertDesktopOAuthAuthorizationContract(authorizationUrl)
    assert.equal(
      authorizationUrl.searchParams.get("scope"),
      "current_user:read projects:read file_metadata:read file_content:read"
    )
    assert.ok(state)

    const result = await nativeExtensionsService.finishOAuthCallback(
      `jingle://oauth/callback?state=${encodeURIComponent(state)}&provider=figma&code=handoff-code`
    )

    assert.equal(result.status, "connected")
    assert.equal(tokenRequests.length, 1)
    assert.equal(tokenRequests[0]?.url, "https://jingle.cool/oauth/figma/token")
    assertDesktopOAuthTokenRequestContract(tokenRequests[0]?.body ?? {}, state)
    assert.equal(tokenRequests[0]?.body.code, "handoff-code")
    assert.equal(tokenRequests[0]?.body.extension_name, "figma-files")
    assert.equal(tokenRequests[0]?.body.provider, "figma")
    assert.deepEqual(
      preferences.getNativeExtensionConnectionSecretRecord({
        connectionId: "default",
        extensionName: "figma-files",
        provider: "figma"
      }),
      {
        accessToken: "figma_callback_secret"
      }
    )
  } finally {
    preferences.setNativeExtensionConnectionSecretRecord({
      connectionId: "default",
      extensionName: "figma-files",
      mode: "replace",
      nextRecord: {},
      provider: "figma"
    })
    globalThis.fetch = originalFetch
    ;(
      globalThis as typeof globalThis & {
        __JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__?: string[]
      }
    ).__JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__ = []
  }
})

test("platform OAuth start clears pending state when browser launch fails", async () => {
  const originalFetch = globalThis.fetch
  const { NativeExtensionsService } = await import("../../src/main/native-extensions/service")
  const nativeExtensionsService = new NativeExtensionsService()
  ;(
    globalThis as typeof globalThis & {
      __JINGLE_TEST_SHELL_OPEN_EXTERNAL_ERROR__?: Error
    }
  ).__JINGLE_TEST_SHELL_OPEN_EXTERNAL_ERROR__ = new Error("browser unavailable")

  try {
    await assert.rejects(
      () => nativeExtensionsService.startOAuthConnection({ extensionName: "github" }),
      /browser unavailable/
    )

    globalThis.fetch = (async () => {
      throw new Error("Token exchange should not run for a failed OAuth start.")
    }) as typeof fetch

    await assert.rejects(
      () =>
        nativeExtensionsService.finishOAuthCallback(
          "jingle://oauth/callback?state=unused-state&provider=github&code=handoff-code"
        ),
      /OAuth callback state is not pending/
    )
  } finally {
    globalThis.fetch = originalFetch
    delete (
      globalThis as typeof globalThis & {
        __JINGLE_TEST_SHELL_OPEN_EXTERNAL_ERROR__?: Error
      }
    ).__JINGLE_TEST_SHELL_OPEN_EXTERNAL_ERROR__
  }
})

test("connection resolver ignores extension-scoped Notion secrets", () => {
  seedLegacyNotionExtensionToken("notion_provider_secret")

  const context = executionContext.resolveNativeExtensionExecutionContext({
    commandName: "search-page",
    extensionName: "notion"
  })

  assert.ok(context.connection)
  assert.equal(context.connection.status, "missing")
  assert.equal(context.connection.provider, "notion")
  assert.deepEqual(context.connection.missingSecretNames, ["accessToken"])
  assert.equal(Object.hasOwn(context.extensionPreferences, "accessToken"), false)
  assert.equal(context.extensionPreferences.apiBaseUrl, "https://api.notion.com/v1")
  assert.equal(Object.hasOwn(context.commandPreferences ?? {}, "accessToken"), false)
  assert.equal(context.commandPreferences?.apiBaseUrl, "https://api.notion.com/v1")
  assert.deepEqual(context.connection.publicConfig, {
    apiBaseUrl: "https://api.notion.com/v1"
  })
})

test("connection-scoped Notion secrets connect AI capabilities", () => {
  preferences.setNativeExtensionPreferenceRecord("notion", {
    apiBaseUrl: "https://api.notion.com/v1"
  })
  saveNotionConnectionSecret("notion_provider_secret")

  const connection = connectionResolver.resolveNativeExtensionConnection({
    extensionName: "notion"
  })

  assert.equal(connection.status, "connected")
  assert.equal(connection.provider, "notion")
  assert.deepEqual(connection.missingSecretNames, [])

  const capability =
    extensionSources.resolveNativeExtensionAiCapabilityForExtensionNameFromManifests(
      "notion",
      [notionManifest],
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
    "queryDataSource",
    "addToPage",
    "createDatabasePage"
  ])
})

test("connection-scoped Notion token feeds runtime host and AI capability through the same connection", async () => {
  preferences.setNativeExtensionPreferenceRecord("notion", {
    apiBaseUrl: "https://api.notion.com/v1"
  })
  saveNotionConnectionSecret("notion_settings_token")

  const { NativeExtensionsService } = await import("../../src/main/native-extensions/service")
  const nativeExtensionsService = new NativeExtensionsService()

  assert.deepEqual(nativeExtensionsService.getPreferences("notion"), {
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

  const capability =
    extensionSources.resolveNativeExtensionAiCapabilityForExtensionNameFromManifests(
      "notion",
      [notionManifest],
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

test("connection-scoped Figma token feeds execution context without manual token preferences", () => {
  if (!figmaPlatformSupported) {
    return
  }

  preferences.setNativeExtensionPreferenceRecord("figma-files", {
    TEAM_ID: "123",
    open_in: {
      name: "Figma"
    }
  })
  saveFigmaConnectionSecret("figma_oauth_secret")

  const publicRecord = preferences.getNativeExtensionPreferenceRecord("figma-files")
  assert.equal(Object.hasOwn(publicRecord, "accessToken"), false)

  const context = executionContext.resolveNativeExtensionExecutionContext({
    commandName: "index",
    extensionName: "figma-files"
  })

  assert.ok(context.connection)
  assert.equal(context.connection.status, "connected")
  assert.equal(context.connection.provider, "figma")
  assert.deepEqual(context.connection.publicConfig, {
    TEAM_ID: "123",
    open_in: {
      name: "Figma"
    }
  })
  assert.equal(context.extensionPreferences.accessToken, "figma_oauth_secret")
  assert.equal(context.commandPreferences?.accessToken, "figma_oauth_secret")
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

test("extension runtime host isolates legacy conflicts without blocking typed storage", () => {
  const storageStore = new Store<{ values: Record<string, unknown> }>({
    cwd: jingleHome,
    defaults: { values: {} },
    name: "extension-runtime-storage"
  })
  const host = createRuntimeStorageHost()
  const legacyDiscardKey = JSON.stringify(["notion", "discardOnly"])
  const legacyRecentPageKey = JSON.stringify(["notion", "recentPage"])
  const legacyFilterKey = JSON.stringify(["notion", "filter"])
  const context = createRuntimeStorageContext(0)

  storageStore.set("values", {
    [legacyDiscardKey]: "legacy-discard",
    [legacyFilterKey]: "legacy-filter",
    [legacyRecentPageKey]: "page-1"
  })
  assert.throws(
    () => host.getStorageValue({ context, key: "recentPage", scope: "extension" }),
    (error) => {
      assert.equal((error as { code?: unknown }).code, "storage_legacy_unowned")
      assert.deepEqual((error as { details?: unknown }).details, {
        keys: ["recentPage"],
        kind: "storage-legacy-unowned",
        scope: "extension"
      })
      assert.match((error as Error).message, /key "recentPage"/)
      assert.match((error as Error).message, /LocalStorage\.setItem\("recentPage", value\)/)
      assert.match((error as Error).message, /LocalStorage\.removeItem\("recentPage"\)/)
      return true
    }
  )
  assert.deepEqual(storageStore.get("values"), {
    [JSON.stringify(["jingle:legacy-unowned:v1", "notion", "extension", "discardOnly"])]:
      "legacy-discard",
    [JSON.stringify(["jingle:legacy-unowned:v1", "notion", "extension", "filter"])]:
      "legacy-filter",
    [JSON.stringify(["jingle:legacy-unowned:v1", "notion", "extension", "recentPage"])]: "page-1"
  })

  host.removeStorageValue({ context, key: "discardOnly", scope: "extension" })
  assert.equal(host.getStorageValue({ context, key: "discardOnly", scope: "extension" }), undefined)
  assert.equal(
    Object.hasOwn(
      storageStore.get("values"),
      JSON.stringify(["jingle:legacy-unowned:v1", "notion", "extension", "discardOnly"])
    ),
    false
  )
  assert.throws(
    () => host.getStorageValue({ context, key: "recentPage", scope: "extension" }),
    /key "recentPage"/
  )

  host.setStorageValue({ context, key: "draft", scope: "extension", value: "new-draft" })
  assert.equal(host.getStorageValue({ context, key: "draft", scope: "extension" }), "new-draft")
  host.removeStorageValue({ context, key: "draft", scope: "extension" })
  assert.equal(host.getStorageValue({ context, key: "draft", scope: "extension" }), undefined)

  host.setStorageValue({ context, key: "recentPage", scope: "extension", value: "current-page" })
  assert.equal(
    host.getStorageValue({ context, key: "recentPage", scope: "extension" }),
    "current-page"
  )
  assert.throws(
    () => host.listStorageValues({ context, scope: "extension" }),
    (error) => {
      assert.equal((error as { code?: unknown }).code, "storage_legacy_unowned")
      assert.deepEqual((error as { details?: unknown }).details, {
        keys: ["filter"],
        kind: "storage-legacy-unowned",
        scope: "extension"
      })
      assert.doesNotMatch((error as Error).message, /"recentPage"/)
      assert.match((error as Error).message, /"filter"/)
      return true
    }
  )

  host.setStorageValue({ context, key: "filter", scope: "extension", value: "current-filter" })
  assert.deepEqual(host.listStorageValues({ context, scope: "extension" }), {
    filter: "current-filter",
    recentPage: "current-page"
  })
  assert.equal(
    storageStore.get("values")[
      JSON.stringify(["jingle:legacy-unowned:v1", "notion", "extension", "recentPage"])
    ],
    "page-1"
  )

  host.removeStorageValue({ context, key: "recentPage", scope: "extension" })
  assert.equal(host.getStorageValue({ context, key: "recentPage", scope: "extension" }), undefined)
  assert.deepEqual(host.listStorageValues({ context, scope: "extension" }), {
    filter: "current-filter"
  })

  const changedCredentialContext = createRuntimeStorageContext(2)
  assert.throws(
    () =>
      host.getStorageValue({
        context: changedCredentialContext,
        key: "filter",
        scope: "extension"
      }),
    /connection "default"/
  )
  host.setStorageValue({
    context: changedCredentialContext,
    key: "filter",
    scope: "extension",
    value: "owner-two"
  })
  assert.equal(
    host.getStorageValue({
      context: changedCredentialContext,
      key: "filter",
      scope: "extension"
    }),
    "owner-two"
  )
  assert.equal(
    host.getStorageValue({ context, key: "filter", scope: "extension" }),
    "current-filter"
  )

  host.clearStorageValues({ context: changedCredentialContext, scope: "extension" })
  assert.equal(
    host.getStorageValue({ context, key: "filter", scope: "extension" }),
    "current-filter"
  )
  host.clearStorageValues({ context, scope: "extension" })
  assert.deepEqual(storageStore.get("values"), {})
  assert.deepEqual(host.listStorageValues({ context, scope: "extension" }), {})
})

test("extension runtime host exposes command storage recovery through its typed owner", () => {
  const storageStore = new Store<{ values: Record<string, unknown> }>({
    cwd: jingleHome,
    defaults: { values: {} },
    name: "extension-runtime-storage"
  })
  const host = createRuntimeStorageHost()
  const context = createRuntimeStorageContext(0)
  const logicalKey = "form-field:title"

  storageStore.set("values", {
    [JSON.stringify(["notion", "search-page", logicalKey])]: "legacy-title"
  })

  assert.throws(
    () => host.getStorageValue({ context, key: logicalKey, scope: "command" }),
    (error) => {
      assert.equal((error as { code?: unknown }).code, "storage_legacy_unowned")
      assert.deepEqual((error as { details?: unknown }).details, {
        keys: [logicalKey],
        kind: "storage-legacy-unowned",
        scope: "command"
      })
      assert.match((error as Error).message, /command component or hook/)
      assert.doesNotMatch((error as Error).message, /LocalStorage/)
      return true
    }
  )

  host.setStorageValue({ context, key: logicalKey, scope: "command", value: "current-title" })
  assert.equal(
    host.getStorageValue({ context, key: logicalKey, scope: "command" }),
    "current-title"
  )
  assert.equal(
    storageStore.get("values")[
      JSON.stringify(["jingle:legacy-unowned:v1", "notion", "command", "search-page", logicalKey])
    ],
    "legacy-title"
  )
})

function createRuntimeStorageContext(credentialGeneration: number) {
  return {
    commandName: "search-page",
    commandPreferences: {},
    dataIdentity: {
      cache: {
        kind: "unavailable" as const,
        reason: "artifact-revision-unavailable" as const
      },
      kind: "available" as const,
      localStorage: {
        connectionId: "default",
        credentialGeneration
      }
    },
    extensionName: "notion",
    extensionPreferences: {},
    initialAction: "open" as const,
    locale: "zh-CN" as const,
    mode: "view" as const,
    seedQuery: ""
  }
}

function createRuntimeStorageHost() {
  const nativeExtensionsService = {
    getManifest: () => ({ commands: [], name: "notion" }),
    getResolvedCommandPreferences: () => ({}),
    getResolvedPreferences: () => ({}),
    invoke: async () => null
  } as unknown as ConstructorParameters<typeof DefaultExtensionRuntimeHostCapabilities>[0]
  return new DefaultExtensionRuntimeHostCapabilities(
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
}

test("extension runtime shell host only opens declared desktop URL schemes", async () => {
  const publicOpenedUrls: string[] = []
  const shellOpenedUrls: string[] = []
  ;(
    globalThis as typeof globalThis & {
      __JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__?: string[]
    }
  ).__JINGLE_TEST_SHELL_OPEN_EXTERNAL_URLS__ = shellOpenedUrls
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
      dataIdentity: { kind: "unavailable" },
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
          dataIdentity: { kind: "unavailable" },
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
      dataIdentity: { kind: "unavailable" },
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
      dataIdentity: { kind: "unavailable" },
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
      dataIdentity: { kind: "unavailable" },
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
