import assert from "node:assert/strict"
import test from "node:test"
import {
  listRemoteModelsByProvider,
  validateRemoteProviderCredentials
} from "../../src/main/model-provider/model-list"

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

  const models = await listRemoteModelsByProvider("openai", "sk-test")

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
    validateRemoteProviderCredentials("openai", "bad-key"),
    /openai models list failed: 401 Unauthorized/
  )
})

test("validateRemoteProviderCredentials rejects providers without supported chat models", async () => {
  mockJsonResponse({
    data: [{ id: "text-embedding-3-small" }]
  })

  await assert.rejects(
    validateRemoteProviderCredentials("openai", "sk-test"),
    /openai models list returned no supported chat models/
  )
})

test("listRemoteModelsByProvider rejects malformed provider responses", async () => {
  mockJsonResponse({ data: [{ object: "model" }] })

  await assert.rejects(
    listRemoteModelsByProvider("openai", "sk-test"),
    /openai models list returned an invalid response/
  )
})

test("listRemoteModelsByProvider filters DashScope to supported chat models", async () => {
  mockJsonResponse({
    data: [{ id: "qwen-plus" }, { id: "text-embedding-v4" }, { id: "wanx2.1-t2i-turbo" }]
  })

  const models = await listRemoteModelsByProvider("dashscope", "sk-test")

  assert.deepEqual(
    models.map((model) => model.id),
    ["dashscope:qwen-plus"]
  )
})
