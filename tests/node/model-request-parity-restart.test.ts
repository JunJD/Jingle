import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const CHILD_MODE_ENV = "JINGLE_MODEL_REQUEST_PARITY_CHILD_MODE"
const FAKE_PROVIDER_ORIGIN_ENV = "JINGLE_MODEL_REQUEST_PARITY_FAKE_ORIGIN"
const RESULT_PREFIX = "JINGLE_MODEL_REQUEST_PARITY_RESULT="

const CASES = [
  {
    modelId: "openai:gpt-5.6-sol",
    provider: "openai",
    thinkingEffort: "max"
  },
  {
    modelId: "anthropic:claude-sonnet-4-5-20250929",
    provider: "anthropic",
    thinkingEffort: "high"
  },
  {
    modelId: "google:gemini-3-flash-preview",
    provider: "google",
    thinkingEffort: "high"
  }
] as const

type ChildMode = "reader" | "writer"
type ProviderId = (typeof CASES)[number]["provider"]
type RunIds = Record<ProviderId, string>
type CapturedRequest = {
  body: Record<string, unknown>
  path: string
  provider: ProviderId
}

const childMode = process.env[CHILD_MODE_ENV] as ChildMode | undefined

if (childMode) {
  void runChildProcess(childMode).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
} else {
  test("durable Run selections drive exact provider requests after restart and ambient drift", async () => {
    const originalJingleHome = process.env.JINGLE_HOME
    const jingleHome = await mkdtemp(join(tmpdir(), "jingle-model-request-parity-"))
    const requests: CapturedRequest[] = []
    const server = createServer(async (request, response) => {
      const provider = readProviderFromPath(request.url)
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      requests.push({
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
        path: request.url ?? "",
        provider
      })

      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(createProviderResponse(provider)))
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address() as AddressInfo
    const fakeProviderOrigin = `http://127.0.0.1:${address.port}`

    try {
      const runIds = await runIsolatedChild("writer", fakeProviderOrigin, jingleHome)
      assert.deepEqual(Object.keys(runIds).sort(), ["anthropic", "google", "openai"])

      const restoredRunIds = await runIsolatedChild(
        "reader",
        fakeProviderOrigin,
        jingleHome,
        runIds
      )
      assert.deepEqual(restoredRunIds, runIds)

      assert.equal(requests.length, 3)
      const openAiRequest = readRequest(requests, "openai").body
      assert.equal(openAiRequest.model, "gpt-5.6-sol")
      assert.equal(openAiRequest.reasoning_effort, "max")

      const anthropicRequest = readRequest(requests, "anthropic").body
      assert.equal(anthropicRequest.model, "claude-sonnet-4-5-20250929")
      assert.deepEqual(anthropicRequest.thinking, {
        budget_tokens: 16000,
        type: "enabled"
      })

      const googleRequest = readRequest(requests, "google")
      assert.match(
        googleRequest.path,
        /^\/google\/v1beta\/models\/gemini-3-flash-preview:generateContent(?:\?|$)/
      )
      assert.deepEqual(
        readRecord(readRecord(googleRequest.body, "generationConfig"), "thinkingConfig"),
        {
          thinkingLevel: "HIGH"
        }
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      if (originalJingleHome === undefined) {
        delete process.env.JINGLE_HOME
      } else {
        process.env.JINGLE_HOME = originalJingleHome
      }
      await rm(jingleHome, { force: true, recursive: true })
    }
  })
}

async function runChildProcess(mode: ChildMode): Promise<void> {
  const fakeProviderOrigin = process.env[FAKE_PROVIDER_ORIGIN_ENV]
  if (!fakeProviderOrigin) {
    throw new Error("Missing fake provider origin for request parity child process.")
  }

  const [{ closeDatabase, initializeDatabase }, { setProviderCredential }] = await Promise.all([
    import("../../src/main/db/lifecycle"),
    import("../../src/main/model-provider/auth-store")
  ])

  try {
    await initializeDatabase()

    if (mode === "writer") {
      for (const { provider } of CASES) {
        setProviderCredential(provider, "apiKey", `test-${provider}-key`)
      }
      const [{ beginAgentRun }, { createThread }] = await Promise.all([
        import("../../src/main/agent/persistence"),
        import("../../src/main/db/threads")
      ])
      const runIds = {} as RunIds
      for (const { modelId, provider, thinkingEffort } of CASES) {
        const threadId = `thread-model-request-parity-${provider}`
        await createThread(threadId)
        const result = await beginAgentRun(
          threadId,
          { modelId, thinkingEffort, version: 1 },
          {
            startEvent: {
              composerText: `Parity request for ${provider}`,
              contentPreview: `Parity request for ${provider}`,
              refs: [],
              userMessageId: `message-model-request-parity-${provider}`
            }
          }
        )
        runIds[provider] = result.runId
      }
      writeChildResult(runIds)
      return
    }

    const runIds = readRunIdsFromEnvironment()
    const realFetch = globalThis.fetch
    process.env.ANTHROPIC_BASE_URL = `${fakeProviderOrigin}/anthropic`
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url.startsWith(fakeProviderOrigin)) {
        return realFetch(input, init)
      }
      const provider = readProviderFromSdkUrl(url)
      if (provider === "google") {
        const providerUrl = new URL(url)
        return realFetch(
          `${fakeProviderOrigin}/${provider}${providerUrl.pathname}${providerUrl.search}`,
          init
        )
      }
      return realFetch(`${fakeProviderOrigin}/${provider}`, init)
    }

    try {
      const [{ getRun }, { admitRunModelRuntimeSelectionForResume }, { getChatModelInstance }] =
        await Promise.all([
          import("../../src/main/db/runs"),
          import("../../src/main/model-provider/runtime-selection-admission"),
          import("../../src/main/llm/get-chat-model")
        ])
      const { setActiveModelProvider } = await import("../../src/main/model-provider/settings")

      setActiveModelProvider("openai", "gpt-5", { thinkingEffort: "off" })
      for (const { provider } of CASES) {
        const run = await getRun(runIds[provider])
        assert.ok(run?.metadata)
        const admission = admitRunModelRuntimeSelectionForResume({
          channel: "agent:resume",
          metadata: JSON.parse(run.metadata) as Record<string, unknown>,
          recoverySelection: undefined
        })
        assert.equal(admission.kind, "persisted")
        const model = getChatModelInstance({
          maxOutputTokens: 1024,
          parallelToolCalls: false,
          selection: admission.selection,
          temperature: 0
        })
        await model.invoke(`Restarted parity request for ${provider}`)
      }
      writeChildResult(runIds)
    } finally {
      globalThis.fetch = realFetch
    }
  } finally {
    await closeDatabase()
  }
}

function createProviderResponse(provider: ProviderId): Record<string, unknown> {
  switch (provider) {
    case "openai":
      return {
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            logprobs: null,
            message: { content: "ok", role: "assistant" }
          }
        ],
        created: 1,
        id: "chatcmpl-model-request-parity",
        model: "gpt-5.6-sol",
        object: "chat.completion",
        usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 }
      }
    case "anthropic":
      return {
        content: [{ text: "ok", type: "text" }],
        id: "msg_model_request_parity",
        model: "claude-sonnet-4-5-20250929",
        role: "assistant",
        stop_reason: "end_turn",
        stop_sequence: null,
        type: "message",
        usage: { input_tokens: 1, output_tokens: 1 }
      }
    case "google":
      return {
        candidates: [
          {
            content: { parts: [{ text: "ok" }], role: "model" },
            finishReason: "STOP",
            index: 0
          }
        ],
        usageMetadata: {
          candidatesTokenCount: 1,
          promptTokenCount: 1,
          totalTokenCount: 2
        }
      }
  }
}

function readProviderFromPath(path: string | undefined): ProviderId {
  const provider = path?.split("/").filter(Boolean)[0]
  assert.ok(provider === "openai" || provider === "anthropic" || provider === "google")
  return provider
}

function readProviderFromSdkUrl(url: string): ProviderId {
  if (url.includes("anthropic.com")) {
    return "anthropic"
  }
  if (url.includes("generativelanguage.googleapis.com")) {
    return "google"
  }
  if (url.includes("openai.com")) {
    return "openai"
  }
  throw new Error(`Unexpected provider request URL: ${url}`)
}

function readRequest(requests: CapturedRequest[], provider: ProviderId): CapturedRequest {
  const request = requests.find((candidate) => candidate.provider === provider)
  assert.ok(request)
  return request
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key]
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  return value as Record<string, unknown>
}

function readRunIdsFromEnvironment(): RunIds {
  const value = process.env.JINGLE_MODEL_REQUEST_PARITY_RUN_IDS
  assert.ok(value)
  const parsed = JSON.parse(value) as Record<string, unknown>
  for (const { provider } of CASES) {
    assert.equal(typeof parsed[provider], "string")
  }
  return parsed as RunIds
}

function writeChildResult(result: RunIds): void {
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`)
}

function runIsolatedChild(
  mode: ChildMode,
  fakeProviderOrigin: string,
  jingleHome: string,
  runIds?: RunIds
): Promise<RunIds> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [require.resolve("tsx/cli"), __filename], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        [CHILD_MODE_ENV]: mode,
        [FAKE_PROVIDER_ORIGIN_ENV]: fakeProviderOrigin,
        JINGLE_HOME: jingleHome,
        JINGLE_MODEL_REQUEST_PARITY_RUN_IDS: runIds ? JSON.stringify(runIds) : ""
      },
      stdio: ["ignore", "pipe", "pipe"]
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    child.once("error", reject)
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Model request parity ${mode} process failed (${code}).\n${stderr}`))
        return
      }
      const resultLine = stdout.split("\n").find((line) => line.startsWith(RESULT_PREFIX))
      if (!resultLine) {
        reject(new Error(`Model request parity ${mode} process returned no result.\n${stdout}`))
        return
      }
      resolve(JSON.parse(resultLine.slice(RESULT_PREFIX.length)) as RunIds)
    })
  })
}
