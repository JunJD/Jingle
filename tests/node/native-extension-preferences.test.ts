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
        },
        providerSecrets: {
          providers: {}
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
    safeStorage: {
      decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
      isEncryptionAvailable: () => true
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
