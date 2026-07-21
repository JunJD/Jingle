import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import test from "node:test"
import type { ProviderExchangeCorrelation } from "../../src/main/model-provider/provider-exchange-correlation"
import {
  createProviderExchangeCorrelation,
  MAX_PROVIDER_CORRELATION_ID_LENGTH,
  readProviderRequestIdFromError,
  readProviderResponseIdFromMessage,
  recordProviderExchangeCorrelation
} from "../../src/main/model-provider/provider-exchange-correlation"
import { createOpenAICompatibleChatModel } from "../../src/main/model-provider/protocols/openai-compatible"
import type { ResolvedModelRuntimeConfig } from "../../src/main/model-provider/types"

type ProviderHandler = (
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>
) => Promise<void> | void

function createRuntimeConfig(modelName = "gpt-4o-mini"): ResolvedModelRuntimeConfig {
  return {
    credentials: { apiKey: "sk-test" },
    modelId: `openai:${modelName}`,
    modelName,
    modelType: "llm",
    providerId: "openai"
  }
}

async function withProviderServer<T>(
  handler: ProviderHandler,
  run: (baseURL: string) => Promise<T>
) {
  const server = createServer((request, response) => {
    request.resume()
    void Promise.resolve(handler(request, response)).catch(() => {
      response.destroy()
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address() as AddressInfo
  try {
    return await run(`http://127.0.0.1:${address.port}/v1`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

function createModel(
  baseURL: string,
  facts: ProviderExchangeCorrelation[],
  modelName = "gpt-4o-mini"
) {
  return createOpenAICompatibleChatModel({
    apiKey: "sk-test",
    baseURL,
    options: {
      providerExchangeCorrelationSink: (fact) => facts.push(fact)
    },
    runtimeConfig: createRuntimeConfig(modelName)
  })
}

function writeJsonResponse(
  response: ServerResponse<IncomingMessage>,
  input: { body: unknown; requestId: string; status?: number }
): void {
  response.writeHead(input.status ?? 200, {
    "content-type": "application/json",
    "x-request-id": input.requestId
  })
  response.end(JSON.stringify(input.body))
}

function createChatCompletion(id: string, text = "ok") {
  return {
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        logprobs: null,
        message: { content: text, role: "assistant" }
      }
    ],
    created: 1,
    id,
    model: "gpt-4o-mini",
    object: "chat.completion",
    usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 }
  }
}

function createResponsesApiResponse(id: string) {
  return {
    created_at: 1,
    error: null,
    id,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    metadata: {},
    model: "gpt-5-codex",
    object: "response",
    output: [
      {
        content: [{ annotations: [], text: "ok", type: "output_text" }],
        id: "msg-response-output",
        role: "assistant",
        status: "completed",
        type: "message"
      }
    ],
    output_text: "ok",
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: null,
    service_tier: "default",
    status: "completed",
    store: false,
    temperature: 1,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2
    },
    user: null
  }
}

test("provider correlation contract accepts only exact bounded tokens", () => {
  const fact = createProviderExchangeCorrelation({
    providerRequestId: "req_123:attempt-1",
    providerResponseId: "chatcmpl.123"
  })
  assert.deepEqual(fact, {
    providerRequestId: "req_123:attempt-1",
    providerResponseId: "chatcmpl.123",
    version: 1
  })
  assert.equal(Object.isFrozen(fact), true)
  assert.equal(createProviderExchangeCorrelation({ providerRequestId: " bad" }), null)
  assert.equal(createProviderExchangeCorrelation({ providerResponseId: "bad/id" }), null)
  assert.equal(
    createProviderExchangeCorrelation({
      providerRequestId: `r${"x".repeat(MAX_PROVIDER_CORRELATION_ID_LENGTH)}`
    }),
    null
  )
})

test("provider correlation readers never execute accessors or inspect proxies", () => {
  let accessorReads = 0
  const accessor = {
    get() {
      accessorReads += 1
      return "req-accessor"
    }
  }
  const error = Object.defineProperties({}, { message: accessor, requestID: accessor })
  const message = Object.defineProperties({}, { id: accessor, response_metadata: accessor })

  assert.equal(readProviderRequestIdFromError(error), null)
  assert.equal(readProviderResponseIdFromMessage(message), null)
  assert.equal(readProviderRequestIdFromError(new Proxy({ requestID: "req-proxy" }, {})), null)
  assert.equal(
    readProviderResponseIdFromMessage(new Proxy({ response_metadata: { id: "resp-proxy" } }, {})),
    null
  )
  assert.equal(accessorReads, 0)
})

test("chat completions preserve provider request and response ids", async () => {
  const facts: ProviderExchangeCorrelation[] = []
  await withProviderServer(
    (_request, response) => {
      writeJsonResponse(response, {
        body: createChatCompletion("chatcmpl-correlation"),
        requestId: "req-completion"
      })
    },
    async (baseURL) => {
      await createModel(baseURL, facts).invoke("correlation probe")
    }
  )

  assert.deepEqual(facts, [
    {
      providerRequestId: "req-completion",
      providerResponseId: "chatcmpl-correlation",
      version: 1
    }
  ])
})

test("tool-bound chat completions preserve provider correlation", async () => {
  const facts: ProviderExchangeCorrelation[] = []
  await withProviderServer(
    (_request, response) => {
      writeJsonResponse(response, {
        body: createChatCompletion("chatcmpl-bound-tool"),
        requestId: "req-bound-tool"
      })
    },
    async (baseURL) => {
      const model = createModel(baseURL, facts).bindTools([
        {
          function: {
            description: "Return a deterministic test value.",
            name: "read_test_value",
            parameters: { additionalProperties: false, properties: {}, type: "object" }
          },
          type: "function"
        }
      ])
      await model.invoke("correlation probe")
    }
  )

  assert.deepEqual(facts, [
    {
      providerRequestId: "req-bound-tool",
      providerResponseId: "chatcmpl-bound-tool",
      version: 1
    }
  ])
})

test("empty tool binding and direct model config preserve provider correlation", async () => {
  const facts: ProviderExchangeCorrelation[] = []
  let requestNumber = 0
  await withProviderServer(
    (_request, response) => {
      requestNumber += 1
      writeJsonResponse(response, {
        body: createChatCompletion(`chatcmpl-config-${requestNumber}`),
        requestId: `req-config-${requestNumber}`
      })
    },
    async (baseURL) => {
      const model = createModel(baseURL, facts)
      await model.bindTools([]).invoke("correlation probe")
      await model.withConfig({ stop: ["never"] }).invoke("correlation probe")
    }
  )

  assert.deepEqual(facts, [
    {
      providerRequestId: "req-config-1",
      providerResponseId: "chatcmpl-config-1",
      version: 1
    },
    {
      providerRequestId: "req-config-2",
      providerResponseId: "chatcmpl-config-2",
      version: 1
    }
  ])
})

test("responses API preserves its response id instead of the output message id", async () => {
  const facts: ProviderExchangeCorrelation[] = []
  await withProviderServer(
    (_request, response) => {
      writeJsonResponse(response, {
        body: createResponsesApiResponse("resp-correlation"),
        requestId: "req-responses"
      })
    },
    async (baseURL) => {
      await createModel(baseURL, facts, "gpt-5-codex").invoke("correlation probe")
    }
  )

  assert.deepEqual(facts, [
    {
      providerRequestId: "req-responses",
      providerResponseId: "resp-correlation",
      version: 1
    }
  ])
})

test("streaming captures the response header and stable chunk id", async () => {
  const facts: ProviderExchangeCorrelation[] = []
  await withProviderServer(
    (_request, response) => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "x-request-id": "req-stream"
      })
      response.write(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: { content: "ok", role: "assistant" },
              finish_reason: null,
              index: 0
            }
          ],
          created: 1,
          id: "chatcmpl-stream",
          model: "gpt-4o-mini",
          object: "chat.completion.chunk"
        })}\n\n`
      )
      response.write(
        `data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
          created: 1,
          id: "chatcmpl-stream",
          model: "gpt-4o-mini",
          object: "chat.completion.chunk"
        })}\n\n`
      )
      response.end("data: [DONE]\n\n")
    },
    async (baseURL) => {
      for await (const _chunk of await createModel(baseURL, facts).stream("correlation probe")) {
        // Consume the full provider stream so its terminal correlation can settle.
      }
    }
  )

  assert.deepEqual(facts, [
    {
      providerRequestId: "req-stream",
      providerResponseId: "chatcmpl-stream",
      version: 1
    }
  ])
})

test("terminal provider errors preserve only the bounded request id", async () => {
  const facts: ProviderExchangeCorrelation[] = []
  await withProviderServer(
    (_request, response) => {
      writeJsonResponse(response, {
        body: { error: { code: "rejected", message: "not recorded", type: "request_error" } },
        requestId: "req-error",
        status: 400
      })
    },
    async (baseURL) => {
      await assert.rejects(createModel(baseURL, facts).invoke("correlation probe"))
    }
  )

  assert.deepEqual(facts, [{ providerRequestId: "req-error", version: 1 }])
  assert.equal(JSON.stringify(facts).includes("not recorded"), false)
})

test("provider retries preserve every request id and pair the final response", async () => {
  const facts: ProviderExchangeCorrelation[] = []
  let attempt = 0
  await withProviderServer(
    (_request, response) => {
      attempt += 1
      if (attempt === 1) {
        writeJsonResponse(response, {
          body: { error: { code: "temporary", message: "not recorded", type: "server_error" } },
          requestId: "req-retry-1",
          status: 500
        })
        return
      }
      writeJsonResponse(response, {
        body: createChatCompletion("chatcmpl-retry"),
        requestId: "req-retry-2"
      })
    },
    async (baseURL) => {
      await createModel(baseURL, facts).invoke("correlation probe")
    }
  )

  assert.equal(attempt, 2)
  assert.deepEqual(facts, [
    { providerRequestId: "req-retry-1", version: 1 },
    {
      providerRequestId: "req-retry-2",
      providerResponseId: "chatcmpl-retry",
      version: 1
    }
  ])
})

test("concurrent calls on one model do not cross provider ids", async () => {
  const facts: ProviderExchangeCorrelation[] = []
  let requestCount = 0
  await withProviderServer(
    async (_request, response) => {
      requestCount += 1
      const requestNumber = requestCount
      if (requestNumber === 1) {
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
      writeJsonResponse(response, {
        body: createChatCompletion(`chatcmpl-concurrent-${requestNumber}`),
        requestId: `req-concurrent-${requestNumber}`
      })
    },
    async (baseURL) => {
      const model = createModel(baseURL, facts)
      await Promise.all([model.invoke("first probe"), model.invoke("second probe")])
    }
  )

  assert.deepEqual(
    new Set(facts.map((fact) => `${fact.providerRequestId}:${fact.providerResponseId}`)),
    new Set(["req-concurrent-1:chatcmpl-concurrent-1", "req-concurrent-2:chatcmpl-concurrent-2"])
  )
})

test("invalid provider ids fail closed without changing the model result", async () => {
  const facts: ProviderExchangeCorrelation[] = []
  await withProviderServer(
    (_request, response) => {
      writeJsonResponse(response, {
        body: createChatCompletion("invalid/response"),
        requestId: "invalid request"
      })
    },
    async (baseURL) => {
      const result = await createModel(baseURL, facts).invoke("correlation probe")
      assert.equal(result.content, "ok")
    }
  )

  assert.deepEqual(facts, [])
})

test("correlation sink failures never change provider request semantics", async () => {
  await withProviderServer(
    (_request, response) => {
      writeJsonResponse(response, {
        body: createChatCompletion("chatcmpl-sink-failure"),
        requestId: "req-sink-failure"
      })
    },
    async (baseURL) => {
      const model = createOpenAICompatibleChatModel({
        apiKey: "sk-test",
        baseURL,
        options: {
          providerExchangeCorrelationSink: () => {
            throw new Error("sink failure")
          }
        },
        runtimeConfig: createRuntimeConfig()
      })
      const result = await model.invoke("correlation probe")
      assert.equal(result.content, "ok")
    }
  )
})

test("async correlation sink rejections are observed without becoming unhandled", async () => {
  const rejection = new Error("sink rejection")
  let unhandled = false
  const onUnhandledRejection = (reason: unknown) => {
    if (reason === rejection) {
      unhandled = true
    }
  }
  process.on("unhandledRejection", onUnhandledRejection)
  try {
    recordProviderExchangeCorrelation(
      async () => {
        throw rejection
      },
      { providerRequestId: "req-async-sink" }
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(unhandled, false)
  } finally {
    process.off("unhandledRejection", onUnhandledRejection)
  }
})
