import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const requireFromTest = createRequire(import.meta.url)
const originalOpenworkHome = process.env.OPENWORK_HOME
const originalFetch = globalThis.fetch
let openworkHome = ""

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

test.before(async () => {
  openworkHome = await mkdtemp(join(tmpdir(), "openwork-model-provider-credentials-"))
  process.env.OPENWORK_HOME = openworkHome
  installElectronSafeStorageMock()
})

test.after(async () => {
  globalThis.fetch = originalFetch

  if (originalOpenworkHome === undefined) {
    delete process.env.OPENWORK_HOME
  } else {
    process.env.OPENWORK_HOME = originalOpenworkHome
  }

  if (openworkHome) {
    await rm(openworkHome, { force: true, recursive: true })
  }
})

test("model provider credentials can be read back for settings edits", async () => {
  const { getProviderCredentialsForUI, setProviderCredentialsForUI } =
    await import("../../src/main/model-provider/service")

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }] }), {
      status: 200,
      statusText: "OK"
    })

  await setProviderCredentialsForUI("deepseek", { apiKey: "sk-local-user-key" })

  assert.deepEqual(getProviderCredentialsForUI("deepseek"), {
    apiKey: "sk-local-user-key"
  })
})

test("fast model preference resolves to a configured low-latency model", async () => {
  const { setProviderCredentialsForUI } = await import("../../src/main/model-provider/service")
  const { resolveModelRuntimeConfig } = await import("../../src/main/model-provider/resolver")

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: "deepseek-v4-flash" }] }), {
      status: 200,
      statusText: "OK"
    })

  await setProviderCredentialsForUI("deepseek", { apiKey: "sk-fast-model-key" })

  assert.equal(
    resolveModelRuntimeConfig({ modelPreference: "fast" }).modelId,
    "deepseek:deepseek-v4-flash"
  )
})
