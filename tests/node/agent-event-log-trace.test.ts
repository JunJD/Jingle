import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages"
import type { Serialized } from "@langchain/core/load/serializable"

const repoRoot = process.cwd()
const originalOpenworkHome = process.env.OPENWORK_HOME
let openworkHome = ""

async function loadDbModules() {
  const db = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  return { ...db, getPrismaClient }
}

function runStartedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: "gpt-test",
    permissionMode: "default",
    source: "invoke",
    userMessageId: "user-message-1",
    ...overrides
  }
}

test.before(async () => {
  openworkHome = await mkdtemp(join(tmpdir(), "openwork-agent-event-log-trace-"))
  process.env.OPENWORK_HOME = openworkHome

  execFileSync("node", ["scripts/run-prisma-openwork-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENWORK_HOME: openworkHome
    }
  })
})

test.beforeEach(async () => {
  const { closeDatabase, flushAgentTraceProjection, getPrismaClient, initializeDatabase } =
    await loadDbModules()
  await flushAgentTraceProjection()
  await closeDatabase()
  await initializeDatabase()
  await getPrismaClient().thread.deleteMany()
})

test.after(async () => {
  const { closeDatabase, flushAgentTraceProjection } = await loadDbModules()
  await flushAgentTraceProjection()
  await closeDatabase()

  if (originalOpenworkHome === undefined) {
    delete process.env.OPENWORK_HOME
  } else {
    process.env.OPENWORK_HOME = originalOpenworkHome
  }

  if (openworkHome) {
    await rm(openworkHome, { force: true, recursive: true })
  }
})

test("agent event recorder assigns aggregate seq per run", async () => {
  const { appendAgentEvent, createRun, createThread, getPrismaClient } = await loadDbModules()
  const threadId = "thread-event-seq"
  const runId = "run-event-seq"

  await createThread(threadId)
  await createRun(runId, threadId)

  const first = await appendAgentEvent({
    payload: runStartedPayload(),
    runId,
    threadId,
    type: "run.started"
  })
  const second = await appendAgentEvent({
    payload: { status: "success" },
    runId,
    threadId,
    type: "run.finished"
  })
  await getPrismaClient().run.update({
    data: {
      status: "success"
    },
    where: {
      runId
    }
  })

  assert.equal(first.seq, 1)
  assert.equal(second.seq, 2)

  const sequence = await getPrismaClient().agentEventSequence.findUnique({
    where: {
      aggregateId: runId
    }
  })
  assert.equal(sequence?.seq, 2)
})

test("database initialization enables WAL journal mode", async () => {
  const { getPrismaClient } = await loadDbModules()
  const rows = (await getPrismaClient().$queryRawUnsafe("PRAGMA journal_mode")) as Array<{
    journal_mode: string
  }>

  assert.equal(rows[0]?.journal_mode.toLowerCase(), "wal")
})

test("trace projection waits for an explicit flush after event bursts", async () => {
  const {
    appendAgentEvent,
    createRun,
    createThread,
    flushAgentTraceProjection,
    getAgentTrace,
    getPrismaClient
  } = await loadDbModules()
  const threadId = "thread-projection-burst"
  const runId = "run-projection-burst"

  await createThread(threadId)
  await createRun(runId, threadId)

  await appendAgentEvent({
    payload: runStartedPayload(),
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    payload: {
      extraParams: {},
      input: { prompt: "hello" },
      llmRunId: "llm-run-projection-burst",
      messagesBaseline: [],
      model: "gpt-test",
      provider: "openai",
      runName: null
    },
    runId,
    threadId,
    type: "llm.input.captured"
  })
  await appendAgentEvent({
    payload: {
      completionReason: "done",
      errorMessage: null,
      errorType: null,
      status: "success"
    },
    runId,
    threadId,
    type: "run.finished"
  })
  await getPrismaClient().run.update({
    data: {
      status: "success"
    },
    where: {
      runId
    }
  })

  assert.equal(await getAgentTrace(runId), null)

  await flushAgentTraceProjection()

  const trace = await getAgentTrace(runId)
  assert.equal(trace?.status, "completed")
  assert.equal(trace?.projected_through_seq, 3)
  assert.equal(trace?.total_steps, 1)
})

test("trace projection does not auto-run for dirty non-terminal events", async () => {
  const { appendAgentEvent, createRun, createThread, getAgentTrace } = await loadDbModules()
  const threadId = "thread-projection-dirty"
  const runId = "run-projection-dirty"

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: runStartedPayload(),
    runId,
    threadId,
    type: "run.started"
  })
  await delay(650)

  assert.equal(await getAgentTrace(runId), null)
})

test("run finished schedules trace projection", async () => {
  const { createRun, createThread, getAgentTrace } = await loadDbModules()
  const { recordRunFinished, recordRunStarted } = await import(
    "../../src/main/agent/event-recorder"
  )
  const threadId = "thread-projection-finished"
  const runId = "run-projection-finished"

  await createThread(threadId)
  await createRun(runId, threadId)
  await recordRunStarted({
    modelId: "gpt-test",
    permissionMode: "default",
    runId,
    threadId,
    userMessageId: "user-message-1"
  })
  await recordRunFinished({
    completionReason: "done",
    runId,
    status: "success",
    threadId
  })
  await delay(650)

  const trace = await getAgentTrace(runId)
  assert.equal(trace?.status, "completed")
  assert.equal(trace?.projected_through_seq, 2)
})

test("trace projector updates run summary from lifecycle events without runtime steps", async () => {
  const {
    appendAgentEvent,
    createRun,
    createThread,
    flushAgentTraceProjection,
    getAgentTrace,
    getAgentTraceSteps,
    getPrismaClient
  } = await loadDbModules()
  const threadId = "thread-runtime-summary"
  const runId = "run-runtime-summary"

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: runStartedPayload(),
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    payload: {
      completionReason: "done",
      errorMessage: null,
      errorType: null,
      status: "success"
    },
    runId,
    threadId,
    type: "run.finished"
  })
  await getPrismaClient().run.update({
    data: {
      status: "success"
    },
    where: {
      runId
    }
  })
  await flushAgentTraceProjection()

  const trace = await getAgentTrace(runId)
  const steps = await getAgentTraceSteps(runId)

  assert.equal(trace?.status, "completed")
  assert.equal(trace?.model, "gpt-test")
  assert.equal(trace?.completion_reason, "done")
  assert.equal(trace?.completed_at !== null, true)
  assert.equal(trace?.total_steps, 0)
  assert.deepEqual(steps, [])
})

test("trace projector keeps checkpoint commits in raw events only", async () => {
  const {
    appendAgentEvent,
    createRun,
    createThread,
    flushAgentTraceProjection,
    getAgentTrace,
    getAgentTraceEvents,
    getAgentTraceSteps
  } = await loadDbModules()
  const threadId = "thread-checkpoint-raw"
  const runId = "run-checkpoint-raw"

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: runStartedPayload(),
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    checkpointId: "checkpoint-1",
    payload: {
      checkpointId: "checkpoint-1",
      checkpointNs: "",
      metadataSource: "loop",
      step: 4
    },
    runId,
    threadId,
    type: "checkpoint.committed"
  })
  await flushAgentTraceProjection()

  const trace = await getAgentTrace(runId)
  const steps = await getAgentTraceSteps(runId)
  const events = await getAgentTraceEvents(runId)

  assert.equal(trace?.total_steps, 0)
  assert.deepEqual(steps, [])
  assert.deepEqual(
    events.map((event) => event.type),
    ["run.started", "checkpoint.committed"]
  )
})

test("trace projector writes running partial trace from durable events", async () => {
  const {
    appendAgentEvent,
    createRun,
    createThread,
    flushAgentTraceProjection,
    getAgentTrace,
    getAgentTraceSteps,
    getPrismaClient
  } = await loadDbModules()
  const threadId = "thread-partial-trace"
  const runId = "run-partial-trace"

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: runStartedPayload(),
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    payload: {
      inputTokens: 12,
      llmRunId: "llm-run-partial",
      model: "gpt-test",
      output: "partial answer",
      outputTokens: 4,
      totalTokens: 16
    },
    runId,
    threadId,
    type: "llm.output.captured"
  })
  await getPrismaClient().run.update({
    data: {
      status: "interrupted"
    },
    where: {
      runId
    }
  })
  await flushAgentTraceProjection()

  const trace = await getAgentTrace(runId)
  const steps = await getAgentTraceSteps(runId)

  assert.equal(trace?.status, "running")
  assert.equal(trace?.model, "gpt-test")
  assert.equal(trace?.total_tokens, 16)
  assert.equal(trace?.total_steps, 1)
  assert.equal(steps.length, 1)
  assert.equal(steps[0]?.step_type, "call_llm")
  assert.equal(steps[0]?.total_tokens, 16)
})

test("trace projector merges llm input and output into one call_llm step", async () => {
  const {
    appendAgentEvent,
    createRun,
    createThread,
    flushAgentTraceProjection,
    getAgentTrace,
    getAgentTraceBlob,
    getAgentTraceSteps,
    getPrismaClient
  } = await loadDbModules()
  const threadId = "thread-llm-merge"
  const runId = "run-llm-merge"

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: runStartedPayload(),
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    payload: {
      extraParams: {},
      input: { prompt: "hello" },
      llmRunId: "llm-run-merge",
      messagesBaseline: [{ role: "user", content: "hello" }],
      messagesDelta: [],
      model: "gpt-test",
      provider: "openai",
      runName: null
    },
    runId,
    threadId,
    type: "llm.input.captured"
  })
  await appendAgentEvent({
    payload: {
      inputTokens: 5,
      llmRunId: "llm-run-merge",
      model: "gpt-test",
      output: "answer",
      outputTokens: 7,
      totalTokens: 12
    },
    runId,
    threadId,
    type: "llm.output.captured"
  })
  await getPrismaClient().run.update({
    data: {
      status: "interrupted"
    },
    where: {
      runId
    }
  })
  await flushAgentTraceProjection()

  const trace = await getAgentTrace(runId)
  const steps = await getAgentTraceSteps(runId)

  assert.equal(trace?.total_steps, 1)
  assert.equal(steps.length, 1)
  const step = steps[0]!
  assert.equal(step.step_index, 0)
  assert.equal(step.step_type, "call_llm")
  assert.equal(step.status, "completed")
  assert.equal(step.input_tokens, 5)
  assert.equal(step.output_tokens, 7)
  assert.equal(step.total_tokens, 12)
  assert.ok(step.input_blob_id)
  assert.ok(step.output_blob_id)

  const inputBlob = await getAgentTraceBlob(step.input_blob_id)
  const outputBlob = await getAgentTraceBlob(step.output_blob_id)
  assert.equal(inputBlob?.kind, "llm_input")
  assert.equal(outputBlob?.kind, "llm_output")
})

test("trace projector records failed trace with error summary", async () => {
  const {
    appendAgentEvent,
    createRun,
    createThread,
    flushAgentTraceProjection,
    getAgentTrace,
    getPrismaClient
  } = await loadDbModules()
  const threadId = "thread-failed-trace"
  const runId = "run-failed-trace"

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: runStartedPayload(),
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    payload: {
      errorMessage: "model auth failed",
      errorType: "UNAUTHENTICATED",
      status: "error"
    },
    runId,
    threadId,
    type: "run.finished"
  })
  await getPrismaClient().run.update({
    data: {
      status: "error"
    },
    where: {
      runId
    }
  })
  await flushAgentTraceProjection()

  const trace = await getAgentTrace(runId)

  assert.equal(trace?.status, "failed")
  assert.equal(trace?.error_type, "UNAUTHENTICATED")
  assert.equal(trace?.error_message, "model auth failed")
  assert.equal(trace?.completed_at !== null, true)
})

test("trace projector stores tool output blob and links it to tool step", async () => {
  const {
    appendAgentEvent,
    createRun,
    createThread,
    flushAgentTraceProjection,
    getAgentTraceBlob,
    getAgentTraceSteps,
    getPrismaClient
  } = await loadDbModules()
  const threadId = "thread-tool-blob"
  const runId = "run-tool-blob"
  const output = "tool output ".repeat(100)

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: runStartedPayload(),
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    payload: {
      args: { cmd: "pwd" },
      messageId: "assistant-tool",
      toolCallId: "tool-call-1",
      toolName: "execute_command"
    },
    runId,
    threadId,
    type: "tool.call.started"
  })
  await appendAgentEvent({
    payload: {
      messageId: "tool-message-1",
      output,
      status: "completed",
      toolCallId: "tool-call-1",
      toolName: "execute_command"
    },
    runId,
    threadId,
    type: "tool.call.completed"
  })
  await getPrismaClient().run.update({
    data: {
      status: "success"
    },
    where: {
      runId
    }
  })
  await flushAgentTraceProjection()

  const steps = await getAgentTraceSteps(runId)
  assert.equal(steps.length, 1)
  const toolStep = steps[0]
  assert.equal(toolStep?.step_index, 0)
  assert.equal(toolStep?.step_type, "call_tool")
  assert.equal(toolStep?.tool_name, "execute_command")
  assert.equal(toolStep?.status, "completed")
  assert.ok(toolStep?.output_blob_id)

  const blob = await getAgentTraceBlob(toolStep!.output_blob_id)
  assert.equal(blob?.kind, "tool_output")
  assert.equal(blob?.value, output)
})

test("trace projector keeps approval wait and resolution as one timeline step", async () => {
  const {
    appendAgentEvent,
    createRun,
    createThread,
    flushAgentTraceProjection,
    getAgentTrace,
    getAgentTraceSteps
  } = await loadDbModules()
  const threadId = "thread-approval-step"
  const runId = "run-approval-step"

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: runStartedPayload(),
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    payload: {
      allowedDecisions: ["approve", "deny"],
      requestId: "approval-1",
      review: null,
      toolArgs: { cmd: "touch file.txt" },
      toolCallId: "tool-call-approval",
      toolName: "execute_command"
    },
    runId,
    threadId,
    type: "approval.requested"
  })
  await appendAgentEvent({
    payload: {
      decision: "approve",
      feedback: null,
      requestId: "approval-1",
      toolCallId: "tool-call-approval"
    },
    runId,
    threadId,
    type: "approval.resolved"
  })
  await flushAgentTraceProjection()

  const trace = await getAgentTrace(runId)
  const steps = await getAgentTraceSteps(runId)

  assert.equal(trace?.status, "running")
  assert.equal(trace?.total_steps, 1)
  assert.equal(steps.length, 1)
  const approvalStep = steps[0]!
  assert.equal(approvalStep.step_type, "approval")
  assert.equal(approvalStep.status, "completed")
  assert.equal(approvalStep.tool_name, "execute_command")
  assert.equal(approvalStep.tool_call_id, "tool-call-approval")
})

test("trace CLI default timeline hides raw runtime and checkpoint events", async () => {
  const { appendAgentEvent, createRun, createThread, flushAgentTraceProjection, getPrismaClient } =
    await loadDbModules()
  const threadId = "thread-cli-step-boundary"
  const runId = "run-cli-step-boundary"
  const cliDir = await mkdtemp(join(tmpdir(), "openwork-jl-cli-"))

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: runStartedPayload(),
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    checkpointId: "checkpoint-cli",
    payload: {
      checkpointId: "checkpoint-cli",
      checkpointNs: "",
      metadataSource: "loop",
      step: 1
    },
    runId,
    threadId,
    type: "checkpoint.committed"
  })
  await appendAgentEvent({
    payload: {
      inputTokens: 2,
      llmRunId: "llm-run-cli",
      model: "gpt-test",
      output: "cli answer",
      outputTokens: 3,
      totalTokens: 5
    },
    runId,
    threadId,
    type: "llm.output.captured"
  })
  await appendAgentEvent({
    payload: {
      completionReason: "done",
      errorMessage: null,
      errorType: null,
      status: "success"
    },
    runId,
    threadId,
    type: "run.finished"
  })
  await getPrismaClient().run.update({
    data: {
      status: "success"
    },
    where: {
      runId
    }
  })
  await flushAgentTraceProjection()

  try {
    const jlPath = join(cliDir, "jl")
    await symlink(join(repoRoot, "bin/cli.js"), jlPath)
    const cliEnv = {
      ...process.env,
      OPENWORK_HOME: openworkHome
    }

    const timeline = execFileSync("node", [jlPath, "trace", "inspect", runId], {
      cwd: repoRoot,
      encoding: "utf8",
      env: cliEnv
    })
    assert.match(timeline, /Agent Operation/)
    assert.match(timeline, /Step 0\s+\[call_llm\]/)
    assert.match(timeline, /LLM\s+in:2 out:3 tokens/)
    assert.match(timeline, /done\s+tokens=5/)
    assert.doesNotMatch(timeline, /\bcheckpoint\b/)
    assert.doesNotMatch(timeline, /\bruntime\b/)

    const events = execFileSync("node", [jlPath, "trace", "inspect", runId, "--events"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: cliEnv
    })
    assert.match(events, /run\.started/)
    assert.match(events, /checkpoint\.committed/)
    assert.match(events, /run\.finished/)
  } finally {
    await rm(cliDir, { force: true, recursive: true })
  }
})

test("trace projector rebuilds messages from baseline and delta blobs", async () => {
  const {
    appendAgentEvent,
    createRun,
    createThread,
    flushAgentTraceProjection,
    getAgentTraceSteps,
    getPrismaClient,
    rebuildTraceStepMessages
  } = await loadDbModules()
  const threadId = "thread-messages-delta"
  const runId = "run-messages-delta"
  const baseline = [{ role: "system", content: "base" }]
  const delta = [{ role: "user", content: "hello" }]

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: runStartedPayload(),
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    payload: {
      extraParams: {},
      input: { prompt: "hello" },
      llmRunId: "llm-run-delta",
      messagesBaseline: baseline,
      messagesDelta: delta,
      model: null,
      provider: null,
      runName: null
    },
    runId,
    threadId,
    type: "llm.input.captured"
  })
  await getPrismaClient().run.update({
    data: {
      status: "interrupted"
    },
    where: {
      runId
    }
  })
  await flushAgentTraceProjection()

  const llmStep = (await getAgentTraceSteps(runId)).find((step) => step.step_type === "call_llm")
  assert.ok(llmStep?.messages_baseline_blob_id)
  assert.ok(llmStep?.messages_delta_blob_id)

  const messages = await rebuildTraceStepMessages(runId, llmStep!.step_index)
  assert.deepEqual(messages, [...baseline, ...delta])
})

test("local trace callback captures chat model input as a trace blob", async () => {
  const {
    createRun,
    createThread,
    getAgentTraceBlob,
    getAgentTraceEvents,
    getAgentTraceSteps,
    getPrismaClient,
    projectAgentTraceForRun
  } = await loadDbModules()
  const { createLocalAgentTraceCallback } =
    await import("../../src/main/observability/local-agent-trace-callback")
  const threadId = "thread-llm-callback"
  const runId = "run-llm-callback"
  const callback = createLocalAgentTraceCallback({
    modelId: "gpt-test",
    runId,
    threadId
  })
  const llm = {
    id: ["openwork", "test-model"],
    kwargs: {},
    lc: 1,
    name: "test-model",
    type: "constructor"
  } satisfies Serialized

  await createThread(threadId)
  await createRun(runId, threadId)
  await callback.handleChatModelStart?.(
    llm,
    [[new HumanMessage({ content: "actual model input", id: "user-1" })]],
    "llm-run-1"
  )
  await getPrismaClient().run.update({
    data: {
      status: "interrupted"
    },
    where: {
      runId
    }
  })

  const events = await getAgentTraceEvents(runId)
  assert.deepEqual(
    events.map((event) => event.type),
    ["llm.input.captured"]
  )
  const llmInputPayload = JSON.parse(events[0]!.payload) as Record<string, unknown>
  assert.equal(llmInputPayload.llmRunId, "llm-run-1")

  await projectAgentTraceForRun(runId)

  const trace = await getPrismaClient().agentTrace.findUnique({ where: { traceId: runId } })
  assert.equal(trace?.projectionError, null)
  assert.equal(trace?.totalSteps, 1)

  const llmStep = (await getAgentTraceSteps(runId)).find((step) => step.step_type === "call_llm")
  assert.equal(llmStep?.status, "running")
  assert.ok(llmStep?.input_blob_id)

  const blob = await getAgentTraceBlob(llmStep!.input_blob_id)
  assert.match(blob?.value ?? "", /actual model input/)
})

test("local trace callback does not capture title generation runs", async () => {
  const { createRun, createThread, getAgentTraceEvents } = await loadDbModules()
  const { createLocalAgentTraceCallback } =
    await import("../../src/main/observability/local-agent-trace-callback")
  const threadId = "thread-title-generation-callback"
  const runId = "run-title-generation-callback"
  const callback = createLocalAgentTraceCallback({
    modelId: "gpt-test",
    runId,
    threadId
  })
  const llm = {
    id: ["openwork", "test-model"],
    kwargs: {},
    lc: 1,
    name: "test-model",
    type: "constructor"
  } satisfies Serialized

  await createThread(threadId)
  await createRun(runId, threadId)
  await callback.handleChatModelStart?.(
    llm,
    [[new HumanMessage({ content: "Generate a title", id: "title-user-1" })]],
    "llm-run-title",
    undefined,
    undefined,
    undefined,
    undefined,
    "thread_title"
  )
  await callback.handleLLMEnd?.(
    {
      generations: [[{ generationInfo: {}, text: "Current doc agent search" }]],
      llmOutput: {
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15
        }
      }
    },
    "llm-run-title"
  )

  assert.deepEqual(await getAgentTraceEvents(runId), [])
})

test("stream boundary recorder keeps assistant completion separate from LLM output facts", async () => {
  const { createRun, createThread, flushAgentTraceProjection, getAgentTraceEvents } =
    await loadDbModules()
  const { createAgentStreamBoundaryRecorderState, recordAgentStreamBoundaryEvents } =
    await import("../../src/main/agent/event-recorder")
  const threadId = "thread-stream-boundary"
  const runId = "run-stream-boundary"

  await createThread(threadId)
  await createRun(runId, threadId)
  await recordAgentStreamBoundaryEvents({
    data: [
      {
        id: ["langchain_core", "messages", "AIMessageChunk"],
        kwargs: {
          content: "done",
          id: "assistant-stream-1",
          usage_metadata: {
            input_tokens: 2,
            output_tokens: 3,
            total_tokens: 5
          }
        }
      }
    ],
    mode: "messages",
    modelId: "gpt-test",
    runId,
    state: createAgentStreamBoundaryRecorderState(),
    threadId
  })
  await flushAgentTraceProjection()

  const eventTypes = (await getAgentTraceEvents(runId)).map((event) => event.type)
  assert.deepEqual(eventTypes, ["message.assistant.started", "message.assistant.completed"])
  assert.equal(eventTypes.includes("llm.output.captured"), false)
})

test("stream boundary recorder records tool call chunks as started tool events", async () => {
  const { createRun, createThread, flushAgentTraceProjection, getAgentTraceEvents } =
    await loadDbModules()
  const { createAgentStreamBoundaryRecorderState, recordAgentStreamBoundaryEvents } =
    await import("../../src/main/agent/event-recorder")
  const threadId = "thread-stream-tool-chunks"
  const runId = "run-stream-tool-chunks"
  const state = createAgentStreamBoundaryRecorderState()

  await createThread(threadId)
  await createRun(runId, threadId)
  await recordAgentStreamBoundaryEvents({
    data: [
      {
        id: ["langchain_core", "messages", "AIMessageChunk"],
        kwargs: {
          content: "",
          id: "assistant-stream-tool",
          tool_call_chunks: [
            {
              args: '{"path":"src/',
              id: "tool-call-chunk-1",
              index: 0,
              name: "read_file",
              type: "tool_call_chunk"
            }
          ]
        }
      }
    ],
    mode: "messages",
    modelId: "gpt-test",
    runId,
    state,
    threadId
  })
  await recordAgentStreamBoundaryEvents({
    data: [
      {
        id: ["langchain_core", "messages", "AIMessageChunk"],
        kwargs: {
          content: "",
          id: "assistant-stream-tool",
          tool_call_chunks: [
            {
              args: 'renderer.tsx"}',
              id: "tool-call-chunk-1",
              index: 0,
              type: "tool_call_chunk"
            }
          ]
        }
      }
    ],
    mode: "messages",
    modelId: "gpt-test",
    runId,
    state,
    threadId
  })
  await flushAgentTraceProjection()

  const events = await getAgentTraceEvents(runId)
  assert.deepEqual(
    events.map((event) => event.type),
    ["message.assistant.started", "tool.call.started"]
  )
  const toolStartedPayload = JSON.parse(events[1]!.payload) as Record<string, unknown>
  assert.equal(toolStartedPayload.args, '{"path":"src/')
  assert.equal(toolStartedPayload.messageId, "assistant-stream-tool")
  assert.equal(toolStartedPayload.toolCallId, "tool-call-chunk-1")
  assert.equal(toolStartedPayload.toolName, "read_file")
})

test("stream boundary recorder records finalized values tool calls and results", async () => {
  const {
    createRun,
    createThread,
    flushAgentTraceProjection,
    getAgentTraceEvents,
    getAgentTraceSteps
  } = await loadDbModules()
  const { createAgentStreamBoundaryRecorderState, recordAgentStreamBoundaryEvents } =
    await import("../../src/main/agent/event-recorder")
  const threadId = "thread-values-tool-events"
  const runId = "run-values-tool-events"
  const state = createAgentStreamBoundaryRecorderState()

  await createThread(threadId)
  await createRun(runId, threadId)
  await recordAgentStreamBoundaryEvents({
    data: {
      messages: [
        {
          id: ["HumanMessage"],
          kwargs: {
            content: "read package",
            id: "user-1"
          },
          type: "human"
        },
        {
          id: ["AIMessage"],
          kwargs: {
            content: '{"file_path":"package.json"}',
            id: "assistant-values-tool",
            tool_calls: [
              {
                args: {
                  file_path: "package.json"
                },
                id: "tool-call-values-1",
                name: "read_file",
                type: "tool_call"
              }
            ]
          },
          type: "ai"
        },
        {
          id: ["ToolMessage"],
          kwargs: {
            content: "package contents",
            id: "tool-result-values-1",
            name: "read_file",
            tool_call_id: "tool-call-values-1"
          },
          type: "tool"
        }
      ]
    },
    mode: "values",
    modelId: "gpt-test",
    runId,
    state,
    threadId
  })
  await recordAgentStreamBoundaryEvents({
    data: {
      messages: [
        {
          id: ["AIMessage"],
          kwargs: {
            content: '{"file_path":"package.json"}',
            id: "assistant-values-tool",
            tool_calls: [
              {
                args: {
                  file_path: "package.json"
                },
                id: "tool-call-values-1",
                name: "read_file",
                type: "tool_call"
              }
            ]
          },
          type: "ai"
        },
        {
          id: ["ToolMessage"],
          kwargs: {
            content: "package contents",
            id: "tool-result-values-1",
            name: "read_file",
            tool_call_id: "tool-call-values-1"
          },
          type: "tool"
        }
      ]
    },
    mode: "values",
    modelId: "gpt-test",
    runId,
    state,
    threadId
  })
  await flushAgentTraceProjection()

  const events = await getAgentTraceEvents(runId)
  assert.deepEqual(
    events.map((event) => event.type),
    ["tool.call.started", "tool.call.completed"]
  )

  const toolStartedPayload = JSON.parse(events[0]!.payload) as Record<string, unknown>
  assert.equal(toolStartedPayload.messageId, "assistant-values-tool")
  assert.equal(toolStartedPayload.toolCallId, "tool-call-values-1")
  assert.equal(toolStartedPayload.toolName, "read_file")

  const toolCompletedPayload = JSON.parse(events[1]!.payload) as Record<string, unknown>
  assert.equal(toolCompletedPayload.messageId, "tool-result-values-1")
  assert.equal(toolCompletedPayload.toolCallId, "tool-call-values-1")
  assert.equal(toolCompletedPayload.toolName, "read_file")

  const steps = await getAgentTraceSteps(runId)
  assert.equal(steps.length, 1)
  assert.equal(steps[0]?.step_type, "call_tool")
  assert.equal(steps[0]?.tool_name, "read_file")
  assert.equal(steps[0]?.status, "completed")
})

test("stream boundary recorder records IPC serialized LangChain tool calls", async () => {
  const {
    createRun,
    createThread,
    flushAgentTraceProjection,
    getAgentTrace,
    getAgentTraceEvents,
    getAgentTraceSteps
  } = await loadDbModules()
  const { createAgentStreamBoundaryRecorderState, recordAgentStreamBoundaryEvents } =
    await import("../../src/main/agent/event-recorder")
  const threadId = "thread-ipc-serialized-tool-events"
  const runId = "run-ipc-serialized-tool-events"
  const state = createAgentStreamBoundaryRecorderState()
  const assistant = new AIMessage({
    content: "",
    id: "assistant-ipc-tool",
    tool_calls: [
      {
        args: {
          args: {
            query: "agent"
          },
          extensionName: "notion",
          toolName: "searchPages"
        },
        id: "tool-call-ipc-1",
        name: "callExtension",
        type: "tool_call"
      }
    ]
  })
  const toolResult = new ToolMessage({
    content: "notion search output",
    id: "tool-result-ipc-1",
    name: "callExtension",
    tool_call_id: "tool-call-ipc-1"
  })

  await createThread(threadId)
  await createRun(runId, threadId)
  await recordAgentStreamBoundaryEvents({
    data: JSON.parse(JSON.stringify([assistant, {}])),
    mode: "messages",
    modelId: "gpt-test",
    runId,
    state,
    threadId
  })
  await recordAgentStreamBoundaryEvents({
    data: JSON.parse(JSON.stringify([toolResult, {}])),
    mode: "messages",
    modelId: "gpt-test",
    runId,
    state,
    threadId
  })
  await flushAgentTraceProjection()

  const events = await getAgentTraceEvents(runId)
  assert.deepEqual(
    events.map((event) => event.type),
    ["message.assistant.started", "tool.call.started", "tool.call.completed"]
  )
  const toolStartedPayload = JSON.parse(events[1]!.payload) as Record<string, unknown>
  assert.equal(toolStartedPayload.messageId, "assistant-ipc-tool")
  assert.equal(toolStartedPayload.toolCallId, "tool-call-ipc-1")
  assert.equal(toolStartedPayload.toolName, "callExtension")
  assert.deepEqual(toolStartedPayload.args, {
    args: {
      query: "agent"
    },
    extensionName: "notion",
    toolName: "searchPages"
  })

  const trace = await getAgentTrace(runId)
  const steps = await getAgentTraceSteps(runId)
  assert.equal(trace?.total_steps, 1)
  assert.equal(steps.length, 1)
  assert.equal(steps[0]?.step_type, "call_tool")
  assert.equal(steps[0]?.tool_name, "callExtension")
  assert.equal(steps[0]?.tool_call_id, "tool-call-ipc-1")
})

test("stream boundary recorder skips partial OpenAI-style tool call arguments", async () => {
  const { createRun, createThread, flushAgentTraceProjection, getAgentTraceEvents } =
    await loadDbModules()
  const { createAgentStreamBoundaryRecorderState, recordAgentStreamBoundaryEvents } =
    await import("../../src/main/agent/event-recorder")
  const threadId = "thread-openai-partial-tool-events"
  const runId = "run-openai-partial-tool-events"
  const state = createAgentStreamBoundaryRecorderState()

  await createThread(threadId)
  await createRun(runId, threadId)
  await recordAgentStreamBoundaryEvents({
    data: [
      {
        id: ["langchain_core", "messages", "AIMessageChunk"],
        kwargs: {
          additional_kwargs: {
            tool_calls: [
              {
                function: {
                  arguments: '{"path":"src/',
                  name: "read_file"
                },
                id: "tool-call-openai-partial-1",
                type: "function"
              }
            ]
          },
          content: "",
          id: "assistant-openai-partial-tool"
        },
        type: "ai"
      },
      {}
    ],
    mode: "messages",
    modelId: "gpt-test",
    runId,
    state,
    threadId
  })
  await flushAgentTraceProjection()

  const events = await getAgentTraceEvents(runId)
  assert.deepEqual(
    events.map((event) => event.type),
    ["message.assistant.started"]
  )
})

test("stream boundary recorder skips nameless OpenAI-style tool calls", async () => {
  const { createRun, createThread, flushAgentTraceProjection, getAgentTraceEvents } =
    await loadDbModules()
  const { createAgentStreamBoundaryRecorderState, recordAgentStreamBoundaryEvents } =
    await import("../../src/main/agent/event-recorder")
  const threadId = "thread-openai-nameless-tool-events"
  const runId = "run-openai-nameless-tool-events"
  const state = createAgentStreamBoundaryRecorderState()

  await createThread(threadId)
  await createRun(runId, threadId)
  await recordAgentStreamBoundaryEvents({
    data: [
      {
        id: ["langchain_core", "messages", "AIMessageChunk"],
        kwargs: {
          additional_kwargs: {
            tool_calls: [
              {
                function: {
                  arguments: '{"path":"README.md"}'
                },
                id: "tool-call-openai-nameless-1",
                type: "function"
              }
            ]
          },
          content: "",
          id: "assistant-openai-nameless-tool"
        },
        type: "ai"
      },
      {}
    ],
    mode: "messages",
    modelId: "gpt-test",
    runId,
    state,
    threadId
  })
  await flushAgentTraceProjection()

  const events = await getAgentTraceEvents(runId)
  assert.deepEqual(
    events.map((event) => event.type),
    ["message.assistant.started"]
  )
})
