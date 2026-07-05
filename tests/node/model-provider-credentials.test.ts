import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const originalJingleHome = process.env.JINGLE_HOME
const originalFetch = globalThis.fetch
let jingleHome = ""

test.before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-model-provider-credentials-"))
  process.env.JINGLE_HOME = jingleHome
})

test.after(async () => {
  globalThis.fetch = originalFetch

  if (originalJingleHome === undefined) {
    delete process.env.JINGLE_HOME
  } else {
    process.env.JINGLE_HOME = originalJingleHome
  }

  if (jingleHome) {
    await rm(jingleHome, { force: true, recursive: true })
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
  assert.equal(paths.configPath, join(jingleHome, "jingle-config", "config.yaml"))
  assert.equal(paths.authPath, join(jingleHome, "jingle-config", "auth.json"))
  assert.equal(paths.customProvidersDir, join(jingleHome, "jingle-config", "custom_providers"))
  assert.equal(
    paths.modelRegistryPath,
    join(jingleHome, "jingle-data", "models", "registry.json")
  )
  assert.match(await readFile(paths.configPath, "utf8"), /active_provider: deepseek/)
})

test("retired safeStorage credential entries are ignored without Electron decryption", async () => {
  const {
    deleteProviderCredentialsForUI,
    getProviderCredentialsForUI,
    getModelProviderStateForUI
  } = await import("../../src/main/model-provider/service")
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

test("fast model preference resolves through the active provider declaration", async () => {
  const { setDefaultModelForUI, setProviderCredentialsForUI } =
    await import("../../src/main/model-provider/service")
  const { resolveModelRuntimeConfig } = await import("../../src/main/model-provider/resolver")

  globalThis.fetch = async (input) => {
    const url = String(input)
    const data = url.includes("api.openai.com")
      ? [{ id: "gpt-4o-mini" }]
      : [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }]

    return new Response(JSON.stringify({ data }), {
      status: 200,
      statusText: "OK"
    })
  }

  await setProviderCredentialsForUI("openai", { apiKey: "sk-openai-fast-candidate" })
  await setProviderCredentialsForUI("deepseek", { apiKey: "sk-fast-model-key" })
  await setDefaultModelForUI("llm", "deepseek:deepseek-v4-pro", {
    thinkingEffort: "high"
  })

  const runtimeConfig = resolveModelRuntimeConfig({
    modelPreference: "fast",
    thinkingEffort: "off"
  })
  assert.equal(runtimeConfig.modelId, "deepseek:deepseek-v4-flash")
  assert.equal(runtimeConfig.modelName, "deepseek-v4-flash")
  assert.equal(runtimeConfig.thinkingEffort, "off")
})

test("chat model instances can override output budget for derived projections", async () => {
  const { setProviderCredentialsForUI } = await import("../../src/main/model-provider/service")
  const { setActiveModelProvider } = await import("../../src/main/model-provider/settings")
  const { getChatModelInstance } = await import("../../src/main/llm/get-chat-model")

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }] }),
      {
        status: 200,
        statusText: "OK"
      }
    )

  await setProviderCredentialsForUI("deepseek", { apiKey: "sk-output-budget-key" })
  setActiveModelProvider("deepseek", "deepseek-v4-pro", { thinkingEffort: "off" })

  const model = getChatModelInstance({
    maxOutputTokens: 1024,
    modelPreference: "fast",
    temperature: 0,
    thinkingEffort: "off"
  })
  const params = "invocationParams" in model ? model.invocationParams({}) : null

  assert.equal(params?.model, "deepseek-v4-flash")
  assert.equal(params?.max_tokens, 1024)
  assert.deepEqual(params?.thinking, { type: "disabled" })
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
    displayName: "test provider",
    engine: "openai",
    models: ["gpt-5.5"],
    requiresAuth: true,
    supportsStreaming: true
  })

  const paths = getModelProviderPaths()
  const customProviderPath = join(paths.customProvidersDir, "custom_test_provider.json")
  const customProviderConfig = getCustomProviderConfig("custom_test_provider")

  assert.equal(customProviderConfig?.base_url, "https://api.example.test/v1")
  assert.match(await readFile(customProviderPath, "utf8"), /"display_name": "test provider"/)
  assert.ok(
    getModelProviderStateForUI().providers.some(
      (provider) => provider.id === "custom_test_provider"
    )
  )

  await setDefaultModelForUI("llm", "custom_test_provider:gpt-5.5")
  assert.equal(resolveModelRuntimeConfig().modelId, "custom_test_provider:gpt-5.5")
})

test("custom provider fast_model is used for fast model preference", async () => {
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")
  const { resolveModelRuntimeConfig } = await import("../../src/main/model-provider/resolver")
  const { setDefaultModelForUI, upsertCustomProviderForUI } =
    await import("../../src/main/model-provider/service")

  upsertCustomProviderForUI({
    apiKey: "sk-fast-provider-key",
    baseUrl: "https://fast.example.test/v1",
    displayName: "fastlane",
    engine: "openai",
    models: ["main-model"],
    requiresAuth: true,
    supportsStreaming: true
  })

  const paths = getModelProviderPaths()
  const customProviderPath = join(paths.customProvidersDir, "custom_fastlane.json")
  const customProviderConfig = JSON.parse(await readFile(customProviderPath, "utf8")) as Record<
    string,
    unknown
  >
  await writeFile(
    customProviderPath,
    `${JSON.stringify({ ...customProviderConfig, fast_model: "fast-model" }, null, 2)}\n`,
    "utf8"
  )

  await setDefaultModelForUI("llm", "custom_fastlane:main-model")

  assert.equal(
    resolveModelRuntimeConfig({ modelPreference: "fast" }).modelId,
    "custom_fastlane:fast-model"
  )
  assert.equal(resolveModelRuntimeConfig({ modelPreference: "fast" }).modelName, "fast-model")
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
  const { setDefaultModelForUI, upsertCustomProviderForUI } =
    await import("../../src/main/model-provider/service")
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")

  upsertCustomProviderForUI({
    apiKey: "sk-thinking-provider-key",
    baseUrl: "https://thinking.example.test/v1",
    displayName: "thinking provider",
    engine: "openai",
    models: ["gpt-thinking"],
    requiresAuth: true,
    supportsStreaming: true
  })

  await setDefaultModelForUI("llm", "custom_thinking_provider:gpt-thinking", {
    thinkingEffort: "high"
  })

  const paths = getModelProviderPaths()
  const configText = await readFile(paths.configPath, "utf8")
  assert.match(configText, /custom_thinking_provider:\n(?: {4}.+\n)* {4}thinking_effort: high/)
})

test("default model config can be read when multiple providers are stored", async () => {
  const { getModelProviderDefaultModel, setActiveModelProvider } =
    await import("../../src/main/model-provider/settings")
  const { upsertCustomProviderForUI } = await import("../../src/main/model-provider/service")

  upsertCustomProviderForUI({
    apiKey: "sk-alpha-provider-key",
    baseUrl: "https://alpha-provider.example.test/v1",
    displayName: "alpha provider",
    engine: "openai",
    models: ["alpha-model"],
    requiresAuth: true,
    supportsStreaming: true
  })
  upsertCustomProviderForUI({
    apiKey: "sk-zeta-provider-key",
    baseUrl: "https://zeta-provider.example.test/v1",
    displayName: "zeta provider",
    engine: "openai",
    models: ["zeta-model"],
    requiresAuth: true,
    supportsStreaming: true
  })

  setActiveModelProvider("custom_zeta_provider", "zeta-model")

  assert.equal(getModelProviderDefaultModel("llm"), "custom_zeta_provider:zeta-model")
})

test("custom provider edits keep the original provider id", async () => {
  const { setDefaultModelForUI, upsertCustomProviderForUI } =
    await import("../../src/main/model-provider/service")
  const { getCustomProviderConfig } = await import("../../src/main/model-provider/custom-providers")
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")
  const { resolveModelRuntimeConfig } = await import("../../src/main/model-provider/resolver")

  upsertCustomProviderForUI({
    apiKey: "sk-editable-provider-key",
    baseUrl: "https://editable.example.test/v1",
    displayName: "editable provider",
    engine: "openai",
    models: ["gpt-5.5"],
    requiresAuth: true,
    supportsStreaming: true
  })

  const providerId = upsertCustomProviderForUI({
    basePath: "/compat",
    baseUrl: "https://api2.example.test",
    description: "Edited test provider.",
    displayName: "test provider pro",
    engine: "openai",
    headers: {
      "X-Jingle": "yes"
    },
    models: ["gpt-6"],
    providerId: "custom_editable_provider",
    requiresAuth: true,
    supportsStreaming: false
  })

  const paths = getModelProviderPaths()
  const customProviderPath = join(paths.customProvidersDir, "custom_editable_provider.json")
  const customProviderConfig = getCustomProviderConfig("custom_editable_provider")

  assert.equal(providerId, "custom_editable_provider")
  assert.equal(customProviderConfig?.display_name, "test provider pro")
  assert.equal(customProviderConfig?.base_url, "https://api2.example.test")
  assert.equal(customProviderConfig?.base_path, "/compat")
  assert.equal(customProviderConfig?.supports_streaming, false)
  assert.deepEqual(customProviderConfig?.headers, { "X-Jingle": "yes" })
  assert.deepEqual(
    customProviderConfig?.models.map((model) => model.name),
    ["gpt-6"]
  )
  assert.match(await readFile(customProviderPath, "utf8"), /"display_name": "test provider pro"/)

  await setDefaultModelForUI("llm", "custom_editable_provider:gpt-6")
  assert.equal(
    resolveModelRuntimeConfig({ modelId: "custom_editable_provider:gpt-6" }).modelId,
    "custom_editable_provider:gpt-6"
  )
})

test("unlisted custom provider models require an explicit user choice", async () => {
  const { setDefaultModelForUI, upsertCustomProviderForUI } =
    await import("../../src/main/model-provider/service")
  const { getModelProviderPaths } = await import("../../src/main/model-provider/paths")
  const { resolveModelRuntimeConfig } = await import("../../src/main/model-provider/resolver")

  upsertCustomProviderForUI({
    apiKey: "sk-unlisted-provider-key",
    baseUrl: "https://unlisted.example.test/v1",
    displayName: "unlisted provider",
    engine: "openai",
    models: ["gpt-listed"],
    requiresAuth: true,
    supportsStreaming: true
  })

  await assert.rejects(
    setDefaultModelForUI("llm", "custom_unlisted_provider:gpt-7"),
    /Model is not available for provider custom_unlisted_provider: gpt-7/
  )

  await setDefaultModelForUI("llm", "custom_unlisted_provider:gpt-7", {
    allowUnlisted: true,
    thinkingEffort: "max"
  })

  const runtimeConfig = resolveModelRuntimeConfig({ modelId: "custom_unlisted_provider:gpt-7" })
  assert.equal(runtimeConfig.modelId, "custom_unlisted_provider:gpt-7")
  const paths = getModelProviderPaths()
  assert.match(
    await readFile(paths.configPath, "utf8"),
    /custom_unlisted_provider:\n(?: {4}.+\n)* {4}thinking_effort: max/
  )
})

test("unlisted custom provider models can be selected when remote listing fails", async () => {
  const { setDefaultModelForUI, upsertCustomProviderForUI } =
    await import("../../src/main/model-provider/service")
  const { resolveModelRuntimeConfig } = await import("../../src/main/model-provider/resolver")

  upsertCustomProviderForUI({
    apiKey: "sk-list-failure-key",
    baseUrl: "https://list-failure.example.test/v1",
    displayName: "list failure provider",
    engine: "openai",
    models: ["gpt-listed"],
    requiresAuth: true,
    supportsStreaming: true
  })
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "remote list failed" } }), {
      status: 500,
      statusText: "Internal Server Error"
    })

  await setDefaultModelForUI("llm", "custom_list_failure_provider:gpt-unlisted", {
    allowUnlisted: true
  })

  assert.equal(
    resolveModelRuntimeConfig({ modelId: "custom_list_failure_provider:gpt-unlisted" }).modelId,
    "custom_list_failure_provider:gpt-unlisted"
  )
})

test("selected custom default models are included in the settings model list", async () => {
  const { listModelsForUI, setDefaultModelForUI, upsertCustomProviderForUI } =
    await import("../../src/main/model-provider/service")

  const providerId = upsertCustomProviderForUI({
    apiKey: "sk-selected-custom-key",
    baseUrl: "https://selected-custom.example.test/v1",
    displayName: "selected custom provider",
    engine: "openai",
    models: ["gpt-listed"],
    requiresAuth: true,
    supportsStreaming: true
  })
  const modelId = `${providerId}:gpt-unlisted`

  await setDefaultModelForUI("llm", modelId, {
    allowUnlisted: true,
    thinkingEffort: "max"
  })

  const selectedModel = listModelsForUI("llm").find((model) => model.id === modelId)
  assert.equal(selectedModel?.name, "gpt-unlisted")
  assert.equal(selectedModel?.provider, providerId)
  assert.equal(selectedModel?.fetchFrom, "customizable-model")
  assert.equal(selectedModel?.status, "active")
})

test("selected catalog defaults are included when remote model projection omits them", async () => {
  const { listModelsForUI, setProviderCredentialsForUI } =
    await import("../../src/main/model-provider/service")
  const { setActiveModelProvider } = await import("../../src/main/model-provider/settings")

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }] }), {
      status: 200,
      statusText: "OK"
    })

  await setProviderCredentialsForUI("deepseek", { apiKey: "sk-selected-catalog-key" })
  setActiveModelProvider("deepseek", "deepseek-v4-pro", { thinkingEffort: "high" })

  const selectedModel = listModelsForUI("llm").find(
    (model) => model.id === "deepseek:deepseek-v4-pro"
  )
  assert.equal(selectedModel?.name, "DeepSeek V4 Pro")
  assert.equal(selectedModel?.provider, "deepseek")
  assert.equal(selectedModel?.status, "active")
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
