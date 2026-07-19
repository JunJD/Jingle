import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint"

const CHILD_MODE_ENV = "JINGLE_GOOGLE_THOUGHT_SIGNATURE_CHILD_MODE"
const FAKE_GOOGLE_URL_ENV = "JINGLE_GOOGLE_THOUGHT_SIGNATURE_FAKE_URL"
const RESULT_PREFIX = "JINGLE_GOOGLE_THOUGHT_SIGNATURE_RESULT="
const SIGNATURE_MAP_KEY = "__gemini_function_call_thought_signatures__"
const EXPECTED_SIGNATURE = "provider-signature-AQIDBAUGBwgJCgsMDQ4PEA=="
const THREAD_ID = "thread-google-thought-signature-restart"
const TOOL_NAME = "read_weather"

type ChildMode = "reader" | "writer"

type ChildResult = {
  signature: string
  toolCallId: string
}

type CapturedRequest = {
  body: Record<string, unknown>
  path: string
}

const childMode = process.env[CHILD_MODE_ENV] as ChildMode | undefined

if (childMode) {
  void runChildProcess(childMode).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
} else {
  test("Gemini function-call thought signature and generated tool-call ID survive checkpoint restart", async () => {
    const originalJingleHome = process.env.JINGLE_HOME
    const jingleHome = await mkdtemp(join(tmpdir(), "jingle-google-thought-signature-"))
    const capturedRequests: CapturedRequest[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
      const path = request.url ?? ""
      capturedRequests.push({ body, path })

      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify(
          path === "/writer"
            ? {
                candidates: [
                  {
                    content: {
                      parts: [
                        {
                          functionCall: {
                            args: { city: "Shanghai" },
                            name: TOOL_NAME
                          },
                          thoughtSignature: EXPECTED_SIGNATURE
                        }
                      ],
                      role: "model"
                    },
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
            : {
                candidates: [
                  {
                    content: { parts: [{ text: "It is sunny." }], role: "model" },
                    finishReason: "STOP",
                    index: 0
                  }
                ],
                usageMetadata: {
                  candidatesTokenCount: 1,
                  promptTokenCount: 3,
                  totalTokenCount: 4
                }
              }
        )
      )
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address() as AddressInfo
    const fakeGoogleOrigin = `http://127.0.0.1:${address.port}`

    try {
      const writer = await runIsolatedChild("writer", fakeGoogleOrigin, jingleHome)
      assert.match(
        writer.toolCallId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
      assert.equal(writer.signature, EXPECTED_SIGNATURE)

      const reader = await runIsolatedChild(
        "reader",
        fakeGoogleOrigin,
        jingleHome,
        writer.toolCallId
      )
      assert.equal(reader.toolCallId, writer.toolCallId)
      assert.equal(reader.signature, EXPECTED_SIGNATURE)

      assert.equal(capturedRequests.length, 2)
      assert.equal(capturedRequests[0]?.path, "/writer")
      assert.equal(capturedRequests[1]?.path, "/reader")

      const resumedContents = readArray(capturedRequests[1]?.body, "contents")
      assert.equal(resumedContents.length, 3)
      assert.deepEqual(resumedContents[0], {
        parts: [{ text: "What is the weather in Shanghai?" }],
        role: "user"
      })
      assert.deepEqual(resumedContents[1], {
        parts: [
          {
            functionCall: { args: { city: "Shanghai" }, name: TOOL_NAME },
            thoughtSignature: EXPECTED_SIGNATURE
          }
        ],
        role: "model"
      })
      assert.deepEqual(resumedContents[2], {
        parts: [
          {
            functionResponse: {
              name: TOOL_NAME,
              response: { result: "Sunny, 24 C" }
            }
          }
        ],
        role: "user"
      })
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
  const fakeGoogleUrl = process.env[FAKE_GOOGLE_URL_ENV]
  if (!fakeGoogleUrl) {
    throw new Error("Missing fake Google URL for thought-signature child process.")
  }

  const realFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => realFetch(fakeGoogleUrl, init)

  const [{ closeDatabase, initializeDatabase }, { createThread }, { PrismaCheckpointSaver }] =
    await Promise.all([
      import("../../src/main/db/lifecycle"),
      import("../../src/main/db/threads"),
      import("../../src/main/checkpointer/prisma-saver")
    ])

  try {
    await initializeDatabase()
    const saver = new PrismaCheckpointSaver()

    if (mode === "writer") {
      await createThread(THREAD_ID)
      const humanMessage = new HumanMessage({
        content: "What is the weather in Shanghai?",
        id: "human-google-thought-signature"
      })
      const response = await createGoogleModel().invoke([humanMessage])
      assert.ok(AIMessage.isInstance(response))

      const result = readThoughtSignatureResult(response)
      const checkpoint = emptyCheckpoint()
      checkpoint.id = "checkpoint-google-thought-signature"
      checkpoint.channel_values = { messages: [humanMessage, response] }
      checkpoint.channel_versions = { messages: "google-thought-signature-v1" }
      await saver.put(
        { configurable: { thread_id: THREAD_ID } },
        checkpoint,
        { parents: {}, source: "update", step: 0 },
        { messages: "google-thought-signature-v1" }
      )
      writeChildResult(result)
      return
    }

    const tuple = await saver.getTuple({ configurable: { thread_id: THREAD_ID } })
    const messages = tuple?.checkpoint.channel_values.messages
    assert.ok(Array.isArray(messages))
    assert.equal(messages.length, 2)
    const restoredAssistant = messages[1]
    assert.ok(AIMessage.isInstance(restoredAssistant))

    const result = readThoughtSignatureResult(restoredAssistant)
    const expectedToolCallId = process.env.JINGLE_GOOGLE_THOUGHT_SIGNATURE_TOOL_CALL_ID
    assert.equal(result.toolCallId, expectedToolCallId)
    assert.equal(result.signature, EXPECTED_SIGNATURE)

    const toolMessage = new ToolMessage({
      content: "Sunny, 24 C",
      name: TOOL_NAME,
      tool_call_id: result.toolCallId
    })
    await createGoogleModel().invoke([...(messages as BaseMessage[]), toolMessage])
    writeChildResult(result)
  } finally {
    globalThis.fetch = realFetch
    await closeDatabase()
  }
}

function createGoogleModel(): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    apiKey: "test-google-key",
    maxOutputTokens: 256,
    model: "gemini-3-flash-preview"
  })
}

function readThoughtSignatureResult(message: AIMessage): ChildResult {
  const toolCall = message.tool_calls?.[0]
  assert.ok(toolCall?.id)
  assert.equal(toolCall.name, TOOL_NAME)
  assert.deepEqual(toolCall.args, { city: "Shanghai" })

  const signatureMap = message.additional_kwargs[SIGNATURE_MAP_KEY]
  assert.ok(signatureMap && typeof signatureMap === "object" && !Array.isArray(signatureMap))
  const signature = (signatureMap as Record<string, unknown>)[toolCall.id]
  assert.equal(signature, EXPECTED_SIGNATURE)
  return { signature, toolCallId: toolCall.id }
}

function writeChildResult(result: ChildResult): void {
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`)
}

function runIsolatedChild(
  mode: ChildMode,
  fakeGoogleOrigin: string,
  jingleHome: string,
  expectedToolCallId?: string
): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [require.resolve("tsx/cli"), __filename], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        [CHILD_MODE_ENV]: mode,
        [FAKE_GOOGLE_URL_ENV]: `${fakeGoogleOrigin}/${mode}`,
        JINGLE_GOOGLE_THOUGHT_SIGNATURE_TOOL_CALL_ID: expectedToolCallId ?? "",
        JINGLE_HOME: jingleHome
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
        reject(new Error(`Google thought-signature ${mode} process failed (${code}).\n${stderr}`))
        return
      }
      const resultLine = stdout.split("\n").find((line) => line.startsWith(RESULT_PREFIX))
      if (!resultLine) {
        reject(new Error(`Google thought-signature ${mode} process returned no result.\n${stdout}`))
        return
      }
      resolve(JSON.parse(resultLine.slice(RESULT_PREFIX.length)) as ChildResult)
    })
  })
}

function readArray(record: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = record?.[key]
  assert.ok(Array.isArray(value))
  return value
}
