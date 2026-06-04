import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const originalOpenworkHome = process.env.OPENWORK_HOME
const originalFetch = globalThis.fetch
let openworkHome = ""

test.before(async () => {
  openworkHome = await mkdtemp(join(tmpdir(), "openwork-model-provider-credentials-"))
  process.env.OPENWORK_HOME = openworkHome
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
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }] }), {
      status: 200,
      statusText: "OK"
    })

  await setProviderCredentialsForUI("deepseek", { apiKey: "sk-local-user-key" })

  assert.deepEqual(getProviderCredentialsForUI("deepseek"), {
    apiKey: "sk-local-user-key"
  })

  const paths = getModelProviderPaths()
  const authJson = JSON.parse(await readFile(paths.authPath, "utf8")) as {
    providers?: Record<string, Record<string, { value: string }>>
  }

  assert.deepEqual(authJson.providers?.deepseek?.apiKey, {
    value: "sk-local-user-key"
  })
  assert.equal((await stat(paths.authPath)).mode & 0o777, 0o600)
  assert.equal(paths.configPath, join(openworkHome, "jingle-config", "config.yaml"))
  assert.equal(paths.authPath, join(openworkHome, "jingle-config", "auth.json"))
  assert.equal(paths.customProvidersDir, join(openworkHome, "jingle-config", "custom_providers"))
  assert.equal(
    paths.modelRegistryPath,
    join(openworkHome, "jingle-data", "models", "registry.json")
  )
  assert.match(await readFile(paths.configPath, "utf8"), /active_provider: deepseek/)
})

test("retired safeStorage credential entries are ignored without Electron decryption", async () => {
  const {
    deleteProviderCredentialsForUI,
    getProviderCredentialsForUI,
    getModelProviderStateForUI
  } =
    await import("../../src/main/model-provider/service")
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")

  const paths = getModelProviderPaths()
  await writeFile(
    paths.authPath,
    JSON.stringify(
      {
        providers: {
          anthropic: {
            apiKey: Buffer.from("encrypted:sk-legacy-key", "utf8").toString("base64")
          }
        }
      },
      null,
      2
    ),
    "utf8"
  )

  assert.equal(getProviderCredentialsForUI("anthropic"), null)
  assert.equal(
    getModelProviderStateForUI().providers.find((provider) => provider.id === "anthropic")
      ?.customConfiguration.status,
    "no-configure"
  )

  deleteProviderCredentialsForUI("anthropic")

  const authJson = JSON.parse(await readFile(paths.authPath, "utf8")) as {
    providers?: Record<string, unknown>
  }
  assert.equal(authJson.providers?.anthropic, undefined)
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

test("custom providers are persisted under the Jingle custom provider directory", async () => {
  const { getModelProviderStateForUI, setDefaultModelForUI, upsertCustomProviderForUI } =
    await import("../../src/main/model-provider/service")
  const { getCustomProviderConfig } = await import("../../src/main/model-provider/custom-providers")
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")
  const { resolveModelRuntimeConfig } = await import("../../src/main/model-provider/resolver")

  upsertCustomProviderForUI({
    apiKey: "sk-custom-key",
    baseUrl: "https://api.example.test/v1",
    displayName: "xiaoxiong",
    engine: "openai",
    models: ["gpt-5.5"],
    requiresAuth: true,
    supportsStreaming: true
  })

  const paths = getModelProviderPaths()
  const customProviderPath = join(paths.customProvidersDir, "custom_xiaoxiong.json")
  const customProviderConfig = getCustomProviderConfig("custom_xiaoxiong")

  assert.equal(customProviderConfig?.base_url, "https://api.example.test/v1")
  assert.match(await readFile(customProviderPath, "utf8"), /"display_name": "xiaoxiong"/)
  assert.ok(
    getModelProviderStateForUI().providers.some((provider) => provider.id === "custom_xiaoxiong")
  )

  await setDefaultModelForUI("llm", "custom_xiaoxiong:gpt-5.5")
  assert.equal(resolveModelRuntimeConfig().modelId, "custom_xiaoxiong:gpt-5.5")
})

test("custom providers cannot overwrite declarative provider ids", async () => {
  const { upsertCustomProviderForUI } = await import("../../src/main/model-provider/service")

  assert.throws(
    () =>
      upsertCustomProviderForUI({
        apiKey: "sk-custom-key",
        baseUrl: "https://api.example.test/v1",
        displayName: "custom_deepseek",
        engine: "openai",
        models: ["deepseek-chat"],
        requiresAuth: true,
        supportsStreaming: true
      }),
    /Custom provider id conflicts with a built-in provider: custom_deepseek/
  )
})

test("stored custom providers cannot shadow reserved provider ids", async () => {
  const { listCustomProviderConfigs } =
    await import("../../src/main/model-provider/custom-providers")
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")

  const paths = getModelProviderPaths()
  await mkdir(paths.customProvidersDir, { recursive: true })
  await writeFile(
    join(paths.customProvidersDir, "openai.json"),
    JSON.stringify(
      {
        base_url: "https://api.example.test/v1",
        display_name: "Fake OpenAI",
        engine: "openai",
        models: [{ name: "fake-model" }],
        name: "openai",
        requires_auth: true
      },
      null,
      2
    ),
    "utf8"
  )

  try {
    assert.throws(
      () => listCustomProviderConfigs(),
      /Custom provider id conflicts with a built-in provider: openai/
    )
  } finally {
    await rm(join(paths.customProvidersDir, "openai.json"), { force: true })
  }
})

test("stored custom provider filenames must match provider ids", async () => {
  const { listCustomProviderConfigs } =
    await import("../../src/main/model-provider/custom-providers")
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")

  const paths = getModelProviderPaths()
  await mkdir(paths.customProvidersDir, { recursive: true })
  await writeFile(
    join(paths.customProvidersDir, "custom_mismatch.json"),
    JSON.stringify(
      {
        base_url: "https://api.example.test/v1",
        display_name: "Mismatch",
        engine: "openai",
        models: [{ name: "gpt-test" }],
        name: "custom_actual",
        requires_auth: true
      },
      null,
      2
    ),
    "utf8"
  )

  try {
    assert.throws(
      () => listCustomProviderConfigs(),
      /Custom provider file name does not match provider id: custom_mismatch\.json -> custom_actual/
    )
  } finally {
    await rm(join(paths.customProvidersDir, "custom_mismatch.json"), { force: true })
  }
})

test("stored custom providers reject Codex CLI as a custom engine", async () => {
  const { listCustomProviderConfigs } =
    await import("../../src/main/model-provider/custom-providers")
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")

  const paths = getModelProviderPaths()
  await mkdir(paths.customProvidersDir, { recursive: true })
  await writeFile(
    join(paths.customProvidersDir, "custom_bad_codex.json"),
    JSON.stringify(
      {
        base_url: "https://api.example.test/v1",
        display_name: "Bad Codex",
        engine: "codex",
        models: [{ name: "gpt-test" }],
        name: "custom_bad_codex",
        requires_auth: true
      },
      null,
      2
    ),
    "utf8"
  )

  try {
    assert.throws(
      () => listCustomProviderConfigs(),
      /Custom provider engine is not supported: codex/
    )
  } finally {
    await rm(join(paths.customProvidersDir, "custom_bad_codex.json"), { force: true })
  }
})

test("default model thinking effort is persisted in Jingle config", async () => {
  const { setDefaultModelForUI } = await import("../../src/main/model-provider/service")
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")
  const { resolveModelRuntimeConfig } = await import("../../src/main/model-provider/resolver")

  await setDefaultModelForUI("llm", "custom_xiaoxiong:gpt-5.5", {
    thinkingEffort: "high"
  })

  const paths = getModelProviderPaths()
  const configText = await readFile(paths.configPath, "utf8")
  assert.match(configText, /thinking_effort: high/)
  assert.equal(resolveModelRuntimeConfig().thinkingEffort, "high")
})

test("custom provider edits keep the original provider id", async () => {
  const { setDefaultModelForUI, upsertCustomProviderForUI } =
    await import("../../src/main/model-provider/service")
  const { getCustomProviderConfig } = await import("../../src/main/model-provider/custom-providers")
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")
  const { resolveModelRuntimeConfig } = await import("../../src/main/model-provider/resolver")

  const providerId = upsertCustomProviderForUI({
    basePath: "/compat",
    baseUrl: "https://api2.example.test",
    description: "Edited xiaoxiong provider.",
    displayName: "xiaoxiong pro",
    engine: "openai",
    headers: {
      "X-Jingle": "yes"
    },
    models: ["gpt-6"],
    providerId: "custom_xiaoxiong",
    requiresAuth: true,
    supportsStreaming: false
  })

  const paths = getModelProviderPaths()
  const customProviderPath = join(paths.customProvidersDir, "custom_xiaoxiong.json")
  const customProviderConfig = getCustomProviderConfig("custom_xiaoxiong")

  assert.equal(providerId, "custom_xiaoxiong")
  assert.equal(customProviderConfig?.display_name, "xiaoxiong pro")
  assert.equal(customProviderConfig?.base_url, "https://api2.example.test")
  assert.equal(customProviderConfig?.base_path, "/compat")
  assert.equal(customProviderConfig?.supports_streaming, false)
  assert.deepEqual(customProviderConfig?.headers, { "X-Jingle": "yes" })
  assert.deepEqual(
    customProviderConfig?.models.map((model) => model.name),
    ["gpt-6"]
  )
  assert.match(await readFile(customProviderPath, "utf8"), /"display_name": "xiaoxiong pro"/)

  await setDefaultModelForUI("llm", "custom_xiaoxiong:gpt-6")
  assert.equal(resolveModelRuntimeConfig().modelId, "custom_xiaoxiong:gpt-6")
})

test("unlisted custom provider models require an explicit user choice", async () => {
  const { setDefaultModelForUI } = await import("../../src/main/model-provider/service")
  const { resolveModelRuntimeConfig } = await import("../../src/main/model-provider/resolver")

  await assert.rejects(
    setDefaultModelForUI("llm", "custom_xiaoxiong:gpt-7"),
    /Model is not available for provider custom_xiaoxiong: gpt-7/
  )

  await setDefaultModelForUI("llm", "custom_xiaoxiong:gpt-7", {
    allowUnlisted: true,
    thinkingEffort: "max"
  })

  const runtimeConfig = resolveModelRuntimeConfig()
  assert.equal(runtimeConfig.modelId, "custom_xiaoxiong:gpt-7")
  assert.equal(runtimeConfig.thinkingEffort, "max")
})

test("registry models are listed without enabling unsupported local inference", async () => {
  const { getModelProviderStateForUI, setDefaultModelForUI } =
    await import("../../src/main/model-provider/service")
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")

  const paths = getModelProviderPaths()
  await mkdir(join(paths.modelRegistryPath, ".."), { recursive: true })
  await writeFile(
    paths.modelRegistryPath,
    JSON.stringify({ models: [{ id: "local/test-model", reasoning: true }] }),
    "utf8"
  )

  const state = getModelProviderStateForUI()
  const localProvider = state.providers.find((provider) => provider.id === "local")

  assert.equal(localProvider?.source, "registry")
  assert.equal(localProvider.customConfiguration.status, "no-configure")
  assert.match(localProvider.customConfiguration.message ?? "", /local inference runtime/)

  await assert.rejects(
    setDefaultModelForUI("llm", "local:local/test-model"),
    /Model provider credentials are not configured: local/
  )
})
