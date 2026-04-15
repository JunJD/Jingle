import assert from "node:assert/strict"
import test from "node:test"
import {
  listRemoteModelsByProvider,
  validateRemoteProviderCredentials
} from "../../src/main/model-provider/adapters"

const originalFetch = globalThis.fetch

function mockJsonResponse(payload: unknown, status = 200): void {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status,
      statusText: status === 200 ? "OK" : "Unauthorized"
    })
}

test.afterEach(() => {
  globalThis.fetch = originalFetch
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

test("listRemoteModelsByProvider uses Gemini API key header for google", async () => {
  let request: Request | undefined
  globalThis.fetch = async (input, init) => {
    request = input instanceof Request ? new Request(input, init) : new Request(input, init)

    return new Response(
      JSON.stringify({
        models: [
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
            supportedGenerationMethods: ["generateContent"]
          }
        ]
      }),
      {
        status: 200,
        statusText: "OK"
      }
    )
  }

  const models = await listRemoteModelsByProvider("google", { apiKey: "AIza-test" })

  assert.equal(request?.headers.get("x-goog-api-key"), "AIza-test")
  assert.equal(request?.url, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000")
  assert.deepEqual(
    models.map((model) => model.id),
    ["google:gemini-2.5-flash"]
  )
})

test("validateRemoteProviderCredentials surfaces google response body", async () => {
  mockJsonResponse(
    {
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key."
      }
    },
    400
  )

  await assert.rejects(
    validateRemoteProviderCredentials("google", { apiKey: "bad-key" }),
    /API key not valid/
  )
})

test("listRemoteModelsByProvider routes kimi through Moonshot's OpenAI-compatible models endpoint", async () => {
  let request: Request | undefined
  globalThis.fetch = async (input, init) => {
    request = input instanceof Request ? new Request(input, init) : new Request(input, init)

    return new Response(
      JSON.stringify({
        data: [{ id: "kimi-k2.5" }, { id: "embedding-2" }]
      }),
      {
        status: 200,
        statusText: "OK"
      }
    )
  }

  const models = await listRemoteModelsByProvider("kimi", { apiKey: "sk-kimi" })

  assert.equal(request?.headers.get("authorization"), "Bearer sk-kimi")
  assert.equal(request?.url, "https://api.moonshot.cn/v1/models")
  assert.deepEqual(
    models.map((model) => model.id),
    ["kimi:kimi-k2.5"]
  )
})
