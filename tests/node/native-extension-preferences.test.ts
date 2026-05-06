import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const requireFromTest = createRequire(import.meta.url)
const originalOpenworkHome = process.env.OPENWORK_HOME
let openworkHome = ""
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
    { openWindow: () => undefined } as ConstructorParameters<
      typeof DefaultExtensionRuntimeHostCapabilities
    >[2],
    { handleNavigationRequest: async () => undefined } as unknown as ConstructorParameters<
      typeof DefaultExtensionRuntimeHostCapabilities
    >[3]
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
