import assert from "node:assert/strict"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createDotenvCommandEnv } from "../../scripts/run-with-dotenv.mjs"
import {
  buildAgentRunTraceMetadata,
  buildAgentRunTraceConfig,
  buildAgentRuntimeTraceConfig,
  configureObservability,
  resolveObservabilityRuntimeConfig
} from "../../src/main/observability"

test("observability defaults to local tracing off", () => {
  const env: Record<string, string | undefined> = {}

  assert.deepEqual(resolveObservabilityRuntimeConfig(env), {
    provider: "local",
    tracingEnabled: false
  })
  assert.deepEqual(env, {})
})

test("LangSmith API key enables LangSmith tracing without agent runtime wiring", () => {
  const env: Record<string, string | undefined> = {
    LANGSMITH_API_KEY: "lsv2-test"
  }
  const logs: string[] = []

  const config = configureObservability({
    env,
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message)
    }
  })

  assert.deepEqual(config, {
    provider: "langsmith",
    tracingEnabled: true
  })
  assert.equal(env.LANGSMITH_TRACING, "true")
  assert.equal(env.LANGSMITH_PROJECT, "jingle-dev")
  assert.match(logs[0] ?? "", /LangSmith tracing enabled/)
})

test("standard LangSmith tracing env enables LangSmith without provider config", () => {
  const env: Record<string, string | undefined> = {
    LANGSMITH_TRACING: "true"
  }

  assert.deepEqual(resolveObservabilityRuntimeConfig(env), {
    provider: "langsmith",
    tracingEnabled: true
  })
})

test("observability ignores unsupported provider env because provider selection is hard-coded", () => {
  const env: Record<string, string | undefined> = {
    JINGLE_OBSERVABILITY_PROVIDER: "unknown"
  }

  const config = configureObservability({
    env,
    logger: {
      info: () => undefined,
      warn: () => undefined
    }
  })

  assert.deepEqual(config, {
    provider: "local",
    tracingEnabled: false
  })
  assert.equal(env.LANGSMITH_TRACING, undefined)
})

test("observability does not use legacy LangChain env aliases as provider signals", () => {
  const env: Record<string, string | undefined> = {
    LANGCHAIN_API_KEY: "legacy-key",
    LANGCHAIN_TRACING_V2: "true",
    LANGCHAIN_TRACING: "true",
    LANGSMITH_TRACING_V2: "true"
  }

  const config = configureObservability({
    env,
    logger: {
      info: () => undefined,
      warn: () => undefined
    }
  })

  assert.deepEqual(config, {
    provider: "local",
    tracingEnabled: false
  })
  assert.equal(env.LANGSMITH_TRACING, undefined)
  assert.equal(env.LANGSMITH_PROJECT, undefined)
})

test("agent trace metadata carries Jingle ids without workspace paths", () => {
  assert.deepEqual(
    buildAgentRunTraceMetadata({
      modelId: "gpt-5",
      permissionMode: "auto",
      runId: "run-1",
      source: "invoke",
      threadId: "thread-1"
    }),
    {
      run_id: "run-1",
      thread_id: "thread-1",
      jingle_run_id: "run-1",
      jingle_thread_id: "thread-1",
      jingle_run_source: "invoke",
      jingle_model_id: "gpt-5",
      jingle_permission_mode: "auto"
    }
  )
})

test("agent run trace config uses LangChain RunnableConfig tracing fields", () => {
  assert.deepEqual(
    buildAgentRunTraceConfig({
      modelId: "gpt-5",
      permissionMode: "auto",
      runId: "run-1",
      source: "resume",
      threadId: "thread-1"
    }),
    {
      runName: "jingle.agent.resume",
      tags: ["jingle", "jingle:resume"],
      metadata: {
        run_id: "run-1",
        thread_id: "thread-1",
        jingle_run_id: "run-1",
        jingle_thread_id: "thread-1",
        jingle_run_source: "resume",
        jingle_model_id: "gpt-5",
        jingle_permission_mode: "auto"
      }
    }
  )
})

test("agent runtime trace config is provider-neutral", () => {
  assert.deepEqual(
    buildAgentRuntimeTraceConfig({
      aiCapabilities: [],
      modelId: "claude-test",
      permissionMode: "ask-to-edit"
    }),
    {
      runName: "jingle.agent",
      metadata: {
        ls_integration: "jingle",
        jingle_model_id: "claude-test",
        jingle_permission_mode: "ask-to-edit"
      }
    }
  )
})

test("dev command env loads local .env without overriding exported env", () => {
  const originalCwd = process.cwd()
  const tempDir = join(tmpdir(), `jingle-observability-${Date.now()}`)
  mkdirSync(tempDir)

  try {
    process.chdir(tempDir)
    writeFileSync(
      ".env",
      [
        "LANGSMITH_API_KEY=from-dotenv",
        "LANGSMITH_PROJECT=from-dotenv-project",
        "LANGSMITH_TRACING=true",
        "UNRELATED_SECRET=from-dotenv"
      ].join("\n")
    )

    const env = createDotenvCommandEnv("development", {
      LANGSMITH_API_KEY: "from-shell"
    })

    assert.equal(env.LANGSMITH_API_KEY, "from-shell")
    assert.equal(env.LANGSMITH_PROJECT, "from-dotenv-project")
    assert.equal(env.LANGSMITH_TRACING, "true")
    assert.equal(env.UNRELATED_SECRET, undefined)
  } finally {
    process.chdir(originalCwd)
    rmSync(tempDir, { force: true, recursive: true })
  }
})
