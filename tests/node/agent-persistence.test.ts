import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { mock } from "node:test"
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint"

const repoRoot = process.cwd()
let openworkHome = ""

async function loadDbModules() {
  const db = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  return { ...db, getPrismaClient }
}

test.before(async () => {
  openworkHome = await mkdtemp(join(tmpdir(), "openwork-agent-persistence-"))
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
  const { closeDatabase, initializeDatabase, getPrismaClient } = await loadDbModules()
  await closeDatabase()
  await initializeDatabase()
  await getPrismaClient().thread.deleteMany()
})

test.after(async () => {
  const { closeDatabase } = await loadDbModules()
  await closeDatabase()
  delete process.env.OPENWORK_HOME

  if (openworkHome) {
    await rm(openworkHome, { force: true, recursive: true })
  }
})

test("resume primitives target the request's run instead of the latest active run", async () => {
  const { createRun, createThread, getHitlRequest, getRun, resolveHitlRequest, upsertHitlRequest } =
    await loadDbModules()
  const { resumeAgentRun } = await import("../../src/main/agent/persistence")

  const threadId = "thread-1"
  const olderRunId = "run-older"
  const latestRunId = "run-latest"

  await createThread(threadId)
  await createRun(olderRunId, threadId, { status: "interrupted" })
  await createRun(latestRunId, threadId, { status: "interrupted" })
  await upsertHitlRequest({
    request_id: "request-older",
    thread_id: threadId,
    run_id: olderRunId,
    tool_call_id: "tool-call-older",
    tool_name: "write_file",
    tool_args: { path: "/tmp/older.txt" },
    allowed_decisions: ["approve", "reject"],
    status: "pending"
  })
  await upsertHitlRequest({
    request_id: "request-latest",
    thread_id: threadId,
    run_id: latestRunId,
    tool_call_id: "tool-call-latest",
    tool_name: "write_file",
    tool_args: { path: "/tmp/latest.txt" },
    allowed_decisions: ["approve", "reject"],
    status: "pending"
  })

  const request = await getHitlRequest("request-older")
  assert.equal(request?.run_id, olderRunId)

  await resumeAgentRun(threadId, request!.run_id!, {
    requestId: request!.request_id,
    source: "resume"
  })
  await resolveHitlRequest(request!.request_id, "approved", {
    request_id: request!.request_id,
    tool_call_id: request!.tool_call_id,
    type: "approve"
  })

  const resumedRun = await getRun(olderRunId)
  const latestRun = await getRun(latestRunId)
  const resolvedRequest = await getHitlRequest("request-older")
  const untouchedRequest = await getHitlRequest("request-latest")

  assert.equal(resumedRun?.status, "running")
  assert.equal(latestRun?.status, "interrupted")
  assert.equal(resolvedRequest?.status, "approved")
  assert.equal(untouchedRequest?.status, "pending")
})

test("agent resume keeps HITL request pending when resumed stream fails before first chunk", async () => {
  const { createRun, createThread, getHitlRequest, upsertHitlRequest } = await loadDbModules()
  const { AgentService } = await import("../../src/main/agent/service")
  const consoleLog = mock.method(console, "log", () => {})
  const consoleError = mock.method(console, "error", () => {})
  const previousRuntimeMode = process.env.OPENWORK_BDD_AGENT_RUNTIME

  const threadId = "thread-resume-failure"
  const runId = "run-resume-failure"
  const requestId = "request-resume-failure"
  await createThread(threadId, { metadata: { workspacePath: repoRoot } })
  await createRun(runId, threadId, { status: "interrupted" })
  await upsertHitlRequest({
    request_id: requestId,
    thread_id: threadId,
    run_id: runId,
    tool_call_id: "tool-call-resume-failure",
    tool_name: "write_file",
    tool_args: { path: `${repoRoot}/approval.txt` },
    allowed_decisions: ["approve", "reject"],
    status: "pending"
  })

  const events: Array<{ type: string }> = []
  process.env.OPENWORK_BDD_AGENT_RUNTIME = "scripted"
  try {
    await new AgentService().resume(
      {
        command: {
          resume: {
            feedback: "bdd:fail-before-first-chunk",
            request_id: requestId,
            tool_call_id: "tool-call-resume-failure",
            type: "approve"
          }
        },
        modelId: "bdd",
        threadId
      },
      {
        send: (event) => events.push({ type: event.type })
      }
    )
  } finally {
    if (previousRuntimeMode === undefined) {
      delete process.env.OPENWORK_BDD_AGENT_RUNTIME
    } else {
      process.env.OPENWORK_BDD_AGENT_RUNTIME = previousRuntimeMode
    }
    consoleError.mock.restore()
    consoleLog.mock.restore()
  }

  const request = await getHitlRequest(requestId)
  assert.equal(request?.status, "pending")
  assert.equal(request?.decision, null)
  assert.deepEqual(
    events.map((event) => event.type),
    ["run_started", "error"]
  )
})

test("run failure preserves interrupted status when pending HITL remains", async () => {
  const { createRun, createThread, getRun, getThread, upsertHitlRequest } = await loadDbModules()
  const { markRunFailed } = await import("../../src/main/agent/persistence")

  const threadId = "thread-failed-with-pending-hitl"
  const runId = "run-failed-with-pending-hitl"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "running" })
  await upsertHitlRequest({
    request_id: "request-still-pending",
    thread_id: threadId,
    run_id: runId,
    tool_call_id: "tool-call-still-pending",
    tool_name: "callExtensionTool",
    tool_args: {
      args: {
        reminderId: "reminder-2"
      },
      extensionName: "apple-reminders",
      toolName: "deleteReminder"
    },
    allowed_decisions: ["approve", "reject"],
    status: "pending"
  })

  await markRunFailed(threadId, runId, new Error("checkpoint write timed out"))

  const run = await getRun(runId)
  const thread = await getThread(threadId)
  const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  assert.equal(run?.status, "interrupted")
  assert.equal(thread?.status, "interrupted")
  assert.equal(metadata.error, "checkpoint write timed out")
})

test("agent run metadata snapshots permission mode and preserves it through resume", async () => {
  const { createThread, getRun } = await loadDbModules()
  const { beginAgentRun, resumeAgentRun } = await import("../../src/main/agent/persistence")
  const { readRunPermissionModeSnapshot } = await import("../../src/main/agent/permission-mode")
  const {
    createRunExtensionAiCapabilitiesSnapshot,
    readRunExtensionAiCapabilitiesSnapshotFromMetadata,
    RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY
  } = await import("../../src/shared/extension-sources")
  const { resolveNativeExtensionAiCapabilitiesForRefs } =
    await import("../../src/extensions/sources")

  const threadId = "thread-permission"
  await createThread(threadId)
  const aiCapabilities = resolveNativeExtensionAiCapabilitiesForRefs(
    [
      {
        extensionName: "apple-reminders",
        name: "Apple Reminders",
        sourceId: "appleReminders",
        type: "extension-source"
      }
    ],
    {
      permissionMode: "auto",
      platform: "darwin"
    }
  )

  const { runId } = await beginAgentRun(threadId, "gpt-test", {
    aiCapabilities,
    permissionMode: "auto"
  })
  const createdRun = await getRun(runId)
  assert.equal(readRunPermissionModeSnapshot(createdRun), "auto")
  const createdMetadata = JSON.parse(createdRun?.metadata ?? "{}") as Record<string, unknown>
  const aiCapabilitiesSnapshot =
    createdMetadata[RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY]
  assert.ok(Array.isArray(aiCapabilitiesSnapshot))
  const [firstSnapshot] = aiCapabilitiesSnapshot as Array<Record<string, unknown>>
  assert.equal(typeof firstSnapshot?.createdAt, "string")
  assert.deepEqual(firstSnapshot?.publicConfigSnapshot, {})
  const expectedAiCapabilitiesSnapshot = createRunExtensionAiCapabilitiesSnapshot({
    aiCapabilities,
    permissionMode: "auto",
    runId
  }).map((snapshot) => ({
    ...snapshot,
    createdAt: firstSnapshot?.createdAt
  }))
  assert.deepEqual(expectedAiCapabilitiesSnapshot, aiCapabilitiesSnapshot)
  assert.deepEqual(
    readRunExtensionAiCapabilitiesSnapshotFromMetadata(createdRun?.metadata),
    aiCapabilitiesSnapshot
  )

  await resumeAgentRun(threadId, runId, {
    requestId: "request-1",
    source: "resume"
  })

  const resumedRun = await getRun(runId)
  assert.equal(readRunPermissionModeSnapshot(resumedRun), "auto")
  assert.deepEqual(
    readRunExtensionAiCapabilitiesSnapshotFromMetadata(resumedRun?.metadata),
    aiCapabilitiesSnapshot
  )
  const resumedMetadata = JSON.parse(resumedRun?.metadata ?? "{}") as Record<string, unknown>
  assert.deepEqual(
    resumedMetadata[RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY],
    aiCapabilitiesSnapshot
  )
  assert.match(resumedRun?.metadata ?? "", /request-1/)
})

test("run metadata updates preserve loaded extension snapshots and resume metadata", async () => {
  const { createThread, getRun } = await loadDbModules()
  const { beginAgentRun, resumeAgentRun, updateRunExtensionAiCapabilitiesSnapshot } =
    await import("../../src/main/agent/persistence")
  const { readRunExtensionAiCapabilitiesSnapshotFromMetadata } =
    await import("../../src/shared/extension-sources")
  const { resolveNativeExtensionAiCapabilitiesForRefs } =
    await import("../../src/extensions/sources")

  const threadId = "thread-extension-metadata-merge"
  await createThread(threadId)

  const { runId } = await beginAgentRun(threadId, "gpt-test", {
    aiCapabilities: [],
    permissionMode: "ask-to-edit"
  })
  const aiCapabilities = resolveNativeExtensionAiCapabilitiesForRefs(
    [
      {
        extensionName: "apple-reminders",
        name: "Apple Reminders",
        sourceId: "appleReminders",
        type: "extension-source"
      }
    ],
    {
      permissionMode: "ask-to-edit",
      platform: "darwin"
    }
  )

  await Promise.all([
    updateRunExtensionAiCapabilitiesSnapshot(runId, {
      aiCapabilities,
      permissionMode: "ask-to-edit"
    }),
    resumeAgentRun(threadId, runId, {
      requestId: "request-loaded-extension",
      source: "resume"
    })
  ])

  const run = await getRun(runId)
  const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  assert.equal(metadata.requestId, "request-loaded-extension")
  assert.equal(metadata.source, "resume")
  assert.deepEqual(
    readRunExtensionAiCapabilitiesSnapshotFromMetadata(run?.metadata)?.map(
      (snapshot) => snapshot.extensionName
    ),
    ["apple-reminders"]
  )
})

test("syncRunFromLatestCheckpoint reads the latest checkpoint for that run only", async () => {
  const { createRun, createThread, getRun } = await loadDbModules()
  const { syncRunFromLatestCheckpoint } = await import("../../src/main/agent/persistence")
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-1"
  const interruptedRunId = "run-interrupted"
  const successRunId = "run-success"

  await createThread(threadId)
  await createRun(interruptedRunId, threadId, { status: "running" })
  await createRun(successRunId, threadId, { status: "running" })

  const interruptedCheckpoint = emptyCheckpoint()
  interruptedCheckpoint.id = "checkpoint-0001"
  interruptedCheckpoint.channel_values = {
    __interrupt__: [
      {
        value: {
          actionRequests: []
        }
      }
    ]
  }

  const successCheckpoint = emptyCheckpoint()
  successCheckpoint.id = "checkpoint-0002"
  successCheckpoint.channel_values = {
    messages: []
  }

  const saver = new PrismaCheckpointSaver()
  await saver.put(
    {
      configurable: {
        thread_id: threadId
      },
      metadata: {
        run_id: interruptedRunId
      }
    },
    interruptedCheckpoint,
    {
      parents: {},
      source: "update",
      step: 0
    }
  )
  await saver.put(
    {
      configurable: {
        thread_id: threadId
      },
      metadata: {
        run_id: successRunId
      }
    },
    successCheckpoint,
    {
      parents: {},
      source: "update",
      step: 1
    }
  )

  const status = await syncRunFromLatestCheckpoint(threadId, interruptedRunId)
  const interruptedRun = await getRun(interruptedRunId)
  const successRun = await getRun(successRunId)

  assert.equal(status, "interrupted")
  assert.equal(interruptedRun?.status, "interrupted")
  assert.equal(successRun?.status, "running")
})

test("syncRunFromLatestCheckpoint copies a generated checkpoint title onto auto-titled threads", async () => {
  const { createRun, createThread, getThread } = await loadDbModules()
  const { syncRunFromLatestCheckpoint } = await import("../../src/main/agent/persistence")
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-title"
  const runId = "run-title"

  await createThread(threadId, {
    metadata: { source: "launcher-ai" },
    title: "快速提问"
  })
  await createRun(runId, threadId, { status: "running" })

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-title"
  checkpoint.channel_values = {
    messages: [
      { type: "human", content: "帮我整理一下这次发布的标题和摘要" },
      { type: "ai", content: "好，开始整理" }
    ],
    title: "发布摘要整理"
  }

  const saver = new PrismaCheckpointSaver()
  await saver.put(
    {
      configurable: {
        thread_id: threadId
      },
      metadata: {
        run_id: runId
      }
    },
    checkpoint,
    {
      parents: {},
      source: "update",
      step: 0
    }
  )

  await syncRunFromLatestCheckpoint(threadId, runId)

  const thread = await getThread(threadId)
  assert.equal(thread?.title, "发布摘要整理")
})

test("syncRunFromLatestCheckpoint preserves manually renamed launcher titles", async () => {
  const { createRun, createThread, getThread } = await loadDbModules()
  const { syncRunFromLatestCheckpoint } = await import("../../src/main/agent/persistence")
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-manual-title"
  const runId = "run-manual-title"

  await createThread(threadId, {
    metadata: { source: "launcher-ai" },
    title: "我改过的标题"
  })
  await createRun(runId, threadId, { status: "running" })

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-manual-title"
  checkpoint.channel_values = {
    messages: [
      { type: "human", content: "帮我整理一下这次发布的标题和摘要" },
      { type: "ai", content: "好，开始整理" }
    ],
    title: "发布摘要整理"
  }

  const saver = new PrismaCheckpointSaver()
  await saver.put(
    {
      configurable: {
        thread_id: threadId
      },
      metadata: {
        run_id: runId
      }
    },
    checkpoint,
    {
      parents: {},
      source: "update",
      step: 0
    }
  )

  await syncRunFromLatestCheckpoint(threadId, runId)

  const thread = await getThread(threadId)
  assert.equal(thread?.title, "我改过的标题")
})

test("thread-scoped checkpoint reads keep run ids out of conversation resume config", async () => {
  const { createRun, createThread } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-1"
  const firstRunId = "run-first"
  const secondRunId = "run-second"

  await createThread(threadId)
  await createRun(firstRunId, threadId, { status: "success" })
  await createRun(secondRunId, threadId, { status: "success" })

  const firstCheckpoint = emptyCheckpoint()
  firstCheckpoint.id = "checkpoint-0001"
  firstCheckpoint.channel_values = {
    messages: [{ type: "human", content: "first question" }]
  }

  const secondCheckpoint = emptyCheckpoint()
  secondCheckpoint.id = "checkpoint-0002"
  secondCheckpoint.channel_values = {
    messages: [
      { type: "human", content: "first question" },
      { type: "ai", content: "first answer" },
      { type: "human", content: "second question" }
    ]
  }

  const saver = new PrismaCheckpointSaver()
  await saver.put(
    {
      configurable: {
        thread_id: threadId
      },
      metadata: {
        run_id: firstRunId
      }
    },
    firstCheckpoint,
    {
      parents: {},
      source: "update",
      step: 0
    }
  )
  await saver.put(
    {
      configurable: {
        thread_id: threadId
      },
      metadata: {
        run_id: secondRunId
      }
    },
    secondCheckpoint,
    {
      parents: {},
      source: "update",
      step: 1
    }
  )

  const latestForThread = await saver.getTuple({
    configurable: {
      thread_id: threadId
    }
  })
  const firstRunScoped = await saver.getTuple({
    configurable: {
      thread_id: threadId,
      run_id: firstRunId
    }
  })

  assert.equal(latestForThread?.checkpoint.id, secondCheckpoint.id)
  assert.equal(latestForThread?.config.configurable?.run_id, undefined)
  assert.equal(firstRunScoped?.checkpoint.id, firstCheckpoint.id)
  assert.equal(firstRunScoped?.config.configurable?.run_id, firstRunId)
})

test("cloneUntilMessage branches from the checkpoint that first contains the target message", async () => {
  const { createRun, createThread, getPrismaClient } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")
  const { ThreadsService } = await import("../../src/main/threads/service")
  const { ArtifactsService } = await import("../../src/main/artifacts/service")
  const { THREAD_PERMISSION_MODE_METADATA_KEY } = await import("../../src/shared/permission-mode")

  const sourceThreadId = "thread-source"
  const firstRunId = "run-first"
  const secondRunId = "run-second"

  await createThread(sourceThreadId, {
    metadata: {
      model: "openai:gpt-test",
      source: "launcher-ai",
      [THREAD_PERMISSION_MODE_METADATA_KEY]: "ask-to-edit",
      visibility: "launcher-ai",
      workspacePath: repoRoot
    },
    title: "Source thread"
  })
  await createRun(firstRunId, sourceThreadId, { status: "success" })
  await createRun(secondRunId, sourceThreadId, { status: "success" })

  const firstCheckpoint = emptyCheckpoint()
  firstCheckpoint.id = "checkpoint-0001"
  firstCheckpoint.channel_values = {
    messages: [
      { kwargs: { content: "first question", id: "message-user-1" }, type: "human" },
      { kwargs: { content: "first answer", id: "message-ai-1" }, type: "ai" }
    ]
  }

  const secondCheckpoint = emptyCheckpoint()
  secondCheckpoint.id = "checkpoint-0002"
  secondCheckpoint.channel_values = {
    messages: [
      { kwargs: { content: "first question", id: "message-user-1" }, type: "human" },
      { kwargs: { content: "first answer", id: "message-ai-1" }, type: "ai" },
      { kwargs: { content: "second question", id: "message-user-2" }, type: "human" }
    ]
  }

  const saver = new PrismaCheckpointSaver()
  const firstConfig = await saver.put(
    {
      configurable: {
        thread_id: sourceThreadId
      },
      metadata: {
        run_id: firstRunId
      }
    },
    firstCheckpoint,
    {
      parents: {},
      source: "update",
      step: 0
    }
  )
  await saver.putWrites(firstConfig, [["messages", { marker: "first-write" }]], "task-first")
  await saver.put(
    {
      configurable: {
        checkpoint_id: firstCheckpoint.id,
        thread_id: sourceThreadId
      },
      metadata: {
        run_id: secondRunId
      }
    },
    secondCheckpoint,
    {
      parents: { "": firstCheckpoint.id },
      source: "update",
      step: 1
    }
  )

  const service = new ThreadsService(
    new ArtifactsService(),
    { getDefaultModel: () => "openai:gpt-test" } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[1],
    { getAgentConfig: () => ({ locale: "en_US" }) } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[2],
    { resolveGlobalWorkspacePath: async () => repoRoot } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[3]
  )
  const clonedThread = await service.cloneUntilMessage(sourceThreadId, "message-ai-1")
  const prisma = getPrismaClient()
  const clonedCheckpointRows = await prisma.checkpoint.findMany({
    orderBy: { checkpointId: "asc" },
    where: { threadId: clonedThread.thread_id }
  })
  const clonedWriteRows = await prisma.checkpointWrite.findMany({
    where: { threadId: clonedThread.thread_id }
  })
  const clonedRunRows = await prisma.run.findMany({
    where: { threadId: clonedThread.thread_id }
  })
  const clonedSearchRows = await prisma.$queryRawUnsafe<Array<{ message_id: string }>>(
    `SELECT message_id FROM "messages_fts" WHERE thread_id = ? ORDER BY message_id`,
    clonedThread.thread_id
  )

  assert.deepEqual(
    clonedCheckpointRows.map((checkpoint) => checkpoint.checkpointId),
    [firstCheckpoint.id]
  )
  assert.deepEqual(
    clonedWriteRows.map((write) => write.checkpointId),
    [firstCheckpoint.id]
  )
  assert.deepEqual(clonedRunRows, [])
  assert.deepEqual(
    clonedSearchRows.map((row) => row.message_id),
    ["message-ai-1", "message-user-1"]
  )
})

test("thread fork rejects threads with pending HITL requests", async () => {
  const { createRun, createThread, upsertHitlRequest } = await loadDbModules()
  const { ThreadsService } = await import("../../src/main/threads/service")
  const { ArtifactsService } = await import("../../src/main/artifacts/service")

  const sourceThreadId = "thread-pending-hitl"
  const runId = "run-pending-hitl"

  await createThread(sourceThreadId, {
    metadata: {
      model: "openai:gpt-test",
      workspacePath: repoRoot
    }
  })
  await createRun(runId, sourceThreadId, { status: "interrupted" })
  await upsertHitlRequest({
    request_id: "request-pending-hitl",
    thread_id: sourceThreadId,
    run_id: runId,
    tool_call_id: "tool-call-pending-hitl",
    tool_name: "write_file",
    tool_args: { path: `${repoRoot}/pending.txt` },
    allowed_decisions: ["approve", "reject"],
    status: "pending"
  })

  const service = new ThreadsService(
    new ArtifactsService(),
    { getDefaultModel: () => "openai:gpt-test" } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[1],
    { getAgentConfig: () => ({ locale: "en_US" }) } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[2],
    { resolveGlobalWorkspacePath: async () => repoRoot } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[3]
  )

  await assert.rejects(
    service.cloneUntilMessage(sourceThreadId, "message-user-1"),
    /Cannot fork a thread while human approval is pending/
  )
  await assert.rejects(
    service.clone(sourceThreadId),
    /Cannot fork a thread while human approval is pending/
  )

  const runtimeState = await service.getRuntimeState(sourceThreadId)
  const history = await service.getHistory(sourceThreadId)
  assert.deepEqual(runtimeState.forkState, {
    canFork: false,
    reason: "pending_hitl"
  })
  assert.deepEqual(history.forkState, runtimeState.forkState)
})

test("thread fork state blocks busy threads", async () => {
  const { createThread, updateThread } = await loadDbModules()
  const { ThreadsService } = await import("../../src/main/threads/service")
  const { ArtifactsService } = await import("../../src/main/artifacts/service")

  const sourceThreadId = "thread-busy-fork-state"

  await createThread(sourceThreadId, {
    metadata: {
      model: "openai:gpt-test",
      workspacePath: repoRoot
    }
  })
  await updateThread(sourceThreadId, {
    status: "busy"
  })

  const service = new ThreadsService(
    new ArtifactsService(),
    { getDefaultModel: () => "openai:gpt-test" } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[1],
    { getAgentConfig: () => ({ locale: "en_US" }) } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[2],
    { resolveGlobalWorkspacePath: async () => repoRoot } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[3]
  )

  const runtimeState = await service.getRuntimeState(sourceThreadId)
  assert.deepEqual(runtimeState.forkState, {
    canFork: false,
    reason: "busy"
  })
  await assert.rejects(service.clone(sourceThreadId), /Cannot fork a thread while it is running/)
})

test("thread fork rejects checkpoints that contain HITL interrupts", async () => {
  const { createRun, createThread, getPrismaClient } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")
  const { ThreadsService } = await import("../../src/main/threads/service")
  const { ArtifactsService } = await import("../../src/main/artifacts/service")

  const sourceThreadId = "thread-interrupt-checkpoint"
  const runId = "run-interrupt-checkpoint"

  await createThread(sourceThreadId, {
    metadata: {
      model: "openai:gpt-test",
      workspacePath: repoRoot
    }
  })
  await createRun(runId, sourceThreadId, { status: "interrupted" })

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-interrupt"
  checkpoint.channel_values = {
    __interrupt__: [
      {
        value: {
          actionRequests: [
            {
              args: { path: `${repoRoot}/pending.txt` },
              name: "write_file",
              toolCallId: "tool-call-interrupt"
            }
          ]
        }
      }
    ],
    messages: [
      { kwargs: { content: "needs approval", id: "message-user-interrupt" }, type: "human" }
    ]
  }

  const saver = new PrismaCheckpointSaver()
  await saver.put(
    {
      configurable: {
        thread_id: sourceThreadId
      },
      metadata: {
        run_id: runId
      }
    },
    checkpoint,
    {
      parents: {},
      source: "update",
      step: 0
    }
  )
  await getPrismaClient().hitlRequest.deleteMany({
    where: {
      threadId: sourceThreadId
    }
  })

  const service = new ThreadsService(
    new ArtifactsService(),
    { getDefaultModel: () => "openai:gpt-test" } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[1],
    { getAgentConfig: () => ({ locale: "en_US" }) } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[2],
    { resolveGlobalWorkspacePath: async () => repoRoot } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[3]
  )

  await assert.rejects(
    service.cloneUntilMessage(sourceThreadId, "message-user-interrupt"),
    /Cannot fork from a message that is waiting for human approval/
  )
  await assert.rejects(
    service.clone(sourceThreadId),
    /Cannot fork from a message that is waiting for human approval/
  )

  const runtimeState = await service.getRuntimeState(sourceThreadId)
  const history = await service.getHistory(sourceThreadId)
  assert.deepEqual(runtimeState.forkState, {
    canFork: false,
    reason: "checkpoint_interrupt"
  })
  assert.deepEqual(history.forkState, runtimeState.forkState)
})
