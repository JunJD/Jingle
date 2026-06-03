import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { AIMessage, type BaseMessage } from "@langchain/core/messages"
import { ChatAnthropic } from "@langchain/anthropic"
import { ChatOpenAI } from "@langchain/openai"
import {
  createProviderChatModelFromAdapter,
  getProviderAdapter,
  listRemoteModelsByProvider,
  validateRemoteProviderCredentials
} from "../../src/main/model-provider/adapters"
import { getModelProviderStateForUI } from "../../src/main/model-provider/service"
import type { ProviderId, ResolvedModelRuntimeConfig } from "../../src/main/model-provider/types"

const originalFetch = globalThis.fetch
const originalAnthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY
const originalJingleConfigHome = process.env.JINGLE_CONFIG_HOME
const originalJingleDataHome = process.env.JINGLE_DATA_HOME

function mockJsonResponse(payload: unknown, status = 200): void {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status,
      statusText: status === 200 ? "OK" : "Unauthorized"
    })
}

test.afterEach(() => {
  globalThis.fetch = originalFetch
  restoreEnvValue("ANTHROPIC_AUTH_TOKEN", originalAnthropicAuthToken)
  restoreEnvValue("ANTHROPIC_API_KEY", originalAnthropicApiKey)
  restoreEnvValue("JINGLE_CONFIG_HOME", originalJingleConfigHome)
  restoreEnvValue("JINGLE_DATA_HOME", originalJingleDataHome)
})

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

function createRuntimeConfig(
  providerId: ProviderId,
  modelName: string,
  overrides: Partial<ResolvedModelRuntimeConfig> = {}
): ResolvedModelRuntimeConfig {
  return {
    credentials: {
      apiKey: "sk-test"
    },
    modelId: `${providerId}:${modelName}`,
    modelName,
    modelType: "llm",
    providerId,
    ...overrides
  }
}

test("anthropic chat models can disable parallel tool use for agent approvals", () => {
  const model = createProviderChatModelFromAdapter(
    createRuntimeConfig("anthropic", "claude-sonnet-4-5-20250929"),
    { parallelToolCalls: false }
  )

  assert.ok(model instanceof ChatAnthropic)
  assert.equal(model.invocationParams({}).disable_parallel_tool_use, true)
})

test("anthropic-style providers ignore ambient Anthropic auth tokens when credentials are configured", () => {
  process.env.ANTHROPIC_API_KEY = "sk-env-anthropic-key"
  process.env.ANTHROPIC_AUTH_TOKEN = "sk-env-auth-token"

  const model = createProviderChatModelFromAdapter(
    createRuntimeConfig("deepseek", "deepseek-v4-pro"),
    { parallelToolCalls: false }
  ) as ChatAnthropic

  assert.equal(model.apiKey, "sk-test")
  assert.equal(model.clientOptions.authToken, null)
})

test("openai-compatible chat models can disable parallel tool calls for agent approvals", () => {
  const model = createProviderChatModelFromAdapter(createRuntimeConfig("dashscope", "glm-4.6"), {
    parallelToolCalls: false
  })

  assert.ok(model instanceof ChatOpenAI)
  assert.equal(model.invocationParams({}).parallel_tool_calls, false)
})

test("openai-compatible chat models pass thinking effort as reasoning effort", () => {
  const model = createProviderChatModelFromAdapter(
    createRuntimeConfig("openai", "gpt-5.1", {
      thinkingEffort: "medium"
    })
  )

  assert.ok(model instanceof ChatOpenAI)
  const params = model.invocationParams({}) as Record<string, unknown>
  assert.equal(params.reasoning_effort, "medium")
})

test("codex provider creates a Codex CLI-backed chat model", () => {
  const model = createProviderChatModelFromAdapter(createRuntimeConfig("codex", "current"))

  assert.equal(model._llmType(), "codex-cli")
})

test("declarative providers are listed separately from user custom providers", () => {
  const jingleHome = mkdtempSync(join(tmpdir(), "jingle-declarative-providers-"))
  process.env.JINGLE_CONFIG_HOME = join(jingleHome, "config")
  process.env.JINGLE_DATA_HOME = join(jingleHome, "data")

  const providers = getModelProviderStateForUI().providers
  const cerebras = providers.find((provider) => provider.id === "cerebras")
  const xiaoxiong = providers.find((provider) => provider.id === "custom_xiaoxiong")

  try {
    assert.equal(cerebras?.source, "declarative")
    assert.equal(cerebras?.name, "Cerebras")
    assert.equal(xiaoxiong, undefined)
  } finally {
    rmSync(jingleHome, { force: true, recursive: true })
  }
})

test("declarative provider adapters use catalog metadata", () => {
  const adapter = getProviderAdapter("cerebras")

  assert.equal(adapter.definition.source, "declarative")
  assert.deepEqual(
    adapter.definition.credentialFormSchemas.map((schema) => schema.variable),
    ["apiKey"]
  )
})

test("custom OpenAI-compatible providers derive the Goose default v1 client path", () => {
  const jingleHome = mkdtempSync(join(tmpdir(), "jingle-custom-provider-base-url-"))
  process.env.JINGLE_CONFIG_HOME = join(jingleHome, "config")
  process.env.JINGLE_DATA_HOME = join(jingleHome, "data")
  const customProvidersDir = join(process.env.JINGLE_CONFIG_HOME, "custom_providers")
  mkdirSync(customProvidersDir, { recursive: true })
  writeFileSync(
    join(customProvidersDir, "custom_xiaoxiong.json"),
    JSON.stringify(
      {
        api_key_env: "CUSTOM_XIAOXIONG_API_KEY",
        base_path: null,
        base_url: "https://www.xiongxiongai.online",
        display_name: "xiaoxiong",
        engine: "openai",
        models: [{ name: "gpt-5.5" }],
        name: "custom_xiaoxiong",
        requires_auth: true,
        supports_streaming: true
      },
      null,
      2
    )
  )

  try {
    const model = createProviderChatModelFromAdapter(
      createRuntimeConfig("custom_xiaoxiong", "gpt-5.5")
    ) as ChatOpenAI

    assert.equal(model.clientConfig.baseURL, "https://www.xiongxiongai.online/v1")
  } finally {
    rmSync(jingleHome, { force: true, recursive: true })
  }
})

test("deepseek chat models use the Anthropic-compatible endpoint for thinking tool calls", () => {
  const model = createProviderChatModelFromAdapter(
    createRuntimeConfig("deepseek", "deepseek-v4-pro"),
    { parallelToolCalls: false, temperature: 0 }
  )

  assert.ok(model instanceof ChatAnthropic)
  assert.equal(model.apiUrl, "https://api.deepseek.com/anthropic")

  const params = model.invocationParams({})
  assert.equal(params.disable_parallel_tool_use, true)
  assert.equal(params.model, "deepseek-v4-pro")
  assert.deepEqual(params.thinking, { budget_tokens: 1024, type: "enabled" })
  assert.equal(params.temperature, undefined)
})

test("anthropic chat models pass thinking effort as thinking budget", () => {
  const model = createProviderChatModelFromAdapter(
    createRuntimeConfig("anthropic", "claude-sonnet-4-5-20250929", {
      thinkingEffort: "high"
    }),
    { temperature: 0 }
  ) as ChatAnthropic

  const params = model.invocationParams({})
  assert.deepEqual(params.thinking, { budget_tokens: 16000, type: "enabled" })
  assert.equal(params.temperature, undefined)
})

test("deepseek thinking models replay assistant tool calls with an Anthropic thinking block", async () => {
  const model = createProviderChatModelFromAdapter(
    createRuntimeConfig("deepseek", "deepseek-v4-pro"),
    { parallelToolCalls: false }
  )
  const originalGenerate = ChatAnthropic.prototype._generate
  let capturedMessages: BaseMessage[] = []

  ChatAnthropic.prototype._generate = async function (messages: BaseMessage[]) {
    capturedMessages = messages
    return { generations: [] }
  } as typeof ChatAnthropic.prototype._generate

  try {
    await model._generate(
      [
        new AIMessage({
          content: "",
          tool_calls: [{ args: {}, id: "call_1", name: "read_file", type: "tool_call" }]
        })
      ],
      {}
    )
  } finally {
    ChatAnthropic.prototype._generate = originalGenerate
  }

  const assistantMessage = capturedMessages[0]
  assert.ok(assistantMessage instanceof AIMessage)
  assert.deepEqual(assistantMessage.content, [{ signature: "", thinking: "", type: "thinking" }])
  assert.deepEqual(assistantMessage.tool_calls, [
    { args: {}, id: "call_1", name: "read_file", type: "tool_call" }
  ])
})

test("deepseek non-thinking chat models do not add Anthropic thinking replay blocks", async () => {
  const model = createProviderChatModelFromAdapter(
    createRuntimeConfig("deepseek", "deepseek-chat"),
    {
      parallelToolCalls: false
    }
  )
  const originalGenerate = ChatAnthropic.prototype._generate
  let capturedMessages: BaseMessage[] = []

  ChatAnthropic.prototype._generate = async function (messages: BaseMessage[]) {
    capturedMessages = messages
    return { generations: [] }
  } as typeof ChatAnthropic.prototype._generate

  try {
    await model._generate(
      [
        new AIMessage({
          content: "",
          tool_calls: [{ args: {}, id: "call_1", name: "read_file", type: "tool_call" }]
        })
      ],
      {}
    )
  } finally {
    ChatAnthropic.prototype._generate = originalGenerate
  }

  const assistantMessage = capturedMessages[0]
  assert.ok(assistantMessage instanceof AIMessage)
  assert.equal(assistantMessage.content, "")
})

test("listRemoteModelsByProvider scopes remote model ids by provider", async () => {
  mockJsonResponse({
    data: [{ id: "gpt-4o" }, { id: "text-embedding-3-small" }]
  })

  const models = await listRemoteModelsByProvider("openai", { apiKey: "sk-test" })

  assert.deepEqual(
    models.map((model) => ({
      fetchFrom: model.fetchFrom,
      id: model.id,
      model: model.model,
      modelType: model.modelType,
      provider: model.provider,
      status: model.status
    })),
    [
      {
        fetchFrom: "fetch-from-remote",
        id: "openai:gpt-4o",
        model: "gpt-4o",
        modelType: "llm",
        provider: "openai",
        status: "active"
      }
    ]
  )
})

test("validateRemoteProviderCredentials rejects provider model-list failures", async () => {
  mockJsonResponse({ error: "invalid api key" }, 401)

  await assert.rejects(
    validateRemoteProviderCredentials("openai", { apiKey: "bad-key" }),
    /openai models list failed: 401 Unauthorized/
  )
})

test("validateRemoteProviderCredentials rejects providers without supported chat models", async () => {
  mockJsonResponse({
    data: [{ id: "text-embedding-3-small" }]
  })

  await assert.rejects(
    validateRemoteProviderCredentials("openai", { apiKey: "sk-test" }),
    /openai models list returned no supported chat models/
  )
})

test("listRemoteModelsByProvider rejects malformed provider responses", async () => {
  mockJsonResponse({ data: [{ object: "model" }] })

  await assert.rejects(
    listRemoteModelsByProvider("openai", { apiKey: "sk-test" }),
    /openai models list returned an invalid response/
  )
})

test("listRemoteModelsByProvider filters DashScope to supported chat models", async () => {
  mockJsonResponse({
    data: [{ id: "qwen-plus" }, { id: "text-embedding-v4" }, { id: "wanx2.1-t2i-turbo" }]
  })

  const models = await listRemoteModelsByProvider("dashscope", { apiKey: "sk-test" })

  assert.deepEqual(
    models.map((model) => model.id),
    ["dashscope:qwen-plus"]
  )
})
