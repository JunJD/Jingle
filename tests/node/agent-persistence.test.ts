import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { mock } from "node:test"
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint"
import type { SerializerProtocol } from "@langchain/langgraph-checkpoint"
import { appleRemindersManifest } from "../../installable-extensions/apple-reminders/manifest"
import { appleRemindersMain } from "../../installable-extensions/apple-reminders/main"
import type { AgentService, AgentStreamPayload } from "../../src/main/agent/service"
import {
  AGENT_RUN_FAILURE_METADATA_KEY,
  parseAgentRunFailure,
  type AgentRunFailureTerminalFact
} from "../../src/shared/agent-run-failure"
import { toAgentRunFailure } from "../../src/main/agent/errors"
import { ExtensionMainDefinitionRegistry } from "../../src/main/extensions/registry/main-definition-registry"
import type { ExtensionMainRef } from "../../src/main/extensions/registry/types"
import { ThreadsService } from "../../src/main/threads/service"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

async function loadDbModules() {
  const db = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  return { ...db, getPrismaClient }
}

async function bindThreadWorkspace(threadId: string, workspacePath: string): Promise<void> {
  const { ThreadWorkspaceRepository } = await import("../../src/main/thread-workspace/repository")
  const { ThreadWorkspaceService } = await import("../../src/main/thread-workspace/service")
  await new ThreadWorkspaceService(new ThreadWorkspaceRepository()).bindProject(
    threadId,
    workspacePath
  )
}

async function createWorkspaceServiceForTest() {
  const { JingleMemoryService } = await import("../../src/main/jingle-memory/service")
  const { ThreadWorkspaceRepository } = await import("../../src/main/thread-workspace/repository")
  const { ThreadWorkspaceService } = await import("../../src/main/thread-workspace/service")
  const { WorkspaceRepository } = await import("../../src/main/workspace/repository")
  const { WorkspaceService } = await import("../../src/main/workspace/service")

  return new WorkspaceService(
    new WorkspaceRepository(),
    new ThreadWorkspaceService(new ThreadWorkspaceRepository()),
    new JingleMemoryService()
  )
}

async function createAgentServiceForTest(
  input: {
    extensionRegistryReader?: unknown
    jingleMemoryService?: unknown
    threadLifecycleGate?: unknown
    workspaceService?: unknown
  } = {}
) {
  const { AgentService } = await import("../../src/main/agent/service")
  const { JingleMemoryService } = await import("../../src/main/jingle-memory/service")
  const { ThreadLifecycleGate } = await import("../../src/main/agent/thread-lifecycle-gate")
  const { startNativeExtensionMainDefinitionRegistry } =
    await import("../../src/main/services/native-extensions")
  startNativeExtensionMainDefinitionRegistry()

  return new AgentService(
    (input.jingleMemoryService ?? new JingleMemoryService()) as ConstructorParameters<
      typeof AgentService
    >[0],
    (input.threadLifecycleGate ?? new ThreadLifecycleGate()) as ConstructorParameters<
      typeof AgentService
    >[1],
    (input.workspaceService ?? (await createWorkspaceServiceForTest())) as ConstructorParameters<
      typeof AgentService
    >[2],
    input.extensionRegistryReader as ConstructorParameters<typeof AgentService>[3]
  )
}

function createExtensionMainDefinitionRegistryForAdmission(
  state: "failed" | "pending" | "ready"
): ExtensionMainDefinitionRegistry {
  const entries: Array<{ extensionName: string; mainRef: ExtensionMainRef }> = []
  if (state === "pending") {
    entries.push({
      extensionName: "apple-reminders",
      mainRef: {
        extensionName: "apple-reminders",
        kind: "module",
        modulePath: "/never/apple-reminders-main.mjs",
        trust: "trusted",
        version: "1.0.0"
      }
    })
  } else {
    entries.push({
      extensionName: "apple-reminders",
      mainRef: {
        definition: appleRemindersMain,
        extensionName: "apple-reminders",
        kind: "in-memory",
        trust: "trusted",
        version: "1.0.0"
      }
    })
  }
  if (state === "ready") {
    entries.push({
      extensionName: "unrelated-never",
      mainRef: {
        extensionName: "unrelated-never",
        kind: "module",
        modulePath: "/never/unrelated-main.mjs",
        trust: "trusted",
        version: "1.0.0"
      }
    })
  }

  const registry = new ExtensionMainDefinitionRegistry({
    entries,
    loadDefinition: () => new Promise(() => {}),
    onError: () => undefined,
    shutdownTimeoutMs: 5,
    ...(state === "failed"
      ? {
          validateDefinition: () => {
            throw new Error("injected main definition failure")
          }
        }
      : {})
  })
  registry.start()
  return registry
}

function createAppleRemindersSourceRef() {
  return {
    extensionName: "apple-reminders",
    name: "Apple Reminders",
    sourceId: "appleReminders",
    type: "extension-source" as const
  }
}

async function createThreadsServiceForTest(
  input: { threadDigestService?: unknown; threadLifecycleGate?: unknown } = {}
) {
  const { ArtifactsService } = await import("../../src/main/artifacts/service")
  const { ThreadsService } = await import("../../src/main/threads/service")
  const { ThreadWorkspaceRepository } = await import("../../src/main/thread-workspace/repository")
  const { ThreadWorkspaceService } = await import("../../src/main/thread-workspace/service")
  const { ThreadLifecycleGate } = await import("../../src/main/agent/thread-lifecycle-gate")
  const { ThreadDigestService } = await import("../../src/main/thread-digest/service")

  return new ThreadsService(
    new ArtifactsService(),
    { getDefaultModel: () => "openai:gpt-test" } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[1],
    { getAgentConfig: () => ({ locale: "en_US" }) } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[2],
    { resolveGlobalWorkspacePath: async () => repoRoot } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[3],
    new ThreadWorkspaceService(new ThreadWorkspaceRepository()) as unknown as ConstructorParameters<
      typeof ThreadsService
    >[4],
    (input.threadDigestService ?? new ThreadDigestService()) as ConstructorParameters<
      typeof ThreadsService
    >[5],
    (input.threadLifecycleGate ?? new ThreadLifecycleGate()) as ConstructorParameters<
      typeof ThreadsService
    >[6]
  )
}

test.before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-agent-persistence-"))
  process.env.JINGLE_HOME = jingleHome

  execFileSync("node", ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      JINGLE_HOME: jingleHome
    }
  })
})

test.beforeEach(async () => {
  const { closeDatabase, initializeDatabase, getPrismaClient } = await loadDbModules()
  await closeDatabase()
  await initializeDatabase()
  await getPrismaClient().thread.deleteMany()
  await getPrismaClient().agentMemory.deleteMany()
})

test("database startup interrupts agent state left active by a previous process", async () => {
  const {
    closeDatabase,
    createRun,
    createThread,
    getRun,
    getThread,
    initializeDatabase,
    updateThread
  } = await loadDbModules()
  const consoleWarn = mock.method(console, "warn", () => {})
  const threadId = "thread-startup-recovery"
  const runId = "run-startup-recovery"

  try {
    await createThread(threadId)
    await createRun(runId, threadId, { status: "running" })
    await updateThread(threadId, { status: "busy" })

    await closeDatabase()
    await initializeDatabase()

    const run = await getRun(runId)
    const thread = await getThread(threadId)

    assert.equal(run?.status, "interrupted")
    assert.equal(thread?.status, "interrupted")
    assert.equal(consoleWarn.mock.callCount(), 1)
  } finally {
    consoleWarn.mock.restore()
  }
})

test.after(async () => {
  const { closeDatabase } = await loadDbModules()
  await closeDatabase()
  if (originalJingleHome === undefined) {
    delete process.env.JINGLE_HOME
  } else {
    process.env.JINGLE_HOME = originalJingleHome
  }

  if (jingleHome) {
    await rm(jingleHome, { force: true, recursive: true })
  }
})

test("resume primitives target the request's run instead of the latest active run", async () => {
  const { createRun, createThread, getHitlRequest, getRun, upsertHitlRequest } =
    await loadDbModules()
  const { commitAgentResumeDecision } = await import("../../src/main/agent/persistence")

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
    allowed_decisions: ["approve", "user_declined", "corrected"],
    status: "pending"
  })
  await upsertHitlRequest({
    request_id: "request-latest",
    thread_id: threadId,
    run_id: latestRunId,
    tool_call_id: "tool-call-latest",
    tool_name: "write_file",
    tool_args: { path: "/tmp/latest.txt" },
    allowed_decisions: ["approve", "user_declined", "corrected"],
    status: "pending"
  })

  const request = await getHitlRequest("request-older")
  assert.equal(request?.run_id, olderRunId)

  await commitAgentResumeDecision(
    threadId,
    request!.run_id!,
    {
      request_id: request!.request_id,
      tool_call_id: request!.tool_call_id!,
      type: "approve"
    },
    {
      requestId: request!.request_id,
      source: "resume"
    },
    {
      resumeEvent: {
        modelId: "bdd"
      }
    }
  )

  const resumedRun = await getRun(olderRunId)
  const latestRun = await getRun(latestRunId)
  const resolvedRequest = await getHitlRequest("request-older")
  const untouchedRequest = await getHitlRequest("request-latest")

  assert.equal(resumedRun?.status, "running")
  assert.equal(latestRun?.status, "interrupted")
  assert.equal(resolvedRequest?.status, "approved")
  assert.equal(untouchedRequest?.status, "pending")
})

test("terminal HITL requests ignore stale pending request replay", async () => {
  const { createRun, createThread, getHitlRequest, resolveHitlRequest, upsertHitlRequest } =
    await loadDbModules()
  const consoleWarn = mock.method(console, "warn", () => {})
  const threadId = "thread-hitl-terminal-replay"
  const runId = "run-hitl-terminal-replay"
  const requestId = "request-hitl-terminal-replay"

  try {
    await createThread(threadId)
    await createRun(runId, threadId, { status: "interrupted" })
    await upsertHitlRequest({
      allowed_decisions: ["approve", "user_declined", "corrected"],
      request_id: requestId,
      run_id: runId,
      status: "pending",
      thread_id: threadId,
      tool_args: { path: "/tmp/original.txt" },
      tool_call_id: "tool-call-hitl-terminal-replay",
      tool_name: "write_file"
    })
    await resolveHitlRequest(requestId, "approved", {
      request_id: requestId,
      tool_call_id: "tool-call-hitl-terminal-replay",
      type: "approve"
    })

    await upsertHitlRequest({
      allowed_decisions: ["approve", "user_declined", "corrected"],
      request_id: requestId,
      run_id: "run-stale-replay",
      status: "pending",
      thread_id: "thread-stale-replay",
      tool_args: { path: "/tmp/stale.txt" },
      tool_call_id: "tool-call-stale-replay",
      tool_name: "delete_file"
    })

    const request = await getHitlRequest(requestId)
    assert.equal(request?.status, "approved")
    assert.equal(request?.run_id, runId)
    assert.equal(request?.thread_id, threadId)
    assert.equal(request?.tool_call_id, "tool-call-hitl-terminal-replay")
    assert.deepEqual(JSON.parse(request?.tool_args ?? "{}"), { path: "/tmp/original.txt" })
    assert.equal(JSON.parse(request?.decision ?? "{}").type, "approve")
    assert.equal(consoleWarn.mock.callCount(), 1)
  } finally {
    consoleWarn.mock.restore()
  }
})

test("thread snapshot selects the latest pending HITL instead of a newer terminal row", async () => {
  const { createRun, createThread, resolveHitlRequest, upsertHitlRequest } = await loadDbModules()
  const threadId = "thread-hitl-pending-selection"
  const terminalRunId = "run-hitl-terminal-selection"
  const pendingRunId = "run-hitl-pending-selection"

  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  await createRun(terminalRunId, threadId, { status: "interrupted" })
  await createRun(pendingRunId, threadId, { status: "interrupted" })
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: "request-hitl-terminal-selection",
    run_id: terminalRunId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-hitl-terminal-selection",
    tool_name: "write_file"
  })
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: "request-hitl-pending-selection",
    run_id: pendingRunId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-hitl-pending-selection",
    tool_name: "write_file"
  })
  await resolveHitlRequest("request-hitl-terminal-selection", "approved", {
    request_id: "request-hitl-terminal-selection",
    tool_call_id: "tool-hitl-terminal-selection",
    type: "approve"
  })

  const snapshot = await (await createThreadsServiceForTest()).getAgentThreadData(threadId)
  assert.equal(snapshot.runState.pendingApproval?.id, "request-hitl-pending-selection")
})

test("concurrent HITL resolution accepts exactly one terminal decision", async () => {
  const { createRun, createThread, getHitlRequest, resolveHitlRequest, upsertHitlRequest } =
    await loadDbModules()
  const threadId = "thread-hitl-concurrent-cas"
  const runId = "run-hitl-concurrent-cas"
  const requestId = "request-hitl-concurrent-cas"

  await createThread(threadId)
  await createRun(runId, threadId, { status: "interrupted" })
  await upsertHitlRequest({
    allowed_decisions: ["approve", "user_declined", "corrected"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: { path: "/tmp/concurrent.txt" },
    tool_call_id: "tool-call-hitl-concurrent-cas",
    tool_name: "write_file"
  })

  const decisions = await Promise.all([
    resolveHitlRequest(requestId, "approved", {
      request_id: requestId,
      tool_call_id: "tool-call-hitl-concurrent-cas",
      type: "approve"
    }),
    resolveHitlRequest(requestId, "user_declined", {
      request_id: requestId,
      tool_call_id: "tool-call-hitl-concurrent-cas",
      type: "user_declined"
    })
  ])
  const winner = decisions.filter((decision) => decision !== null)
  const stored = await getHitlRequest(requestId)

  assert.equal(winner.length, 1)
  assert.equal(decisions.filter((decision) => decision === null).length, 1)
  assert.equal(stored?.status, winner[0]?.status)
  assert.equal(
    JSON.parse(stored?.decision ?? "{}").type,
    winner[0]?.status === "approved" ? "approve" : "user_declined"
  )
})

test("user_declined atomically resolves HITL and cancels its run", async () => {
  const { createRun, createThread, getRun, getThread, upsertHitlRequest } = await loadDbModules()
  const { commitAgentResumeDecision } = await import("../../src/main/agent/persistence")
  const threadId = "thread-hitl-declined"
  const runId = "run-hitl-declined"
  const requestId = "request-hitl-declined"
  await createThread(threadId)
  await createRun(runId, threadId, {
    metadata: {
      [AGENT_RUN_FAILURE_METADATA_KEY]: toAgentRunFailure(
        "agent:runtime",
        new Error("stale declined failure")
      ),
      error: "legacy stale declined failure"
    },
    status: "running"
  })
  await upsertHitlRequest({
    allowed_decisions: ["approve", "user_declined", "corrected"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-hitl-declined",
    tool_name: "write_file"
  })

  const committed = await commitAgentResumeDecision(
    threadId,
    runId,
    {
      request_id: requestId,
      tool_call_id: "tool-hitl-declined",
      type: "user_declined"
    },
    undefined,
    { resumeEvent: { modelId: "bdd" } }
  )
  assert.ok(committed)
  const run = await getRun(runId)
  const runMetadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  assert.equal(run?.status, "cancelled")
  assert.equal(Object.hasOwn(runMetadata, AGENT_RUN_FAILURE_METADATA_KEY), false)
  assert.equal(Object.hasOwn(runMetadata, "error"), false)
  assert.equal((await getThread(threadId))?.status, "idle")
  const threadsService = Object.create(ThreadsService.prototype) as ThreadsService
  assert.equal((await threadsService.getLatestRunSummary(threadId)).error, null)
})

test("HITL resume admission accepts exactly one decision and one event batch", async () => {
  const { createRun, createThread, getHitlRequest, getPrismaClient, getRun, upsertHitlRequest } =
    await loadDbModules()
  const { createRuntimeRunLifecycleController } =
    await import("../../src/main/agent/run-lifecycle-controller")
  const threadId = "thread-hitl-cas-loser-event"
  const runId = "run-hitl-cas-loser-event"
  const requestId = "request-hitl-cas-loser-event"
  const toolCallId = "tool-call-hitl-cas-loser-event"

  await createThread(threadId)
  await createRun(runId, threadId, { status: "interrupted" })
  await upsertHitlRequest({
    allowed_decisions: ["approve", "user_declined", "corrected"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: { path: "/tmp/cas-loser.txt" },
    tool_call_id: toolCallId,
    tool_name: "write_file"
  })

  const controller = createRuntimeRunLifecycleController({})
  const createStart = (type: "approve" | "user_declined") =>
    controller.beginResumeRun({
      resume: {
        decision: { request_id: requestId, tool_call_id: toolCallId, type },
        modelId: "bdd",
        runId,
        source: "resume"
      } as never,
      threadId
    })
  const starts = await Promise.allSettled([createStart("approve"), createStart("user_declined")])
  const rejected = starts.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  )

  assert.equal(starts.filter((result) => result.status === "fulfilled").length, 1)
  assert.equal(rejected.length, 1)
  assert.equal((rejected[0]?.reason as { code?: string }).code, "CONFLICT")
  const request = await getHitlRequest(requestId)
  const run = await getRun(runId)
  assert.ok(request)
  assert.equal(run?.status, request.status === "user_declined" ? "cancelled" : "running")
  assert.equal(
    await getPrismaClient().agentEvent.count({
      where: { runId, threadId, type: "approval.resolved" }
    }),
    1
  )
})

test("HITL resume admission rejects decisions outside the durable allowlist without writes", async () => {
  const { createRun, createThread, getHitlRequest, getPrismaClient, getRun, upsertHitlRequest } =
    await loadDbModules()
  const { commitAgentResumeDecision } = await import("../../src/main/agent/persistence")
  const threadId = "thread-hitl-disallowed-decision"
  const runId = "run-hitl-disallowed-decision"
  const requestId = "request-hitl-disallowed-decision"
  const toolCallId = "tool-call-hitl-disallowed-decision"

  await createThread(threadId)
  await createRun(runId, threadId, { status: "interrupted" })
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: toolCallId,
    tool_name: "write_file"
  })

  await assert.rejects(
    commitAgentResumeDecision(
      threadId,
      runId,
      {
        correction: "change the target",
        request_id: requestId,
        tool_call_id: toolCallId,
        type: "corrected"
      },
      undefined,
      { resumeEvent: { modelId: "bdd" } }
    ),
    /does not allow decision "corrected"/
  )

  assert.equal((await getHitlRequest(requestId))?.status, "pending")
  assert.equal((await getRun(runId))?.status, "interrupted")
  assert.equal(await getPrismaClient().agentEvent.count({ where: { runId } }), 0)
})

test("HITL resume admission rolls back CAS when the run transition fails", async () => {
  const { createRun, createThread, getHitlRequest, getPrismaClient, getRun, upsertHitlRequest } =
    await loadDbModules()
  const { commitAgentResumeDecision } = await import("../../src/main/agent/persistence")
  const threadId = "thread-hitl-resume-rollback"
  const runId = "run-hitl-resume-rollback"
  const requestId = "request-hitl-resume-rollback"
  const toolCallId = "tool-call-hitl-resume-rollback"
  const triggerName = "fail_hitl_resume_thread_busy_update"
  const prisma = getPrismaClient()

  await createThread(threadId)
  await createRun(runId, threadId, { status: "interrupted" })
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: toolCallId,
    tool_name: "write_file"
  })
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE UPDATE OF "status" ON "threads"
    WHEN NEW."thread_id" = '${threadId}' AND NEW."status" = 'busy'
    BEGIN
      SELECT RAISE(FAIL, 'injected HITL resume transition failure');
    END
  `)

  try {
    await assert.rejects(
      commitAgentResumeDecision(
        threadId,
        runId,
        { request_id: requestId, tool_call_id: toolCallId, type: "approve" },
        undefined,
        { resumeEvent: { modelId: "bdd" } }
      )
    )
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`)
  }

  assert.equal((await getHitlRequest(requestId))?.status, "pending")
  assert.equal((await getRun(runId))?.status, "interrupted")
  assert.equal(await prisma.agentEvent.count({ where: { runId } }), 0)
})

test("beginAgentRun rolls back the run row when marking the thread busy fails", async () => {
  const { createThread, getPrismaClient, getThread } = await loadDbModules()
  const { beginAgentRun } = await import("../../src/main/agent/persistence")
  const threadId = "thread-begin-transaction-rollback"
  const triggerName = "fail_begin_thread_busy_update"
  const prisma = getPrismaClient()
  const sequenceCountBefore = await prisma.agentEventSequence.count()

  await createThread(threadId)
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE UPDATE OF "status" ON "threads"
    WHEN NEW."thread_id" = '${threadId}' AND NEW."status" = 'busy'
    BEGIN
      SELECT RAISE(FAIL, 'injected thread update failure');
    END
  `)

  try {
    await assert.rejects(
      beginAgentRun(threadId, "gpt-test", {
        startEvent: {
          contentPreview: "rollback invoke",
          refs: [],
          userMessageId: "message-begin-rollback"
        }
      })
    )
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`)
  }

  assert.equal(await prisma.run.count({ where: { threadId } }), 0)
  assert.equal(await prisma.agentEvent.count({ where: { threadId } }), 0)
  assert.equal(await prisma.agentEventSequence.count(), sequenceCountBefore)
  assert.equal((await getThread(threadId))?.status, "idle")
})

test("resume admission rolls back the decision and run when marking the thread busy fails", async () => {
  const {
    createRun,
    createThread,
    getHitlRequest,
    getPrismaClient,
    getRun,
    getThread,
    upsertHitlRequest
  } = await loadDbModules()
  const { commitAgentResumeDecision } = await import("../../src/main/agent/persistence")
  const threadId = "thread-resume-transaction-rollback"
  const runId = "run-resume-transaction-rollback"
  const triggerName = "fail_resume_thread_busy_update"
  const prisma = getPrismaClient()
  const sequenceCountBefore = await prisma.agentEventSequence.count()

  await createThread(threadId)
  await createRun(runId, threadId, {
    metadata: { existing: true },
    status: "interrupted"
  })
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: "request-rollback",
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-call-rollback",
    tool_name: "write_file"
  })
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE UPDATE OF "status" ON "threads"
    WHEN NEW."thread_id" = '${threadId}' AND NEW."status" = 'busy'
    BEGIN
      SELECT RAISE(FAIL, 'injected thread update failure');
    END
  `)

  try {
    await assert.rejects(
      commitAgentResumeDecision(
        threadId,
        runId,
        {
          request_id: "request-rollback",
          tool_call_id: "tool-call-rollback",
          type: "approve"
        },
        { requestId: "request-rollback" },
        {
          resumeEvent: {
            modelId: "gpt-test"
          }
        }
      )
    )
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`)
  }

  const run = await getRun(runId)
  assert.equal(run?.status, "interrupted")
  assert.deepEqual(JSON.parse(run?.metadata ?? "{}"), { existing: true })
  assert.equal((await getHitlRequest("request-rollback"))?.status, "pending")
  assert.equal((await getThread(threadId))?.status, "idle")
  assert.equal(await prisma.agentEvent.count({ where: { runId } }), 0)
  assert.equal(await prisma.agentEventSequence.count(), sequenceCountBefore)
})

test("markRunFailed rolls back run failure metadata and status when the thread transition fails", async () => {
  const { createRun, createThread, getPrismaClient, getRun, getThread, updateThread } =
    await loadDbModules()
  const { markRunFailed } = await import("../../src/main/agent/persistence")
  const threadId = "thread-failure-transaction-rollback"
  const runId = "run-failure-transaction-rollback"
  const triggerName = "fail_run_failure_thread_error_update"
  const prisma = getPrismaClient()

  await createThread(threadId)
  await createRun(runId, threadId, {
    metadata: { existing: true },
    status: "running"
  })
  await updateThread(threadId, { status: "busy" })
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE UPDATE OF "status" ON "threads"
    WHEN NEW."thread_id" = '${threadId}' AND NEW."status" = 'error'
    BEGIN
      SELECT RAISE(FAIL, 'injected run failure thread transition failure');
    END
  `)

  try {
    await assert.rejects(
      markRunFailed(
        threadId,
        runId,
        toAgentRunFailure("agent:runtime", new Error("durable failure must roll back"))
      )
    )
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`)
  }

  const run = await getRun(runId)
  assert.equal(run?.status, "running")
  assert.deepEqual(JSON.parse(run?.metadata ?? "{}"), { existing: true })
  assert.equal((await getThread(threadId))?.status, "busy")
})

test("markRunFailed rolls back run and thread when the atomic run.finished append fails", async () => {
  const { createRun, createThread, getPrismaClient, getRun, getThread, updateThread } =
    await loadDbModules()
  const { markRunFailed } = await import("../../src/main/agent/persistence")
  const threadId = "thread-failure-event-rollback"
  const runId = "run-failure-event-rollback"
  const triggerName = "fail_run_finished_event_insert"
  const prisma = getPrismaClient()

  await createThread(threadId)
  await createRun(runId, threadId, { metadata: { existing: true }, status: "running" })
  await updateThread(threadId, { status: "busy" })
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON "agent_events"
    WHEN NEW."run_id" = '${runId}' AND NEW."type" = 'run.finished'
    BEGIN
      SELECT RAISE(FAIL, 'injected run.finished append failure');
    END
  `)

  try {
    await assert.rejects(
      markRunFailed(
        threadId,
        runId,
        toAgentRunFailure("agent:runtime", new Error("event append must roll back"))
      )
    )
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`)
  }

  const run = await getRun(runId)
  assert.equal(run?.status, "running")
  assert.deepEqual(JSON.parse(run?.metadata ?? "{}"), { existing: true })
  assert.equal((await getThread(threadId))?.status, "busy")
  assert.equal(await prisma.agentEvent.count({ where: { runId } }), 0)
})

test("markRunFailed never overwrites success, cancelled, interrupted, or an earlier failure winner", async () => {
  const { createRun, createThread, getPrismaClient, getRun, getThread } = await loadDbModules()
  const { markRunFailed } = await import("../../src/main/agent/persistence")
  const prisma = getPrismaClient()

  for (const status of ["success", "cancelled", "interrupted"] as const) {
    const threadId = `thread-late-failure-${status}`
    const runId = `run-late-failure-${status}`
    await createThread(threadId)
    await createRun(runId, threadId, { metadata: { winner: status }, status })

    await assert.rejects(
      markRunFailed(
        threadId,
        runId,
        toAgentRunFailure("agent:runtime", new Error(`late ${status} failure`))
      ),
      (error) => {
        assert.equal((error as { code?: unknown }).code, "CONFLICT")
        return true
      }
    )

    const run = await getRun(runId)
    assert.equal(run?.status, status)
    assert.deepEqual(JSON.parse(run?.metadata ?? "{}"), { winner: status })
    assert.equal((await getThread(threadId))?.status, "idle")
    assert.equal(await prisma.agentEvent.count({ where: { runId, type: "run.finished" } }), 0)
  }

  const threadId = "thread-duplicate-failure"
  const runId = "run-duplicate-failure"
  const originalFailure = toAgentRunFailure("agent:runtime", new Error("original failure"))
  await createThread(threadId)
  await createRun(runId, threadId, {
    metadata: { error: "stale legacy failure" },
    status: "running"
  })
  assert.equal(await markRunFailed(threadId, runId, originalFailure), "error")
  const originalMetadata = (await getRun(runId))?.metadata
  assert.equal(Object.hasOwn(JSON.parse(originalMetadata ?? "{}"), "error"), false)

  await assert.rejects(
    markRunFailed(
      threadId,
      runId,
      toAgentRunFailure("agent:runtime", new Error("duplicate late failure"))
    ),
    (error) => {
      assert.equal((error as { code?: unknown }).code, "CONFLICT")
      return true
    }
  )

  assert.equal((await getRun(runId))?.metadata, originalMetadata)
  assert.equal(await prisma.agentEvent.count({ where: { runId, type: "run.finished" } }), 1)
})

test("pending HITL is the sole interrupted failure classifier after resume", async () => {
  const {
    createRun,
    createThread,
    getHitlRequest,
    getPrismaClient,
    getRun,
    getThread,
    upsertHitlRequest
  } = await loadDbModules()
  const { commitAgentResumeDecision, markRunFailed } =
    await import("../../src/main/agent/persistence")
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")
  const threadId = "thread-resumed-after-old-interrupt"
  const runId = "run-resumed-after-old-interrupt"
  const requestId = "request-resumed-after-old-interrupt"

  await createThread(threadId)
  await createRun(runId, threadId, { status: "interrupted" })
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-call-resumed-after-old-interrupt",
    tool_name: "write_file"
  })
  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-old-interrupt"
  checkpoint.channel_values = { __interrupt__: [{ value: { actionRequests: [] } }] }
  await new PrismaCheckpointSaver().put(
    { configurable: { thread_id: threadId }, metadata: { run_id: runId } },
    checkpoint,
    { parents: {}, source: "update", step: 0 }
  )

  await commitAgentResumeDecision(
    threadId,
    runId,
    {
      request_id: requestId,
      tool_call_id: "tool-call-resumed-after-old-interrupt",
      type: "approve"
    },
    undefined,
    { resumeEvent: {} }
  )
  assert.equal((await getRun(runId))?.status, "running")
  assert.equal((await getHitlRequest(requestId))?.status, "approved")

  assert.equal(
    await markRunFailed(
      threadId,
      runId,
      toAgentRunFailure("agent:runtime", new Error("resumed execution failed"))
    ),
    "error"
  )
  assert.equal((await getRun(runId))?.status, "error")
  assert.equal((await getThread(threadId))?.status, "error")
  const finished = await getPrismaClient().agentEvent.findFirst({
    where: { runId, type: "run.finished" }
  })
  assert.equal((JSON.parse(finished?.payload ?? "{}") as { status?: unknown }).status, "error")
})

test("a resumed attempt can append a new failure after an earlier interrupted finish", async () => {
  const { createRun, createThread, getPrismaClient, getRun, upsertHitlRequest } =
    await loadDbModules()
  const { commitAgentResumeDecision, markRunFailed } =
    await import("../../src/main/agent/persistence")
  const threadId = "thread-resumed-generation-failure"
  const runId = "run-resumed-generation-failure"
  const requestId = "request-resumed-generation-failure"
  const firstFailure = toAgentRunFailure("agent:runtime", new Error("paused attempt failed"))
  const resumedFailure = toAgentRunFailure("agent:runtime", new Error("resumed attempt failed"))

  await createThread(threadId)
  await createRun(runId, threadId, { status: "running" })
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-resumed-generation-failure",
    tool_name: "write_file"
  })

  assert.equal(await markRunFailed(threadId, runId, firstFailure), "interrupted")
  assert.ok(
    await commitAgentResumeDecision(
      threadId,
      runId,
      {
        request_id: requestId,
        tool_call_id: "tool-resumed-generation-failure",
        type: "approve"
      },
      undefined,
      { resumeEvent: {} }
    )
  )
  assert.equal((await getRun(runId))?.status, "running")
  assert.equal(await markRunFailed(threadId, runId, resumedFailure), "error")

  const run = await getRun(runId)
  const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  assert.deepEqual(parseAgentRunFailure(metadata[AGENT_RUN_FAILURE_METADATA_KEY]), resumedFailure)
  const lifecycleEvents = await getPrismaClient().agentEvent.findMany({
    orderBy: { seq: "asc" },
    where: { runId, type: { in: ["run.resumed", "run.finished"] } }
  })
  assert.deepEqual(
    lifecycleEvents.map((event) => event.type),
    ["run.finished", "run.resumed", "run.finished"]
  )

  await assert.rejects(markRunFailed(threadId, runId, firstFailure), (error) => {
    assert.equal((error as { code?: unknown }).code, "CONFLICT")
    return true
  })
  assert.equal(
    await getPrismaClient().agentEvent.count({ where: { runId, type: "run.finished" } }),
    2
  )
  assert.deepEqual(
    parseAgentRunFailure(
      (JSON.parse((await getRun(runId))?.metadata ?? "{}") as Record<string, unknown>)[
        AGENT_RUN_FAILURE_METADATA_KEY
      ]
    ),
    resumedFailure
  )
})

test("agent resume commits HITL before a resumed stream can fail on its first chunk", async () => {
  const { createRun, createThread, getHitlRequest, getRun, upsertHitlRequest } =
    await loadDbModules()
  const consoleLog = mock.method(console, "log", () => {})
  const consoleError = mock.method(console, "error", () => {})
  const previousRuntimeMode = process.env.JINGLE_BDD_AGENT_RUNTIME

  const threadId = "thread-resume-failure"
  const runId = "run-resume-failure"
  const requestId = "request-resume-failure"
  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  await createRun(runId, threadId, { status: "interrupted" })
  await upsertHitlRequest({
    request_id: requestId,
    thread_id: threadId,
    run_id: runId,
    tool_call_id: "tool-call-resume-failure",
    tool_name: "write_file",
    tool_args: { path: `${repoRoot}/approval.txt` },
    allowed_decisions: ["approve", "user_declined", "corrected"],
    status: "pending"
  })

  const events: Array<{ type: string }> = []
  let resolveTerminalFailure!: (terminal: AgentRunFailureTerminalFact) => void
  const terminalFailure = new Promise<AgentRunFailureTerminalFact>((resolve) => {
    resolveTerminalFailure = resolve
  })
  let outcome: Awaited<ReturnType<AgentService["dispatchResume"]>> | null = null
  let liveTerminal: AgentRunFailureTerminalFact | null = null
  process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"
  try {
    outcome = await (
      await createAgentServiceForTest()
    ).dispatchResume(
      {
        decision: {
          correction: "bdd:fail-before-first-chunk",
          request_id: requestId,
          tool_call_id: "tool-call-resume-failure",
          type: "corrected"
        },
        modelId: "bdd",
        threadId
      },
      {
        send: (event) => {
          events.push({ type: event.type })
          if (event.type === "error") {
            resolveTerminalFailure({ failure: event.failure, status: event.status })
          }
        }
      }
    )
    liveTerminal = await terminalFailure
  } finally {
    if (previousRuntimeMode === undefined) {
      delete process.env.JINGLE_BDD_AGENT_RUNTIME
    } else {
      process.env.JINGLE_BDD_AGENT_RUNTIME = previousRuntimeMode
    }
    consoleError.mock.restore()
    consoleLog.mock.restore()
  }

  const request = await getHitlRequest(requestId)
  assert.ok(outcome)
  assert.ok(liveTerminal)
  assert.equal(request?.status, "corrected")
  assert.deepEqual(JSON.parse(request?.decision ?? "{}"), {
    correction: "bdd:fail-before-first-chunk",
    request_id: requestId,
    tool_call_id: "tool-call-resume-failure",
    type: "corrected"
  })
  const run = await getRun(runId)
  assert.equal(run?.status, "error")
  const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  const persistedFailure = parseAgentRunFailure(metadata[AGENT_RUN_FAILURE_METADATA_KEY])
  assert.deepEqual(persistedFailure, liveTerminal.failure)
  assert.equal(liveTerminal.status, run?.status)
  const threadsService = Object.create(ThreadsService.prototype) as ThreadsService
  assert.deepEqual((await threadsService.getLatestRunSummary(threadId)).error, liveTerminal.failure)
  assert.equal(outcome.type, "accepted")
  assert.deepEqual(
    events.map((event) => event.type),
    ["run_started", "error"]
  )
})

test("admission binding failures preserve invoke rejection and resume acceptance contracts", async () => {
  const { createRun, createThread, getHitlRequest, getRun, upsertHitlRequest } =
    await loadDbModules()
  const { beginAgentRun, commitAgentResumeDecision, markRunFailed } =
    await import("../../src/main/agent/persistence")
  const { RuntimeThreadAdmissionPersistenceError, RuntimeThreadDurableFailureError } =
    await import("@jingle/langchain-agent-harness")
  const consoleLog = mock.method(console, "log", () => {})
  const consoleError = mock.method(console, "error", () => {})
  const previousRuntimeMode = process.env.JINGLE_BDD_AGENT_RUNTIME
  delete process.env.JINGLE_BDD_AGENT_RUNTIME

  const invokeThreadId = "thread-invoke-binding-failure"
  const editThreadId = "thread-edit-binding-failure"
  const resumeThreadId = "thread-resume-binding-failure"
  const recoveryThreadId = "thread-invoke-binding-persistence-failure"
  const resumeRunId = "run-resume-binding-failure"
  const resumeRequestId = "request-resume-binding-failure"
  const invokeFailure = toAgentRunFailure(
    "agent:runtime",
    new Error("invoke execution binding failed")
  )
  const resumeFailure = toAgentRunFailure(
    "agent:runtime",
    new Error("resume execution binding failed")
  )
  const invokeRunIds = new Map<string, string>()

  await createThread(invokeThreadId)
  await createThread(editThreadId)
  await createThread(resumeThreadId)
  await createThread(recoveryThreadId)
  await Promise.all([
    bindThreadWorkspace(invokeThreadId, repoRoot),
    bindThreadWorkspace(editThreadId, repoRoot),
    bindThreadWorkspace(resumeThreadId, repoRoot),
    bindThreadWorkspace(recoveryThreadId, repoRoot)
  ])
  await createRun(resumeRunId, resumeThreadId, { status: "interrupted" })
  await upsertHitlRequest({
    allowed_decisions: ["corrected"],
    request_id: resumeRequestId,
    run_id: resumeRunId,
    status: "pending",
    thread_id: resumeThreadId,
    tool_args: {},
    tool_call_id: "tool-resume-binding-failure",
    tool_name: "write_file"
  })

  const { ThreadLifecycleGate } = await import("../../src/main/agent/thread-lifecycle-gate")
  const { diagnosticsGraph } = await import("../../src/main/diagnostics/instance")
  const diagnostics: unknown[] = []
  const capture = mock.method(diagnosticsGraph, "capture", (input) => {
    diagnostics.push(input)
    return { eventId: "diag:admission-persistence:1", sequence: 1, sessionId: "test" }
  })
  const lifecycleGate = new ThreadLifecycleGate()
  const service = await createAgentServiceForTest({ threadLifecycleGate: lifecycleGate })
  Object.defineProperty(service, "agentRuntime", {
    value: {
      thread: ({ threadId }: { threadId: string }) => ({
        startInvoke: async (invoke: {
          modelId: string
          permissionMode: "ask-to-edit" | "auto" | "explore"
          userMessage: { id: string }
        }) => {
          const started = await beginAgentRun(threadId, invoke.modelId, {
            permissionMode: invoke.permissionMode,
            startEvent: {
              contentPreview: "binding failure",
              refs: [],
              userMessageId: invoke.userMessage.id
            }
          })
          if (threadId === recoveryThreadId) {
            throw new RuntimeThreadAdmissionPersistenceError({
              errors: [new Error("binding failed"), new Error("failure transaction failed")],
              runId: started.runId
            })
          }
          invokeRunIds.set(threadId, started.runId)
          const status = await markRunFailed(threadId, started.runId, invokeFailure)
          throw new RuntimeThreadDurableFailureError({
            cause: new Error("invoke binder failed"),
            durableFailure: { failure: invokeFailure, status },
            runId: started.runId
          })
        },
        startResume: async (resume: {
          decision: Parameters<typeof commitAgentResumeDecision>[2]
          modelId: string
          runId: string
        }) => {
          const committed = await commitAgentResumeDecision(
            threadId,
            resume.runId,
            resume.decision,
            undefined,
            { resumeEvent: { modelId: resume.modelId } }
          )
          assert.ok(committed)
          const status = await markRunFailed(threadId, resume.runId, resumeFailure)
          throw new RuntimeThreadDurableFailureError({
            cause: new Error("resume binder failed"),
            durableFailure: { failure: resumeFailure, status },
            runId: resume.runId
          })
        }
      })
    }
  })

  try {
    const invokeEvents: AgentStreamPayload[] = []
    let invokeAccepted = 0
    const invokeOutcome = await service.dispatchInvoke(
      {
        message: { content: "invoke binding failure", id: "message-invoke-binding-failure" },
        modelId: "bdd",
        threadId: invokeThreadId
      },
      { send: (event) => invokeEvents.push(event) },
      { onRunAccepted: () => (invokeAccepted += 1) }
    )
    assert.equal(invokeOutcome.type, "rejected")
    assert.equal(invokeAccepted, 0)
    assert.deepEqual(invokeEvents, [])
    const invokeRunId = invokeRunIds.get(invokeThreadId)
    assert.ok(invokeRunId)
    const invokeRun = await getRun(invokeRunId)
    const invokeMetadata = JSON.parse(invokeRun?.metadata ?? "{}") as Record<string, unknown>
    assert.deepEqual(
      parseAgentRunFailure(invokeMetadata[AGENT_RUN_FAILURE_METADATA_KEY]),
      invokeFailure
    )
    const threadsService = Object.create(ThreadsService.prototype) as ThreadsService
    assert.deepEqual(
      (await threadsService.getLatestRunSummary(invokeThreadId)).error,
      invokeFailure
    )

    await new Promise((resolve) => setImmediate(resolve))
    const editEvents: AgentStreamPayload[] = []
    let editAccepted = 0
    let resolveEditOutcome!: (outcome: Awaited<ReturnType<AgentService["dispatchInvoke"]>>) => void
    const editOutcomePromise = new Promise<Awaited<ReturnType<AgentService["dispatchInvoke"]>>>(
      (resolve) => {
        resolveEditOutcome = resolve
      }
    )
    await service.invoke(
      {
        message: { content: "edit binding failure", id: "message-edit-binding-failure" },
        modelId: "bdd",
        threadId: editThreadId
      },
      { send: (event) => editEvents.push(event) },
      {
        channel: "agent:editLastUserMessageAndInvoke",
        onCommandOutcome: (outcome) => {
          resolveEditOutcome(outcome)
        },
        onRunAccepted: () => (editAccepted += 1)
      }
    )
    assert.equal((await editOutcomePromise).type, "rejected")
    assert.equal(editAccepted, 0)
    assert.deepEqual(editEvents, [])
    const editRunId = invokeRunIds.get(editThreadId)
    assert.ok(editRunId)
    const editRun = await getRun(editRunId)
    assert.equal(editRun?.status, "error")

    await new Promise((resolve) => setImmediate(resolve))
    const resumeEvents: AgentStreamPayload[] = []
    const acceptedDecisions: unknown[] = []
    const resumeOutcome = await service.dispatchResume(
      {
        decision: {
          correction: "continue",
          request_id: resumeRequestId,
          tool_call_id: "tool-resume-binding-failure",
          type: "corrected"
        },
        modelId: "bdd",
        threadId: resumeThreadId
      },
      { send: (event) => resumeEvents.push(event) },
      { onRunAccepted: (decision) => acceptedDecisions.push(decision) }
    )
    assert.equal(resumeOutcome.type, "accepted")
    assert.equal(acceptedDecisions.length, 1)
    assert.deepEqual(
      resumeEvents.map((event) => event.type),
      ["run_started", "error"]
    )
    const resumeTerminal = resumeEvents.at(-1)
    assert.equal(resumeTerminal?.type, "error")
    if (resumeTerminal?.type === "error") {
      assert.deepEqual(resumeTerminal.failure, resumeFailure)
      assert.equal(resumeTerminal.status, "error")
    }
    assert.equal((await getHitlRequest(resumeRequestId))?.status, "corrected")
    const resumedRun = await getRun(resumeRunId)
    const resumedMetadata = JSON.parse(resumedRun?.metadata ?? "{}") as Record<string, unknown>
    assert.deepEqual(
      parseAgentRunFailure(resumedMetadata[AGENT_RUN_FAILURE_METADATA_KEY]),
      resumeFailure
    )
    assert.deepEqual(
      (await threadsService.getLatestRunSummary(resumeThreadId)).error,
      resumeFailure
    )

    await new Promise((resolve) => setImmediate(resolve))
    const recoveryEvents: AgentStreamPayload[] = []
    const recoveryOutcome = await service.dispatchInvoke(
      {
        message: { content: "admission persistence failure", id: "message-admission-recovery" },
        modelId: "bdd",
        threadId: recoveryThreadId
      },
      { send: (event) => recoveryEvents.push(event) }
    )
    assert.equal(recoveryOutcome.type, "rejected")
    assert.equal(
      recoveryOutcome.type === "rejected" ? recoveryOutcome.error.code : null,
      "UNAVAILABLE"
    )
    assert.deepEqual(
      recoveryEvents.map((event) => event.type),
      ["run_rejected"]
    )
    assert.equal(lifecycleGate.isRecoveryRequired(recoveryThreadId), true)
    assert.equal(diagnostics.length, 1)
    assert.match(JSON.stringify(diagnostics[0]), /agent\.terminal_persistence_failed/)
    assert.doesNotMatch(JSON.stringify(diagnostics[0]), /failure transaction failed/)
  } finally {
    if (previousRuntimeMode === undefined) {
      delete process.env.JINGLE_BDD_AGENT_RUNTIME
    } else {
      process.env.JINGLE_BDD_AGENT_RUNTIME = previousRuntimeMode
    }
    capture.mock.restore()
    consoleError.mock.restore()
    consoleLog.mock.restore()
  }
})

test("terminal transaction failure emits restart-required recovery without a durable failure wire", async () => {
  const {
    createRun,
    createThread,
    getHitlRequest,
    getPrismaClient,
    getRun,
    getThread,
    upsertHitlRequest
  } = await loadDbModules()
  const consoleLog = mock.method(console, "log", () => {})
  const consoleError = mock.method(console, "error", () => {})
  const previousRuntimeMode = process.env.JINGLE_BDD_AGENT_RUNTIME
  const { ThreadLifecycleGate } = await import("../../src/main/agent/thread-lifecycle-gate")
  const { diagnosticsGraph } = await import("../../src/main/diagnostics/instance")
  const diagnostics: unknown[] = []
  const capture = mock.method(diagnosticsGraph, "capture", (input) => {
    diagnostics.push(input)
    return { eventId: "diag:terminal-persistence:1", sequence: 1, sessionId: "test" }
  })
  const lifecycleGate = new ThreadLifecycleGate()
  const service = await createAgentServiceForTest({ threadLifecycleGate: lifecycleGate })
  const threadId = "thread-resume-persistence-recovery"
  const runId = "run-resume-persistence-recovery"
  const requestId = "request-resume-persistence-recovery"
  const triggerName = "fail_live_terminal_thread_error_update"
  const prisma = getPrismaClient()
  const events: AgentStreamPayload[] = []
  let resolveRecovery!: (
    payload: Extract<AgentStreamPayload, { type: "recovery_required" }>
  ) => void
  const recovery = new Promise<Extract<AgentStreamPayload, { type: "recovery_required" }>>(
    (resolve) => {
      resolveRecovery = resolve
    }
  )
  let outcome: Awaited<ReturnType<AgentService["dispatchResume"]>> | null = null

  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  await createRun(runId, threadId, { metadata: { existing: true }, status: "interrupted" })
  await upsertHitlRequest({
    allowed_decisions: ["corrected"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-call-resume-persistence-recovery",
    tool_name: "write_file"
  })
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE UPDATE OF "status" ON "threads"
    WHEN NEW."thread_id" = '${threadId}' AND NEW."status" = 'error'
    BEGIN
      SELECT RAISE(FAIL, 'injected live terminal persistence failure');
    END
  `)

  process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"
  try {
    outcome = await service.dispatchResume(
      {
        decision: {
          correction: "bdd:fail-before-first-chunk",
          request_id: requestId,
          tool_call_id: "tool-call-resume-persistence-recovery",
          type: "corrected"
        },
        modelId: "bdd",
        threadId
      },
      {
        send: (event) => {
          events.push(event)
          if (event.type === "recovery_required") {
            resolveRecovery(event)
          }
        }
      }
    )
    await recovery
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`)
    if (previousRuntimeMode === undefined) {
      delete process.env.JINGLE_BDD_AGENT_RUNTIME
    } else {
      process.env.JINGLE_BDD_AGENT_RUNTIME = previousRuntimeMode
    }
    capture.mock.restore()
    consoleError.mock.restore()
    consoleLog.mock.restore()
  }

  assert.equal(outcome?.type, "accepted")
  assert.deepEqual(
    events.map((event) => event.type),
    ["run_started", "recovery_required"]
  )
  assert.deepEqual(events.at(-1), {
    recovery: {
      action: "app_restart_required",
      reason: "terminal_persistence_failed",
      schemaVersion: 1
    },
    type: "recovery_required"
  })
  const run = await getRun(runId)
  const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  assert.equal(run?.status, "running")
  assert.equal(Object.hasOwn(metadata, AGENT_RUN_FAILURE_METADATA_KEY), false)
  assert.equal((await getThread(threadId))?.status, "busy")
  assert.equal((await getHitlRequest(requestId))?.status, "corrected")
  assert.equal(await prisma.agentEvent.count({ where: { runId, type: "run.finished" } }), 0)
  assert.equal(lifecycleGate.isRecoveryRequired(threadId), true)
  assert.deepEqual(diagnostics, [
    {
      component: "agent-service",
      dimensionEntries: [
        { key: "errorType", value: "AggregateError" },
        { key: "ipcCode", value: "INTERNAL" }
      ],
      eventCode: "agent.terminal_persistence_failed",
      fingerprint: "agent.terminal_persistence_failed",
      level: "error",
      operation: "persist-run-terminal",
      recoverable: true,
      refs: [
        { id: threadId, kind: "agent-thread" },
        { id: runId, kind: "agent-run" }
      ],
      stateImpact: "terminal-state-unknown-app-restart-required",
      summary: "Agent terminal state persistence failed; app restart is required."
    }
  ])
  assert.doesNotMatch(JSON.stringify(diagnostics), /injected live terminal persistence failure/)

  const rejectedEvents: AgentStreamPayload[] = []
  const sink = { send: (event: AgentStreamPayload) => rejectedEvents.push(event) }
  const [invokeOutcome, editOutcome, resumeOutcome] = await Promise.all([
    service.dispatchInvoke(
      { message: { content: "blocked", id: "blocked-invoke" }, modelId: "bdd", threadId },
      sink
    ),
    service.dispatchEditLastUserMessageAndInvoke(
      { message: { content: "blocked", id: "blocked-edit" }, modelId: "bdd", threadId },
      sink
    ),
    service.dispatchResume(
      {
        decision: {
          request_id: requestId,
          tool_call_id: "tool-call-resume-persistence-recovery",
          type: "approve"
        },
        modelId: "bdd",
        threadId
      },
      sink
    )
  ])
  for (const blockedOutcome of [invokeOutcome, editOutcome, resumeOutcome]) {
    assert.equal(blockedOutcome.type, "rejected")
    assert.equal(
      blockedOutcome.type === "rejected" ? blockedOutcome.error.code : null,
      "UNAVAILABLE"
    )
  }
  assert.deepEqual(
    rejectedEvents.map((event) => event.type),
    ["run_rejected", "run_rejected", "run_rejected"]
  )
})

test("agent resume rejects workspace mismatch before mutating the run", async () => {
  const { createRun, createThread, getRun, upsertHitlRequest } = await loadDbModules()
  const { JINGLE_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY } =
    await import("../../src/shared/jingle-memory")
  const consoleLog = mock.method(console, "log", () => {})
  const consoleError = mock.method(console, "error", () => {})

  const originalWorkspacePath = await mkdtemp(join(jingleHome, "workspace-original-"))
  const currentWorkspacePath = await mkdtemp(join(jingleHome, "workspace-current-"))
  const threadId = "thread-resume-workspace-mismatch"
  const runId = "run-resume-workspace-mismatch"
  const requestId = "request-resume-workspace-mismatch"
  await createThread(threadId)
  await bindThreadWorkspace(threadId, currentWorkspacePath)
  await createRun(runId, threadId, {
    metadata: {
      [JINGLE_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY]: {
        canonicalWorkspacePath: originalWorkspacePath,
        generatedAt: 1,
        items: [],
        workspaceIdentity: {
          canonicalWorkspacePath: originalWorkspacePath,
          displayName: "original",
          workspaceKey: originalWorkspacePath
        },
        workspaceKey: originalWorkspacePath
      }
    },
    status: "interrupted"
  })
  await upsertHitlRequest({
    request_id: requestId,
    thread_id: threadId,
    run_id: runId,
    tool_call_id: "tool-call-resume-workspace-mismatch",
    tool_name: "write_file",
    tool_args: { path: `${currentWorkspacePath}/approval.txt` },
    allowed_decisions: ["approve", "user_declined", "corrected"],
    status: "pending"
  })

  const events: Array<{ details?: string[]; type: string }> = []
  let outcome: Awaited<ReturnType<AgentService["dispatchResume"]>> | null = null
  try {
    outcome = await (
      await createAgentServiceForTest()
    ).dispatchResume(
      {
        decision: {
          request_id: requestId,
          tool_call_id: "tool-call-resume-workspace-mismatch",
          type: "approve"
        },
        modelId: "bdd",
        threadId
      },
      {
        send: (event) =>
          events.push({
            details: "details" in event ? event.details : undefined,
            type: event.type
          })
      }
    )
  } finally {
    consoleError.mock.restore()
    consoleLog.mock.restore()
  }

  const run = await getRun(runId)
  assert.ok(outcome)
  assert.equal(run?.status, "interrupted")
  assert.deepEqual(events, [])
  assert.equal(outcome.type, "rejected")
  assert.equal(outcome.type === "rejected" ? outcome.error.code : null, "FAILED_PRECONDITION")
  assert.equal(
    outcome.type === "rejected" &&
      outcome.error.details?.some((detail) => detail.includes("fork_current_workspace")),
    true
  )
})

test("agent resume seeds frozen provided context inclusions into resumed runtime state", async () => {
  const { createRun, createThread, getHitlRequest, updateThread, upsertHitlRequest } =
    await loadDbModules()
  const { JINGLE_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY } =
    await import("../../src/shared/jingle-memory")
  const consoleLog = mock.method(console, "log", () => {})
  const previousRuntimeMode = process.env.JINGLE_BDD_AGENT_RUNTIME

  const threadId = "thread-resume-context-inclusions"
  const runId = "run-resume-context-inclusions"
  const requestId = "request-resume-context-inclusions"
  const workspaceIdentity = {
    canonicalWorkspacePath: repoRoot,
    displayName: "jingle",
    workspaceKey: repoRoot
  }

  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  await createRun(runId, threadId, {
    metadata: {
      [JINGLE_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY]: {
        canonicalWorkspacePath: repoRoot,
        generatedAt: 123,
        items: [
          {
            content: "Frozen resume memory body.",
            id: "memory:memory-resume-context",
            kind: "about_me",
            scope: "global",
            sourceLabel: "Global personal memory",
            sourceType: "structured",
            structuredMemoryId: "memory-resume-context"
          }
        ],
        workspaceIdentity,
        workspaceKey: repoRoot
      }
    },
    status: "interrupted"
  })
  await updateThread(threadId, { status: "interrupted" })
  await upsertHitlRequest({
    request_id: requestId,
    thread_id: threadId,
    run_id: runId,
    tool_call_id: "tool-call-resume-context-inclusions",
    tool_name: "write_file",
    tool_args: { path: `${repoRoot}/approval.txt` },
    allowed_decisions: ["approve", "user_declined", "corrected"],
    status: "pending"
  })

  const events: Array<{ data?: unknown; mode?: string; type: string }> = []
  let acceptedDecision: Record<string, unknown> | null = null

  try {
    process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"
    await (
      await createAgentServiceForTest()
    ).resume(
      {
        decision: {
          request_id: `  ${requestId}  `,
          tool_call_id: "tool-call-resume-context-inclusions",
          type: "approve"
        },
        modelId: "bdd",
        threadId
      },
      {
        send: (event) => events.push(event as (typeof events)[number])
      },
      {
        onRunAccepted: (decision) => {
          acceptedDecision = decision
        }
      }
    )
  } finally {
    consoleLog.mock.restore()
    if (previousRuntimeMode === undefined) {
      delete process.env.JINGLE_BDD_AGENT_RUNTIME
    } else {
      process.env.JINGLE_BDD_AGENT_RUNTIME = previousRuntimeMode
    }
  }

  const valuesEvent = events.find((event) => event.type === "stream" && event.mode === "values")
  const contextInclusions = (valuesEvent?.data as { contextInclusions?: Array<{ id?: string }> })
    ?.contextInclusions

  assert.equal(
    contextInclusions?.[0]?.id,
    "ctx:run-resume-context-inclusions:provided:memory:memory-resume-context"
  )
  assert.equal(events[0]?.type, "run_started")
  assert.deepEqual(acceptedDecision, {
    request_id: requestId,
    tool_call_id: "tool-call-resume-context-inclusions",
    type: "approve"
  })
  const resolvedRequest = await getHitlRequest(requestId)
  assert.deepEqual(JSON.parse(resolvedRequest?.decision ?? "null"), {
    request_id: requestId,
    tool_call_id: "tool-call-resume-context-inclusions",
    type: "approve"
  })
})

test("agent cancel releases pending invoke setup and ignores its late fulfillment", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const { ThreadLifecycleGate } = await import("../../src/main/agent/thread-lifecycle-gate")
  const consoleLog = mock.method(console, "log", () => {})

  const threadId = "thread-cancel-before-run"
  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)

  let contextPackStarted = false
  let resolveLateContextPack!: (value: null) => void
  const lateContextPack = new Promise<null>((resolve) => {
    resolveLateContextPack = resolve
  })
  const memoryService = {
    buildContextPack: async () => {
      contextPackStarted = true
      return lateContextPack
    },
    createContextSnapshot: () => null,
    recordInclusions: async () => undefined
  }
  const lifecycleGate = new ThreadLifecycleGate()
  const events: Array<{ type: string }> = []
  const agentService = await createAgentServiceForTest({
    jingleMemoryService: memoryService,
    threadLifecycleGate: lifecycleGate
  })
  const invoke = agentService.dispatchInvoke(
    {
      message: {
        content: "cancel before run id",
        id: "message-cancel-before-run"
      },
      modelId: "bdd",
      threadId
    },
    {
      send: (event) => events.push(event)
    }
  )

  try {
    while (!contextPackStarted) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }

    const cancel = agentService.cancel({ threadId })
    const duplicateCancel = agentService.cancel({ threadId })
    assert.deepEqual(
      agentService.steerActiveRun(threadId, {
        content: "ignored after cancellation",
        id: "message-steer-after-cancel"
      }),
      { reason: "no_active_run", type: "rejected" }
    )
    assert.equal(await cancel, true)
    assert.equal(await duplicateCancel, false)
    const outcome = await invoke
    assert.equal(outcome.type, "rejected")
    assert.equal(outcome.type === "rejected" ? outcome.error.code : null, "CANCELLED")

    const runs = await getPrismaClient().run.findMany({ where: { threadId } })
    assert.equal(runs.length, 0)
    assert.equal(
      events.some((event) => event.type === "run_started"),
      false
    )

    const reclaimed = await lifecycleGate.claimRun(threadId)
    assert.equal(reclaimed.status, "accepted")
    if (reclaimed.status === "accepted") {
      reclaimed.lease.complete()
    }

    resolveLateContextPack(null)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(await getPrismaClient().run.count({ where: { threadId } }), 0)
    assert.equal(events.length, 0)
  } finally {
    consoleLog.mock.restore()
  }
})

test("agent cancel releases pending resume setup and observes its late rejection", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const { ThreadLifecycleGate } = await import("../../src/main/agent/thread-lifecycle-gate")
  const threadId = "thread-cancel-resume-before-run"
  let workspaceResolutionStarted!: () => void
  const workspaceResolutionEntered = new Promise<void>((resolve) => {
    workspaceResolutionStarted = resolve
  })
  let rejectLateWorkspaceResolution!: (error: Error) => void
  const lateWorkspaceResolution = new Promise<string | null>((_resolve, reject) => {
    rejectLateWorkspaceResolution = reject
  })
  const workspaceService = {
    getWorkspacePath: async () => {
      workspaceResolutionStarted()
      return lateWorkspaceResolution
    }
  }
  const lifecycleGate = new ThreadLifecycleGate()
  await createThread(threadId)
  const agentService = await createAgentServiceForTest({
    threadLifecycleGate: lifecycleGate,
    workspaceService
  })
  const resume = agentService.dispatchResume(
    {
      decision: {
        request_id: "request-cancel-resume-before-run",
        tool_call_id: "tool-call-cancel-resume-before-run",
        type: "approve"
      },
      modelId: "bdd",
      threadId
    },
    { send: () => undefined }
  )

  await workspaceResolutionEntered
  assert.equal(await agentService.cancel({ threadId }), true)
  const outcome = await resume
  assert.equal(outcome.type, "rejected")
  assert.equal(outcome.type === "rejected" ? outcome.error.code : null, "CANCELLED")
  assert.equal(await agentService.cancel({ threadId }), false)
  assert.equal(await getPrismaClient().run.count({ where: { threadId } }), 0)

  const reclaimed = await lifecycleGate.claimRun(threadId)
  assert.equal(reclaimed.status, "accepted")
  if (reclaimed.status === "accepted") {
    reclaimed.lease.complete()
  }

  rejectLateWorkspaceResolution(new Error("late workspace resolution failure"))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(await getPrismaClient().run.count({ where: { threadId } }), 0)
})

test("invoke admission atomically records one start and one user message event", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const consoleLog = mock.method(console, "log", () => {})
  const previousRuntimeMode = process.env.JINGLE_BDD_AGENT_RUNTIME
  const threadId = "thread-atomic-invoke-admission"

  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"

  const prisma = getPrismaClient()
  const events: Array<{ runId?: string; type: string }> = []
  const agentService = await createAgentServiceForTest()

  try {
    await agentService.invoke(
      {
        message: {
          content: "atomic invoke admission",
          id: "message-atomic-invoke"
        },
        modelId: "bdd",
        threadId
      },
      {
        send: (event) =>
          events.push({
            runId: event.type === "run_started" ? event.runId : undefined,
            type: event.type
          })
      }
    )
    const runId = events.find((event) => event.type === "run_started")?.runId
    assert.ok(runId)
    const preparationEvents = await prisma.agentEvent.findMany({
      orderBy: { seq: "asc" },
      where: {
        runId,
        type: { in: ["run.started", "message.user.created"] }
      }
    })
    assert.deepEqual(
      preparationEvents.map((event) => [event.seq, event.type]),
      [
        [1, "run.started"],
        [2, "message.user.created"]
      ]
    )
    assert.equal(
      JSON.parse(preparationEvents[1]?.payload ?? "{}").userMessageId,
      "message-atomic-invoke"
    )
  } finally {
    if (previousRuntimeMode === undefined) {
      delete process.env.JINGLE_BDD_AGENT_RUNTIME
    } else {
      process.env.JINGLE_BDD_AGENT_RUNTIME = previousRuntimeMode
    }
    consoleLog.mock.restore()
  }
})

test("invoke command reports missing workspace before accepting the command", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const threadId = "thread-invoke-missing-workspace"
  await createThread(threadId)
  const agentService = await createAgentServiceForTest()
  const events: string[] = []

  const outcome = await agentService.dispatchInvoke(
    {
      message: { content: "hello", id: "message-missing-workspace" },
      modelId: "bdd",
      threadId
    },
    { send: (event) => events.push(event.type) }
  )

  assert.deepEqual(outcome, {
    error: {
      channel: "agent:invoke",
      code: "FAILED_PRECONDITION",
      message: "Please select a workspace folder before sending messages.",
      status: 412
    },
    type: "rejected"
  })
  assert.deepEqual(events, [])
  assert.equal(await getPrismaClient().run.count({ where: { threadId } }), 0)
})

test("invoke admission rejects a required extension whose process definition is pending", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const consoleLog = mock.method(console, "log", () => {})
  const consoleWarn = mock.method(console, "warn", () => {})
  const threadId = "thread-extension-main-pending"
  const registry = createExtensionMainDefinitionRegistryForAdmission("pending")

  try {
    await createThread(threadId)
    await bindThreadWorkspace(threadId, repoRoot)
    const agentService = await createAgentServiceForTest({
      extensionRegistryReader: {
        listManifests: () => [appleRemindersManifest],
        readMainDefinitionSnapshot: () => registry.readSnapshot()
      }
    })
    const outcome = await agentService.dispatchInvoke(
      {
        message: {
          content: "use reminders",
          id: "message-extension-main-pending",
          refs: [createAppleRemindersSourceRef()]
        },
        modelId: "bdd",
        threadId
      },
      { send: () => undefined }
    )

    assert.equal(outcome.type, "rejected")
    assert.equal(outcome.type === "rejected" ? outcome.error.code : null, "UNAVAILABLE")
    assert.deepEqual(outcome.type === "rejected" ? outcome.error.details : null, [
      'Extension "apple-reminders" main definition is still loading.'
    ])
    assert.equal(await getPrismaClient().run.count({ where: { threadId } }), 0)
  } finally {
    await registry.dispose()
    consoleLog.mock.restore()
    consoleWarn.mock.restore()
  }
})

test("invoke admission rejects a required extension whose process definition failed", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const consoleLog = mock.method(console, "log", () => {})
  const consoleWarn = mock.method(console, "warn", () => {})
  const threadId = "thread-extension-main-failed"
  const registry = createExtensionMainDefinitionRegistryForAdmission("failed")

  try {
    await createThread(threadId)
    await bindThreadWorkspace(threadId, repoRoot)
    const agentService = await createAgentServiceForTest({
      extensionRegistryReader: {
        listManifests: () => [appleRemindersManifest],
        readMainDefinitionSnapshot: () => registry.readSnapshot()
      }
    })
    const outcome = await agentService.dispatchInvoke(
      {
        message: {
          content: "use reminders",
          id: "message-extension-main-failed",
          refs: [createAppleRemindersSourceRef()]
        },
        modelId: "bdd",
        threadId
      },
      { send: () => undefined }
    )

    assert.equal(outcome.type, "rejected")
    assert.equal(outcome.type === "rejected" ? outcome.error.code : null, "UNAVAILABLE")
    assert.deepEqual(outcome.type === "rejected" ? outcome.error.details : null, [
      'Extension "apple-reminders" main definition failed to load.'
    ])
    assert.equal(await getPrismaClient().run.count({ where: { threadId } }), 0)
  } finally {
    await registry.dispose()
    consoleLog.mock.restore()
    consoleWarn.mock.restore()
  }
})

test("invoke admission uses a ready required definition without waiting for unrelated modules", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const consoleLog = mock.method(console, "log", () => {})
  const consoleWarn = mock.method(console, "warn", () => {})
  const previousRuntimeMode = process.env.JINGLE_BDD_AGENT_RUNTIME
  const threadId = "thread-extension-main-ready"
  const registry = createExtensionMainDefinitionRegistryForAdmission("ready")
  process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"

  try {
    await createThread(threadId)
    await bindThreadWorkspace(threadId, repoRoot)
    const agentService = await createAgentServiceForTest({
      extensionRegistryReader: {
        listManifests: () => [appleRemindersManifest],
        readMainDefinitionSnapshot: () => registry.readSnapshot()
      }
    })
    const events: string[] = []
    const outcome = await agentService.dispatchInvoke(
      {
        message: {
          content: "bdd:long",
          id: "message-extension-main-ready",
          refs: [createAppleRemindersSourceRef()]
        },
        modelId: "bdd",
        threadId
      },
      { send: (event) => events.push(event.type) }
    )

    assert.deepEqual(outcome, { disposition: "run", type: "accepted" })
    assert.equal(await getPrismaClient().run.count({ where: { threadId } }), 1)
    assert.equal(events.includes("run_rejected"), false)
    assert.equal(await agentService.cancel({ threadId }), true)
  } finally {
    if (previousRuntimeMode === undefined) {
      delete process.env.JINGLE_BDD_AGENT_RUNTIME
    } else {
      process.env.JINGLE_BDD_AGENT_RUNTIME = previousRuntimeMode
    }
    await registry.dispose()
    consoleLog.mock.restore()
    consoleWarn.mock.restore()
  }
})

test("concurrent invoke cannot replace an active run while its projection is pending", async () => {
  const { createThread, getPrismaClient, getRun } = await loadDbModules()
  const consoleLog = mock.method(console, "log", () => {})
  const previousRuntimeMode = process.env.JINGLE_BDD_AGENT_RUNTIME
  const threadId = "thread-concurrent-invoke-projection-pending"
  let releaseProjection!: () => void
  let projectionStarted!: () => void
  let firstRunId: string | null = null
  const projectionEntered = new Promise<void>((resolve) => {
    projectionStarted = resolve
  })
  const projection = new Promise<void>((resolve) => {
    releaseProjection = resolve
  })

  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"

  const agentService = await createAgentServiceForTest()
  const firstEvents: Array<{ runId?: string; type: string }> = []
  const secondEvents: Array<{ code?: string; type: string }> = []
  const firstOutcome = await agentService.dispatchInvoke(
    {
      message: {
        content: "bdd:long",
        id: "message-concurrent-invoke-first"
      },
      modelId: "bdd",
      threadId
    },
    {
      send: (event) => {
        firstEvents.push({
          runId: "runId" in event ? event.runId : undefined,
          type: event.type
        })
      }
    },
    {
      onRunAccepted: () => {
        projectionStarted()
        void projection
      }
    }
  )

  try {
    await projectionEntered
    assert.deepEqual(firstOutcome, { disposition: "run", type: "accepted" })
    firstRunId = firstEvents.find((event) => event.type === "run_started")?.runId ?? null

    const secondOutcome = await agentService.dispatchInvoke(
      {
        message: {
          content: "must not replace the first run",
          id: "message-concurrent-invoke-second"
        },
        modelId: "bdd",
        threadId
      },
      {
        send: (event) => {
          secondEvents.push({
            code: "code" in event ? event.code : undefined,
            type: event.type
          })
        }
      }
    )

    assert.deepEqual(secondOutcome, {
      error: {
        channel: "agent:invoke",
        code: "CONFLICT",
        message: "Agent run is already in progress; follow-ups must be queued or steered.",
        status: 409
      },
      type: "rejected"
    })
    assert.deepEqual(secondEvents, [{ code: "CONFLICT", type: "run_rejected" }])
    assert.ok(firstRunId)
    assert.equal((await getRun(firstRunId))?.status, "running")
    assert.equal(await getPrismaClient().run.count({ where: { threadId } }), 1)

    assert.equal(await agentService.cancel({ threadId }), true)
    assert.equal((await getRun(firstRunId))?.status, "interrupted")
  } finally {
    releaseProjection()
    if (previousRuntimeMode === undefined) {
      delete process.env.JINGLE_BDD_AGENT_RUNTIME
    } else {
      process.env.JINGLE_BDD_AGENT_RUNTIME = previousRuntimeMode
    }
    consoleLog.mock.restore()
  }
})

test("resume admission atomically records decision and resume events", async () => {
  const { createRun, createThread, getPrismaClient, getRun, getThread, upsertHitlRequest } =
    await loadDbModules()
  const { commitAgentResumeDecision } = await import("../../src/main/agent/persistence")
  const threadId = "thread-atomic-resume-admission"
  const runId = "run-atomic-resume-admission"
  const requestId = "request-atomic-resume-admission"

  await createThread(threadId)
  await createRun(runId, threadId, { status: "interrupted" })
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-call-atomic-resume",
    tool_name: "write_file"
  })
  await commitAgentResumeDecision(
    threadId,
    runId,
    {
      request_id: requestId,
      tool_call_id: "tool-call-atomic-resume",
      type: "approve"
    },
    { requestId, source: "resume" },
    { resumeEvent: { modelId: "gpt-test" } }
  )

  assert.equal((await getRun(runId))?.status, "running")
  assert.equal((await getThread(threadId))?.status, "busy")
  const events = await getPrismaClient().agentEvent.findMany({
    orderBy: { seq: "asc" },
    where: { runId }
  })
  assert.deepEqual(
    events.map((event) => event.type),
    ["approval.resolved", "run.resumed"]
  )
  assert.deepEqual(JSON.parse(events[1]?.payload ?? "{}"), {
    model: "gpt-test",
    requestId,
    source: "resume"
  })
})

test("agent cancel records one aborted lifecycle for an active run", async () => {
  const { createThread, getPrismaClient, getRun } = await loadDbModules()
  const consoleLog = mock.method(console, "log", () => {})
  const previousRuntimeMode = process.env.JINGLE_BDD_AGENT_RUNTIME

  const threadId = "thread-cancel-active-run"
  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"

  let runId: string | null = null
  let valuesSeen = false
  const agentService = await createAgentServiceForTest()
  const invoke = agentService.invoke(
    {
      message: {
        content: "bdd:long",
        id: "message-cancel-active-run"
      },
      modelId: "bdd",
      threadId
    },
    {
      send: (event) => {
        if (event.type === "run_started") {
          runId = event.runId
        }
        if (event.type === "stream" && event.mode === "values") {
          valuesSeen = true
        }
      }
    }
  )

  try {
    while (!runId || !valuesSeen) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }

    assert.equal(await agentService.cancel({ threadId }), true)
    await invoke

    const run = await getRun(runId)
    assert.equal(run?.status, "interrupted")

    const lifecycleEvents = await getPrismaClient().agentEvent.findMany({
      orderBy: { seq: "asc" },
      where: {
        runId,
        type: {
          in: ["run.started", "run.interrupted", "run.finished"]
        }
      }
    })
    const projectedEvents = lifecycleEvents.map((event) => ({
      payload: JSON.parse(event.payload) as Record<string, unknown>,
      type: event.type
    }))
    assert.equal(projectedEvents[0]?.payload.source, "invoke")
    assert.equal(projectedEvents[0]?.payload.userMessageId, "message-cancel-active-run")
    assert.deepEqual(
      projectedEvents.map((event) => ({
        payload:
          event.type === "run.started"
            ? { source: event.payload.source, userMessageId: event.payload.userMessageId }
            : event.payload,
        type: event.type
      })),
      [
        {
          payload: {
            source: "invoke",
            userMessageId: "message-cancel-active-run"
          },
          type: "run.started"
        },
        {
          payload: {
            status: "interrupted"
          },
          type: "run.interrupted"
        },
        {
          payload: {
            completionReason: "aborted",
            errorMessage: null,
            errorType: null,
            status: "interrupted"
          },
          type: "run.finished"
        }
      ]
    )
  } finally {
    if (previousRuntimeMode === undefined) {
      delete process.env.JINGLE_BDD_AGENT_RUNTIME
    } else {
      process.env.JINGLE_BDD_AGENT_RUNTIME = previousRuntimeMode
    }
    consoleLog.mock.restore()
  }
})

test("agent deletion gate rejects invoke while thread deletion is active", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const { ThreadLifecycleGate } = await import("../../src/main/agent/thread-lifecycle-gate")
  const consoleLog = mock.method(console, "log", () => {})

  const threadId = "thread-deleting-rejects-invoke"
  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)

  let releaseDeletion: () => void = () => {
    throw new Error("Deletion gate was not entered.")
  }
  const deletionGate = new Promise<void>((resolve) => {
    releaseDeletion = resolve
  })
  const lifecycleGate = new ThreadLifecycleGate()
  const agentService = await createAgentServiceForTest({
    threadLifecycleGate: lifecycleGate
  })
  const events: Array<{ code?: string; type: string }> = []
  let runAccepted = false

  const deletion = lifecycleGate.withDeletion(threadId, async () => {
    await deletionGate
  })

  try {
    await new Promise<void>((resolve) => setImmediate(resolve))

    await agentService.invoke(
      {
        message: {
          content: "invoke while deleting",
          id: "message-deleting-rejects-invoke"
        },
        modelId: "bdd",
        threadId
      },
      {
        send: (event) => {
          events.push({ code: "code" in event ? event.code : undefined, type: event.type })
        }
      },
      {
        onRunAccepted: () => {
          runAccepted = true
        }
      }
    )

    assert.deepEqual(events, [{ code: "CONFLICT", type: "run_rejected" }])
    assert.equal(runAccepted, false)
    const runs = await getPrismaClient().run.findMany({ where: { threadId } })
    assert.equal(runs.length, 0)
  } finally {
    releaseDeletion()
    await deletion
    consoleLog.mock.restore()
  }
})

test("run failure preserves interrupted status when pending HITL remains", async () => {
  const { createRun, createThread, getPrismaClient, getRun, getThread, upsertHitlRequest } =
    await loadDbModules()
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
    tool_name: "callExtension",
    tool_args: {
      args: {
        reminderId: "reminder-2"
      },
      extensionName: "apple-reminders",
      toolName: "deleteReminder"
    },
    allowed_decisions: ["approve", "user_declined", "corrected"],
    status: "pending"
  })

  assert.equal(
    await markRunFailed(
      threadId,
      runId,
      toAgentRunFailure("agent:runtime", new Error("checkpoint write timed out"))
    ),
    "interrupted"
  )

  const run = await getRun(runId)
  const thread = await getThread(threadId)
  const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  assert.equal(run?.status, "interrupted")
  assert.equal(thread?.status, "interrupted")
  assert.deepEqual(metadata[AGENT_RUN_FAILURE_METADATA_KEY], {
    ipcCode: "INTERNAL",
    kind: "unknown",
    message: "checkpoint write timed out",
    schemaVersion: 1,
    status: 500
  })
  const finishedEvents = await getPrismaClient().agentEvent.findMany({
    where: { runId, type: "run.finished" }
  })
  assert.equal(finishedEvents.length, 1)
  assert.equal(
    (JSON.parse(finishedEvents[0]?.payload ?? "{}") as { status?: unknown }).status,
    "interrupted"
  )
})

test("thread hydrate rejects an invalid new agent run failure instead of using legacy fallback", async () => {
  const { createRun, createThread } = await loadDbModules()
  const threadsService = Object.create(ThreadsService.prototype) as ThreadsService

  for (const status of ["error", "success", "cancelled", "running"] as const) {
    const threadId = `thread-invalid-agent-run-failure-${status}`
    await createThread(threadId)
    await createRun(`run-invalid-agent-run-failure-${status}`, threadId, {
      metadata: {
        [AGENT_RUN_FAILURE_METADATA_KEY]: {
          ipcCode: "INTERNAL",
          kind: "unknown",
          message: "invalid version",
          schemaVersion: 2,
          status: 500
        },
        error: "401 authentication_error"
      },
      status
    })

    await assert.rejects(threadsService.getLatestRunSummary(threadId), /invalid agent run failure/)
  }
})

test("thread hydrate degrades legacy error text to unknown without reclassification", async () => {
  const { createRun, createThread } = await loadDbModules()
  const threadId = "thread-legacy-agent-run-failure"
  await createThread(threadId)
  await createRun("run-legacy-agent-run-failure", threadId, {
    metadata: {
      error: "401 authentication_error rate_limit context window exceeded"
    },
    status: "error"
  })
  const threadsService = Object.create(ThreadsService.prototype) as ThreadsService

  assert.deepEqual((await threadsService.getLatestRunSummary(threadId)).error, {
    ipcCode: "INTERNAL",
    kind: "unknown",
    message: "401 authentication_error rate_limit context window exceeded",
    schemaVersion: 1,
    status: 500
  })
})

test("thread hydrate maps legacy error text only for failure-bearing run statuses", async () => {
  const { createRun, createThread, getRun } = await loadDbModules()
  const threadsService = Object.create(ThreadsService.prototype) as ThreadsService
  const statuses = ["success", "cancelled", "running", "pending", "interrupted", "error"] as const

  for (const status of statuses) {
    const threadId = `thread-legacy-agent-run-failure-${status}`
    const runId = `run-legacy-agent-run-failure-${status}`
    const message = `legacy ${status} 401 authentication_error 429 rate_limit context overflow`
    await createThread(threadId)
    await createRun(runId, threadId, { metadata: { error: message }, status })

    const summary = await threadsService.getLatestRunSummary(threadId)
    assert.deepEqual(
      summary.error,
      status === "error" || status === "interrupted"
        ? {
            ipcCode: "INTERNAL",
            kind: "unknown",
            message,
            schemaVersion: 1,
            status: 500
          }
        : null
    )
    assert.deepEqual(JSON.parse((await getRun(runId))?.metadata ?? "{}"), { error: message })
  }
})

test("thread hydrate maps canonical failure only for failure-bearing run statuses", async () => {
  const { createRun, createThread, getRun } = await loadDbModules()
  const threadsService = Object.create(ThreadsService.prototype) as ThreadsService
  const statuses = ["success", "cancelled", "running", "pending", "interrupted", "error"] as const

  for (const status of statuses) {
    const threadId = `thread-canonical-agent-run-failure-${status}`
    const runId = `run-canonical-agent-run-failure-${status}`
    const failure = toAgentRunFailure("agent:runtime", new Error(`canonical ${status} failure`))
    await createThread(threadId)
    await createRun(runId, threadId, {
      metadata: { [AGENT_RUN_FAILURE_METADATA_KEY]: failure },
      status
    })

    assert.deepEqual(
      (await threadsService.getLatestRunSummary(threadId)).error,
      status === "error" || status === "interrupted" ? failure : null
    )
    assert.deepEqual(JSON.parse((await getRun(runId))?.metadata ?? "{}"), {
      [AGENT_RUN_FAILURE_METADATA_KEY]: failure
    })
  }
})

test("thread hydration fails closed for corrupt and noncanonical persisted message content", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const threadId = "thread-invalid-persisted-message-content"
  await createThread(threadId)
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const canonicalContent = [
    {
      name: "result.png",
      source: { data: "aW1hZ2U=", kind: "data", mimeType: "image/png" },
      type: "image"
    }
  ]
  await prisma.message.createMany({
    data: [
      {
        content: JSON.stringify(canonicalContent),
        createdAt: now,
        kind: "message",
        messageId: "message-canonical",
        rawHash: "hash-canonical",
        rawMessage: "{}",
        role: "assistant",
        searchText: "",
        seq: 1,
        threadId,
        updatedAt: now
      },
      {
        content: "secret raw corrupt payload",
        createdAt: now + BigInt(1),
        kind: "message",
        messageId: "message-corrupt",
        rawHash: "hash-corrupt",
        rawMessage: "{}",
        role: "user",
        searchText: "",
        seq: 2,
        threadId,
        updatedAt: now + BigInt(1)
      },
      {
        content: JSON.stringify([{ content: "legacy raw payload", type: "text" }]),
        createdAt: now + BigInt(2),
        kind: "message",
        messageId: "message-noncanonical",
        rawHash: "hash-noncanonical",
        rawMessage: "{}",
        role: "user",
        searchText: "",
        seq: 3,
        threadId,
        updatedAt: now + BigInt(2)
      }
    ]
  })

  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args)
  try {
    const service = await createThreadsServiceForTest()
    const snapshot = await service.getPersistedAgentThreadData(threadId)
    assert.deepEqual(
      snapshot.messages.messages.map((message) => message.content),
      [
        canonicalContent,
        [
          {
            reason: "malformed",
            sourceType: "persisted_message_content",
            type: "unrenderable"
          }
        ],
        [
          {
            reason: "malformed",
            sourceType: "persisted_message_content",
            type: "unrenderable"
          }
        ]
      ]
    )
    assert.equal(warnings.length, 2)
    assert.equal(JSON.stringify(warnings).includes("secret raw corrupt payload"), false)
    assert.equal(JSON.stringify(warnings).includes("legacy raw payload"), false)
  } finally {
    console.warn = originalWarn
  }
})

test("resume and successful completion clear a stale durable run failure", async () => {
  const { createRun, createThread, getRun, upsertHitlRequest } = await loadDbModules()
  const { commitAgentResumeDecision, finalizeRunWithoutCheckpoint } =
    await import("../../src/main/agent/persistence")
  const threadId = "thread-clears-stale-run-failure"
  const runId = "run-clears-stale-run-failure"
  await createThread(threadId)
  await createRun(runId, threadId, {
    metadata: {
      [AGENT_RUN_FAILURE_METADATA_KEY]: toAgentRunFailure(
        "agent:runtime",
        new Error("previous resume failed")
      ),
      error: "401 authentication_error"
    },
    status: "interrupted"
  })
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: "request-clears-stale-run-failure",
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-clears-stale-run-failure",
    tool_name: "write_file"
  })

  await commitAgentResumeDecision(
    threadId,
    runId,
    {
      request_id: "request-clears-stale-run-failure",
      tool_call_id: "tool-clears-stale-run-failure",
      type: "approve"
    },
    undefined,
    { resumeEvent: {} }
  )
  const resumedMetadata = JSON.parse((await getRun(runId))?.metadata ?? "{}") as Record<
    string,
    unknown
  >
  assert.equal(Object.hasOwn(resumedMetadata, AGENT_RUN_FAILURE_METADATA_KEY), false)
  assert.equal(Object.hasOwn(resumedMetadata, "error"), false)

  await finalizeRunWithoutCheckpoint(threadId, runId)
  const completedMetadata = JSON.parse((await getRun(runId))?.metadata ?? "{}") as Record<
    string,
    unknown
  >
  assert.equal(Object.hasOwn(completedMetadata, AGENT_RUN_FAILURE_METADATA_KEY), false)
  assert.equal(Object.hasOwn(completedMetadata, "error"), false)
  const threadsService = Object.create(ThreadsService.prototype) as ThreadsService
  assert.equal((await threadsService.getLatestRunSummary(threadId)).error, null)
})

test("abort clears stale durable failure even when checkpoint sync cannot complete", async () => {
  const { createRun, createThread, getRun } = await loadDbModules()
  const { markRunAborted } = await import("../../src/main/agent/persistence")
  const threadId = "thread-abort-clears-stale-run-failure"
  const runId = "run-abort-clears-stale-run-failure"
  await createThread(threadId)
  await createRun(runId, threadId, {
    metadata: {
      [AGENT_RUN_FAILURE_METADATA_KEY]: toAgentRunFailure(
        "agent:runtime",
        new Error("stale failure")
      ),
      error: "legacy stale failure"
    },
    status: "running"
  })

  await markRunAborted(threadId, runId)
  const metadata = JSON.parse((await getRun(runId))?.metadata ?? "{}") as Record<string, unknown>
  assert.equal(Object.hasOwn(metadata, AGENT_RUN_FAILURE_METADATA_KEY), false)
  assert.equal(Object.hasOwn(metadata, "error"), false)
})

test("agent run metadata snapshots permission mode and preserves it through resume", async () => {
  const { createThread, getRun, upsertHitlRequest } = await loadDbModules()
  const { beginAgentRun, commitAgentResumeDecision } =
    await import("../../src/main/agent/persistence")
  const { readRunPermissionModeSnapshot } = await import("../../src/main/agent/permission-mode")
  const {
    createRunExtensionAiCapabilitiesSnapshot,
    readRunExtensionAiCapabilitiesSnapshotFromMetadata,
    RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY
  } = await import("../../src/shared/extension-sources")
  const { resolveNativeExtensionAiCapabilitiesForRefsFromManifests } =
    await import("../../src/extensions/sources")

  const threadId = "thread-permission"
  await createThread(threadId)
  const aiCapabilities = resolveNativeExtensionAiCapabilitiesForRefsFromManifests(
    [
      {
        extensionName: "apple-reminders",
        name: "Apple Reminders",
        sourceId: "appleReminders",
        type: "extension-source"
      }
    ],
    [appleRemindersManifest],
    {
      permissionMode: "auto",
      platform: "darwin"
    }
  )

  const { runId } = await beginAgentRun(threadId, "gpt-test", {
    aiCapabilities,
    permissionMode: "auto",
    startEvent: {
      contentPreview: "permission snapshot",
      refs: [],
      userMessageId: "message-permission-snapshot"
    }
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
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: "request-1",
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-call-permission",
    tool_name: "write_file"
  })

  await commitAgentResumeDecision(
    threadId,
    runId,
    { request_id: "request-1", tool_call_id: "tool-call-permission", type: "approve" },
    {
      requestId: "request-1",
      source: "resume"
    },
    {
      resumeEvent: {}
    }
  )

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

test("personal memory suggestions require acceptance before becoming active memory", async () => {
  const { createRun, createThread } = await loadDbModules()
  const {
    acceptAgentMemorySuggestion,
    createAgentMemorySuggestion,
    listAgentMemoryInclusionsForRun,
    listAgentMemories,
    listAgentMemorySuggestions,
    recordAgentMemoryInclusions
  } = await import("../../src/main/db/agent-memory")

  const threadId = "thread-memory"
  const runId = "run-memory"
  await createThread(threadId)
  await createRun(runId, threadId)

  const suggestion = await createAgentMemorySuggestion({
    content: "User prefers concise implementation notes.",
    reason: "The user asked for developer-oriented documents.",
    reviewPayload: {
      evidenceIds: ["ctx:run-memory:retrieved:history_message:thread-memory:message-1"],
      evidenceRefs: [
        {
          id: "ctx:run-memory:retrieved:history_message:thread-memory:message-1",
          mode: "retrieved",
          preview: "The user asked for developer-oriented documents.",
          sourceId: "message-1",
          sourceType: "history_message",
          target: {
            messageId: "message-1",
            threadId,
            type: "history_message"
          },
          threadId,
          title: "user message"
        }
      ]
    },
    scope: "global",
    sourceRunId: runId,
    threadId,
    type: "about_me"
  })

  const pendingSuggestions = await listAgentMemorySuggestions({
    status: "pending",
    threadId
  })
  const activeMemoriesBeforeAcceptance = await listAgentMemories({ status: "active" })

  assert.equal(pendingSuggestions.length, 1)
  assert.equal(pendingSuggestions[0].suggestionId, suggestion.suggestionId)
  assert.deepEqual(pendingSuggestions[0].reviewPayload, {
    evidenceIds: ["ctx:run-memory:retrieved:history_message:thread-memory:message-1"],
    evidenceRefs: [
      {
        id: "ctx:run-memory:retrieved:history_message:thread-memory:message-1",
        mode: "retrieved",
        preview: "The user asked for developer-oriented documents.",
        sourceId: "message-1",
        sourceType: "history_message",
        target: {
          messageId: "message-1",
          threadId,
          type: "history_message"
        },
        threadId,
        title: "user message"
      }
    ]
  })
  assert.equal(activeMemoriesBeforeAcceptance.length, 0)

  const memory = await acceptAgentMemorySuggestion(suggestion.suggestionId)
  const activeMemories = await listAgentMemories({ status: "active" })
  const acceptedSuggestions = await listAgentMemorySuggestions({
    status: "accepted",
    threadId
  })

  assert.equal(memory.source, "agent_suggestion")
  assert.deepEqual(memory.metadata?.evidenceIds, [
    "ctx:run-memory:retrieved:history_message:thread-memory:message-1"
  ])
  assert.deepEqual(memory.metadata?.evidenceRefs, [
    {
      id: "ctx:run-memory:retrieved:history_message:thread-memory:message-1",
      mode: "retrieved",
      preview: "The user asked for developer-oriented documents.",
      sourceId: "message-1",
      sourceType: "history_message",
      target: {
        messageId: "message-1",
        threadId,
        type: "history_message"
      },
      threadId,
      title: "user message"
    }
  ])
  assert.equal(activeMemories.length, 1)
  assert.equal(activeMemories[0].memoryId, memory.memoryId)
  assert.equal(acceptedSuggestions.length, 1)

  await recordAgentMemoryInclusions({
    memoryIds: [memory.memoryId, memory.memoryId],
    runId,
    threadId
  })
  const inclusions = await listAgentMemoryInclusionsForRun(runId)

  assert.equal(inclusions.length, 1)
  assert.equal(inclusions[0].memoryId, memory.memoryId)
})

test("personal memory persistence normalizes scope workspace ownership", async () => {
  const {
    acceptAgentMemorySuggestion,
    createAgentMemory,
    createAgentMemorySuggestion,
    updateAgentMemory
  } = await import("../../src/main/db/agent-memory")

  const globalMemory = await createAgentMemory({
    content: "Global memory ignores workspace keys.",
    scope: "global",
    type: "about_me",
    workspaceKey: repoRoot
  })
  assert.equal(globalMemory.workspaceKey, null)

  await assert.rejects(
    createAgentMemory({
      content: "Workspace memory needs a workspace key.",
      scope: "workspace",
      type: "workspace_context"
    }),
    /Workspace-scoped memory requires workspaceKey/
  )

  const workspaceSuggestion = await createAgentMemorySuggestion({
    content: "Workspace suggestion can be accepted globally.",
    scope: "workspace",
    type: "workspace_context",
    workspaceKey: repoRoot
  })
  const acceptedAsGlobal = await acceptAgentMemorySuggestion(workspaceSuggestion.suggestionId, {
    scope: "global"
  })
  assert.equal(acceptedAsGlobal.scope, "global")
  assert.equal(acceptedAsGlobal.workspaceKey, null)

  await assert.rejects(
    updateAgentMemory(globalMemory.memoryId, { scope: "workspace" }),
    /Workspace-scoped memory requires workspaceKey/
  )
})

test("accepting workspace memory suggestions preserves suggestion workspace ownership by default", async () => {
  const { acceptAgentMemorySuggestion, createAgentMemorySuggestion } =
    await import("../../src/main/db/agent-memory")

  const suggestion = await createAgentMemorySuggestion({
    content: "Workspace A uses pnpm.",
    scope: "workspace",
    type: "workspace_context",
    workspaceKey: "workspace-a"
  })
  const memory = await acceptAgentMemorySuggestion(suggestion.suggestionId)

  assert.equal(memory.scope, "workspace")
  assert.equal(memory.workspaceKey, "workspace-a")
})

test("workspace memory suggestions cannot be accepted from a different thread workspace", async () => {
  const { createAgentMemorySuggestion } = await import("../../src/main/db/agent-memory")
  const { createThread } = await loadDbModules()
  const { JingleMemoryService } = await import("../../src/main/jingle-memory/service")

  await createThread("thread-workspace-a")
  await bindThreadWorkspace("thread-workspace-a", join(jingleHome, "workspace-a"))
  const suggestion = await createAgentMemorySuggestion({
    content: "Workspace A uses pnpm.",
    scope: "workspace",
    threadId: "thread-workspace-a",
    type: "workspace_context",
    workspaceKey: join(jingleHome, "workspace-b")
  })

  await assert.rejects(
    new JingleMemoryService().acceptSuggestion(suggestion.suggestionId, {}),
    /does not belong to the current workspace/
  )
})

test("workspace changes are blocked while thread has pending workspace memory suggestions", async () => {
  const { createAgentMemorySuggestion } = await import("../../src/main/db/agent-memory")
  const { createThread, getThreadWorkspaceBinding } = await loadDbModules()
  const threadId = "thread-pending-workspace-memory-guard"
  const workspacePath = join(jingleHome, "workspace-a")

  await createThread(threadId)
  await bindThreadWorkspace(threadId, workspacePath)
  await createAgentMemorySuggestion({
    content: "Workspace A uses pnpm.",
    scope: "workspace",
    threadId,
    type: "workspace_context",
    workspaceKey: "workspace-a"
  })

  const service = await createWorkspaceServiceForTest()

  await assert.rejects(
    service.setWorkspacePath({
      path: "workspace-b",
      threadId
    }),
    /Resolve pending workspace memories/
  )

  const binding = await getThreadWorkspaceBinding(threadId)
  assert.equal(binding?.workspace_path, workspacePath)
})

test("agent run memory snapshot stores frozen context content", async () => {
  const { createRun, createThread, getRun } = await loadDbModules()
  const { beginAgentRun } = await import("../../src/main/agent/persistence")
  const { JingleMemoryService } = await import("../../src/main/jingle-memory/service")
  const { JINGLE_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY } =
    await import("../../src/shared/jingle-memory")

  const service = new JingleMemoryService()
  const threadId = "thread-memory-snapshot"
  const workspaceIdentity = {
    canonicalWorkspacePath: repoRoot,
    displayName: "jingle",
    workspaceKey: repoRoot
  }
  const contextPack = {
    canonicalWorkspacePath: repoRoot,
    generatedAt: 1,
    items: [
      {
        content: "Freeze this personal memory body in run metadata.",
        id: "memory:memory-snapshot",
        kind: "about_me" as const,
        scope: "global" as const,
        sourceLabel: "Global personal memory",
        sourceType: "structured" as const,
        structuredMemoryId: "memory-snapshot"
      }
    ],
    workspaceIdentity,
    workspaceKey: repoRoot
  }
  await createThread(threadId)
  await createRun("run-memory-snapshot-source", threadId)

  const { runId } = await beginAgentRun(threadId, "gpt-test", {
    jingleMemoryContextSnapshot: service.createContextSnapshot(contextPack),
    startEvent: {
      contentPreview: "memory snapshot",
      refs: [],
      userMessageId: "message-memory-snapshot"
    }
  })
  const run = await getRun(runId)
  const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  const snapshot = metadata[JINGLE_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY] as {
    items: Array<Record<string, unknown>>
  }

  assert.equal(run?.metadata?.includes("Freeze this personal memory body"), true)
  assert.equal(snapshot.items[0]?.structuredMemoryId, "memory-snapshot")
  assert.equal(snapshot.items[0]?.content, "Freeze this personal memory body in run metadata.")
})

test("memory context snapshot rebuild uses frozen file content", async () => {
  const { JingleMemoryService } = await import("../../src/main/jingle-memory/service")
  const { resolveJingleWorkspaceIdentity } = await import("../../src/main/workspace/identity")

  const workspacePath = await mkdtemp(join(jingleHome, "workspace-memory-snapshot-"))
  await mkdir(join(workspacePath, ".jingle"), { recursive: true })
  await writeFile(join(workspacePath, ".jingle", "AGENTS.md"), "Workspace rule for resume.")

  const service = new JingleMemoryService()
  const contextPack = await service.buildContextPack({
    workspaceIdentity: await resolveJingleWorkspaceIdentity(workspacePath)
  })
  const snapshot = service.createContextSnapshot(contextPack)
  await writeFile(join(workspacePath, ".jingle", "AGENTS.md"), "Changed after snapshot.")
  const rebuilt = service.rebuildContextPackFromSnapshot(snapshot)

  assert.equal(
    rebuilt?.items.some(
      (item) => item.id === "workspace:agents" && item.content === "Workspace rule for resume."
    ),
    true
  )
})

test("memory off and temporary mode keep file context but exclude structured memory", async () => {
  const { createAgentMemory } = await import("../../src/main/db/agent-memory")
  const { JingleMemoryService } = await import("../../src/main/jingle-memory/service")
  const { resolveJingleWorkspaceIdentity } = await import("../../src/main/workspace/identity")
  const { setJingleMemorySettings } = await import("../../src/main/preferences")

  const workspacePath = await mkdtemp(join(jingleHome, "workspace-memory-off-"))
  await mkdir(join(workspacePath, ".jingle"), { recursive: true })
  await writeFile(join(workspacePath, ".jingle", "AGENTS.md"), "Workspace rule stays active.")
  const workspaceIdentity = await resolveJingleWorkspaceIdentity(workspacePath)
  await createAgentMemory({
    content: "Structured memory should be disabled.",
    scope: "global",
    type: "about_me"
  })

  const service = new JingleMemoryService()
  setJingleMemorySettings({ useMemory: false })
  const memoryOffPack = await service.buildContextPack({ workspaceIdentity })
  const temporaryPack = await service.buildContextPack({ temporaryMode: true, workspaceIdentity })
  setJingleMemorySettings({ useMemory: true })

  assert.equal(
    memoryOffPack?.items.some((item) => item.id === "workspace:agents"),
    true
  )
  assert.equal(
    memoryOffPack?.items.some((item) => item.kind === "about_me"),
    false
  )
  assert.equal(
    temporaryPack?.items.some((item) => item.id === "workspace:agents"),
    true
  )
  assert.equal(
    temporaryPack?.items.some((item) => item.kind === "about_me"),
    false
  )
})

test("provided context inclusions distinguish structured memory from temporary file context", async () => {
  const { buildProvidedContextInclusions } = await import("../../src/shared/jingle-memory")

  const workspaceIdentity = {
    canonicalWorkspacePath: repoRoot,
    displayName: "jingle",
    workspaceKey: repoRoot
  }
  const contextPack = {
    canonicalWorkspacePath: repoRoot,
    generatedAt: 123,
    items: [
      {
        content: "Remembered stable preference.",
        id: "memory:memory-provided",
        kind: "about_me" as const,
        scope: "global" as const,
        sourceLabel: "Global personal memory",
        sourceType: "structured" as const,
        structuredMemoryId: "memory-provided"
      },
      {
        content: "Workspace rule body.",
        id: "workspace:agents",
        kind: "rules" as const,
        scope: "workspace" as const,
        sourceLabel: "Workspace AGENTS.md",
        sourceType: "file" as const
      }
    ],
    workspaceIdentity,
    workspaceKey: repoRoot
  }
  const temporaryContextPack = {
    ...contextPack,
    items: contextPack.items.filter((item) => item.sourceType === "file"),
    temporaryMode: true
  }

  const inclusions = buildProvidedContextInclusions({
    contextPack,
    runId: "run-provided",
    threadId: "thread-provided"
  })
  const temporaryInclusions = buildProvidedContextInclusions({
    contextPack: temporaryContextPack,
    runId: "run-temporary",
    threadId: "thread-temporary"
  })

  assert.equal(inclusions.length, 2)
  assert.equal(inclusions[0]?.mode, "provided")
  assert.equal(inclusions[0]?.sourceType, "memory")
  assert.equal(inclusions[0]?.target.memoryId, "memory-provided")
  assert.equal(inclusions[1]?.sourceType, "context_file")
  assert.equal(inclusions[1]?.target.path, "workspace:agents")
  assert.deepEqual(
    temporaryInclusions.map((inclusion) => inclusion.sourceType),
    ["context_file"]
  )
})

test("memory context snapshots truncate large file context", async () => {
  const { JingleMemoryService } = await import("../../src/main/jingle-memory/service")
  const service = new JingleMemoryService()
  const workspaceIdentity = {
    canonicalWorkspacePath: repoRoot,
    displayName: "jingle",
    workspaceKey: repoRoot
  }
  const snapshot = service.createContextSnapshot({
    canonicalWorkspacePath: repoRoot,
    generatedAt: 1,
    items: [
      {
        content: "x".repeat(60_000),
        id: "workspace:agents",
        kind: "rules",
        scope: "workspace",
        sourceLabel: "Workspace AGENTS.md",
        sourceType: "file"
      }
    ],
    workspaceIdentity,
    workspaceKey: repoRoot
  })

  assert.equal(snapshot?.snapshotTruncated, true)
  assert.equal(snapshot?.items[0].truncated, true)
  assert.equal(snapshot?.items[0].content.length, 8_000)
})

test("run metadata updates preserve loaded extension snapshots and resume metadata", async () => {
  const { createThread, getRun, upsertHitlRequest } = await loadDbModules()
  const { beginAgentRun, commitAgentResumeDecision, updateRunExtensionAiCapabilitiesSnapshot } =
    await import("../../src/main/agent/persistence")
  const { readRunExtensionAiCapabilitiesSnapshotFromMetadata } =
    await import("../../src/shared/extension-sources")
  const { resolveNativeExtensionAiCapabilitiesForRefsFromManifests } =
    await import("../../src/extensions/sources")

  const threadId = "thread-extension-metadata-merge"
  await createThread(threadId)

  const { runId } = await beginAgentRun(threadId, "gpt-test", {
    aiCapabilities: [],
    permissionMode: "ask-to-edit",
    startEvent: {
      contentPreview: "extension metadata merge",
      refs: [],
      userMessageId: "message-extension-metadata-merge"
    }
  })
  const aiCapabilities = resolveNativeExtensionAiCapabilitiesForRefsFromManifests(
    [
      {
        extensionName: "apple-reminders",
        name: "Apple Reminders",
        sourceId: "appleReminders",
        type: "extension-source"
      }
    ],
    [appleRemindersManifest],
    {
      permissionMode: "ask-to-edit",
      platform: "darwin"
    }
  )
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: "request-loaded-extension",
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-call-loaded-extension",
    tool_name: "write_file"
  })

  await Promise.all([
    updateRunExtensionAiCapabilitiesSnapshot(runId, {
      aiCapabilities
    }),
    commitAgentResumeDecision(
      threadId,
      runId,
      {
        request_id: "request-loaded-extension",
        tool_call_id: "tool-call-loaded-extension",
        type: "approve"
      },
      {
        requestId: "request-loaded-extension",
        source: "resume"
      },
      {
        resumeEvent: {}
      }
    )
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

test("checkpoint writes are serialized on one saver instance", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-checkpoint-write-queue"
  const checkpointId = "checkpoint-write-queue"
  const jsonSerializer: SerializerProtocol = {
    dumpsTyped: async (value: unknown) => ["json", Buffer.from(JSON.stringify(value), "utf8")],
    loadsTyped: async (_type: string, value: Uint8Array | string) =>
      JSON.parse(typeof value === "string" ? value : Buffer.from(value).toString("utf8"))
  }
  let firstWriteBlocked = false
  let releaseFirstWrite: () => void = () => {
    throw new Error("First checkpoint write did not reach the serializer.")
  }
  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve
  })
  let activeWrites = 0
  let maxActiveWrites = 0
  let serializedSecondWrite = false
  const blockingSerializer: SerializerProtocol = {
    dumpsTyped: async (value: unknown) => {
      if (value && typeof value === "object" && "marker" in value) {
        activeWrites += 1
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites)
        try {
          if ((value as { marker?: unknown }).marker === "first") {
            firstWriteBlocked = true
            await firstWriteGate
          }
          if ((value as { marker?: unknown }).marker === "second") {
            serializedSecondWrite = true
          }
        } finally {
          activeWrites -= 1
        }
      }

      return jsonSerializer.dumpsTyped(value)
    },
    loadsTyped: (type, value) => jsonSerializer.loadsTyped(type, value)
  }

  await createThread(threadId)
  const saver = new PrismaCheckpointSaver(blockingSerializer)
  const firstWrite = saver.putWrites(
    {
      configurable: {
        checkpoint_id: checkpointId,
        thread_id: threadId
      }
    },
    [["messages", { marker: "first" }]],
    "task-first"
  )
  const secondWrite = saver.putWrites(
    {
      configurable: {
        checkpoint_id: checkpointId,
        thread_id: threadId
      }
    },
    [["messages", { marker: "second" }]],
    "task-second"
  )

  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(firstWriteBlocked, true)
  assert.equal(serializedSecondWrite, false)
  assert.equal(maxActiveWrites, 1)

  releaseFirstWrite()
  await Promise.all([firstWrite, secondWrite])

  const rows = await getPrismaClient().checkpointWrite.findMany({
    orderBy: [{ taskId: "asc" }, { idx: "asc" }],
    where: {
      checkpointId,
      threadId
    }
  })
  assert.deepEqual(
    rows.map((row) => row.taskId),
    ["task-first", "task-second"]
  )
  assert.equal(maxActiveWrites, 1)
})

test("prisma checkpoint saver stores message facts without runtime side effects", async () => {
  const { createThread, createRun, getLatestHitlRequest, getPrismaClient } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-pure-checkpoint-store"
  const runId = "run-pure-checkpoint-store"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "running" })

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-pure-store"
  checkpoint.channel_values = {
    __interrupt__: [
      {
        value: {
          actionRequests: [
            {
              args: { path: `${repoRoot}/pending.txt` },
              name: "write_file",
              toolCallId: "tool-call-pure-store"
            }
          ]
        }
      }
    ],
    messages: [{ kwargs: { content: "needs approval", id: "message-user-pure" }, type: "human" }]
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

  const prisma = getPrismaClient()
  const searchRows = await prisma.$queryRawUnsafe<Array<{ search_text: string }>>(
    `SELECT search_text FROM "messages_fts" WHERE thread_id = ?`,
    threadId
  )
  const messageEvents = await prisma.messageEvent.findMany({ where: { threadId } })
  const messageStateVersions = await prisma.messageStateVersion.findMany({ where: { threadId } })

  assert.equal(searchRows.length, 1)
  assert.deepEqual(
    messageEvents.map((event) => `${event.type}:${event.messageId ?? ""}`),
    ["message.upsert:message-user-pure"]
  )
  assert.deepEqual(
    messageStateVersions.map((version) => version.version),
    [checkpoint.id]
  )
  assert.equal(await getLatestHitlRequest(threadId), null)
})

test("prisma checkpoint saver stores channel values as reusable checkpoint blobs", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-checkpoint-blobs"
  await createThread(threadId)

  const firstCheckpoint = emptyCheckpoint()
  firstCheckpoint.id = "checkpoint-blob-0001"
  firstCheckpoint.channel_values = {
    messages: [{ kwargs: { content: "first", id: "message-first" }, type: "human" }],
    todos: [{ content: "keep me", id: "todo-1", status: "pending" }]
  }
  firstCheckpoint.channel_versions = {
    messages: "checkpoint-blob-messages-0001",
    todos: "checkpoint-blob-todos-0001"
  }

  const secondCheckpoint = emptyCheckpoint()
  secondCheckpoint.id = "checkpoint-blob-0002"
  secondCheckpoint.channel_values = {
    messages: [
      { kwargs: { content: "first", id: "message-first" }, type: "human" },
      { kwargs: { content: "second", id: "message-second" }, type: "ai" }
    ],
    todos: [{ content: "keep me", id: "todo-1", status: "pending" }]
  }
  secondCheckpoint.channel_versions = {
    messages: "checkpoint-blob-messages-0002",
    todos: "checkpoint-blob-todos-0001"
  }

  const saver = new PrismaCheckpointSaver()
  const firstConfig = await saver.put(
    {
      configurable: {
        thread_id: threadId
      }
    },
    firstCheckpoint,
    {
      parents: {},
      source: "update",
      step: 0
    },
    {
      messages: "checkpoint-blob-messages-0001",
      todos: "checkpoint-blob-todos-0001"
    }
  )
  await saver.put(
    firstConfig,
    secondCheckpoint,
    {
      parents: { "": firstCheckpoint.id },
      source: "update",
      step: 1
    },
    {
      messages: "checkpoint-blob-messages-0002"
    }
  )

  const prisma = getPrismaClient()
  const checkpointRows = await prisma.checkpoint.findMany({
    orderBy: { checkpointId: "asc" },
    where: { threadId }
  })
  const blobRows = await prisma.checkpointBlob.findMany({
    orderBy: [{ channel: "asc" }, { version: "asc" }],
    where: { threadId }
  })
  const eventRows = await prisma.messageEvent.findMany({
    orderBy: { seq: "asc" },
    where: { threadId }
  })
  const stateVersionRows = await prisma.messageStateVersion.findMany({
    orderBy: { version: "asc" },
    where: { threadId }
  })
  const latest = await saver.getTuple({
    configurable: {
      thread_id: threadId
    }
  })

  assert.equal(checkpointRows.length, 2)
  assert.equal(
    checkpointRows.every((row) => !row.checkpoint?.includes("channel_values")),
    true
  )
  assert.deepEqual(
    blobRows.map((row) => `${row.channel}:${row.version}`),
    ["todos:checkpoint-blob-todos-0001"]
  )
  assert.deepEqual(
    stateVersionRows.map((row) => `${row.version}:${row.throughSeq}`),
    ["checkpoint-blob-messages-0001:1", "checkpoint-blob-messages-0002:2"]
  )
  assert.deepEqual(
    eventRows.map((row) => `${row.type}:${row.messageId ?? ""}`),
    ["message.upsert:message-first", "message.upsert:message-second"]
  )
  assert.deepEqual(latest?.checkpoint.channel_values, secondCheckpoint.channel_values)
})

test("prisma checkpoint saver stores pregel task messages as checkpoint refs", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const { decodeSerializedPayload } = await import("../../src/main/checkpointer/storage-codec")
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-pregel-task-message-ref"
  await createThread(threadId)

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-pregel-task-message-ref"
  checkpoint.channel_values = {
    messages: [
      {
        kwargs: {
          content: "this complete message must not be duplicated into writes",
          id: "message-ref-source"
        },
        type: "human"
      }
    ]
  }
  checkpoint.channel_versions = {
    messages: "checkpoint-pregel-task-message-ref-version"
  }

  const saver = new PrismaCheckpointSaver()
  const config = await saver.put(
    {
      configurable: {
        thread_id: threadId
      }
    },
    checkpoint,
    {
      parents: {},
      source: "update",
      step: 0
    },
    {
      messages: "checkpoint-pregel-task-message-ref-version"
    }
  )
  await saver.putWrites(
    config,
    [
      [
        "__pregel_tasks",
        {
          args: {
            messages: checkpoint.channel_values.messages,
            todos: [{ content: "keep pending task shape", id: "todo-ref" }]
          },
          node: "tools"
        }
      ]
    ],
    "task-pregel-message-ref"
  )

  const writeRow = await getPrismaClient().checkpointWrite.findFirstOrThrow({
    where: {
      channel: "__pregel_tasks",
      checkpointId: checkpoint.id,
      threadId
    }
  })
  const storedPayload = decodeSerializedPayload(writeRow.type, writeRow.value)
  const storedWriteJson =
    typeof storedPayload.value === "string"
      ? storedPayload.value
      : Buffer.from(storedPayload.value).toString("utf8")
  const storedWrite = JSON.parse(storedWriteJson) as {
    args?: { messages?: unknown }
  }
  assert.equal(storedWriteJson.includes("this complete message must not be duplicated"), false)
  assert.deepEqual(storedWrite.args?.messages, {
    __jingleRef: "checkpoint-channel",
    channel: "messages"
  })

  const tuple = await saver.getTuple({
    configurable: {
      checkpoint_id: checkpoint.id,
      thread_id: threadId
    }
  })
  assert.deepEqual(tuple?.pendingWrites, [
    [
      "task-pregel-message-ref",
      "__pregel_tasks",
      {
        args: {
          messages: checkpoint.channel_values.messages,
          todos: [{ content: "keep pending task shape", id: "todo-ref" }]
        },
        node: "tools"
      }
    ]
  ])
})

test("prisma checkpoint saver stores messages as delta events", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-message-state-delta-events"
  await createThread(threadId)

  const firstCheckpoint = emptyCheckpoint()
  firstCheckpoint.id = "checkpoint-message-delta-0001"
  firstCheckpoint.channel_values = {
    messages: [{ kwargs: { content: "first", id: "message-first" }, type: "human" }]
  }
  firstCheckpoint.channel_versions = {
    messages: "message-delta-v1"
  }

  const secondCheckpoint = emptyCheckpoint()
  secondCheckpoint.id = "checkpoint-message-delta-0002"
  secondCheckpoint.channel_values = {
    messages: [
      { kwargs: { content: "first", id: "message-first" }, type: "human" },
      { kwargs: { content: "second", id: "message-second" }, type: "ai" }
    ]
  }
  secondCheckpoint.channel_versions = {
    messages: "message-delta-v2"
  }

  const thirdCheckpoint = emptyCheckpoint()
  thirdCheckpoint.id = "checkpoint-message-delta-0003"
  thirdCheckpoint.channel_values = {
    messages: secondCheckpoint.channel_values.messages
  }
  thirdCheckpoint.channel_versions = {
    messages: "message-delta-v3"
  }

  const saver = new PrismaCheckpointSaver()
  const firstConfig = await saver.put(
    {
      configurable: {
        thread_id: threadId
      }
    },
    firstCheckpoint,
    {
      parents: {},
      source: "update",
      step: 0
    }
  )
  const secondConfig = await saver.put(firstConfig, secondCheckpoint, {
    parents: { "": firstCheckpoint.id },
    source: "update",
    step: 1
  })
  await saver.put(secondConfig, thirdCheckpoint, {
    parents: { "": secondCheckpoint.id },
    source: "update",
    step: 2
  })

  const prisma = getPrismaClient()
  const blobRows = await prisma.checkpointBlob.findMany({
    where: { threadId }
  })
  const eventRows = await prisma.messageEvent.findMany({
    orderBy: { seq: "asc" },
    where: { threadId }
  })
  const stateVersionRows = await prisma.messageStateVersion.findMany({
    orderBy: { version: "asc" },
    where: { threadId }
  })
  const latest = await saver.getTuple({
    configurable: {
      thread_id: threadId
    }
  })

  assert.deepEqual(blobRows, [])
  assert.deepEqual(
    eventRows.map((row) => `${row.seq}:${row.type}:${row.messageId ?? ""}`),
    ["1:message.upsert:message-first", "2:message.upsert:message-second"]
  )
  assert.deepEqual(
    stateVersionRows.map((row) => `${row.version}:${row.throughSeq}`),
    ["message-delta-v1:1", "message-delta-v2:2", "message-delta-v3:2"]
  )
  assert.deepEqual(
    latest?.checkpoint.channel_values.messages,
    secondCheckpoint.channel_values.messages
  )
})

test("prisma checkpoint saver derives ids for messages without provider ids", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-message-state-derived-id"
  await createThread(threadId)

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-message-derived-id"
  checkpoint.channel_values = {
    messages: [{ content: "provider omitted id", type: "human" }]
  }
  checkpoint.channel_versions = {
    messages: "message-derived-id-v1"
  }

  const saver = new PrismaCheckpointSaver()
  await saver.put(
    {
      configurable: {
        thread_id: threadId
      }
    },
    checkpoint,
    {
      parents: {},
      source: "update",
      step: 0
    }
  )

  const prisma = getPrismaClient()
  const [event] = await prisma.messageEvent.findMany({ where: { threadId } })
  const [message] = await prisma.message.findMany({ where: { threadId } })

  assert.equal(event?.type, "message.upsert")
  assert.match(event?.messageId ?? "", /^message:[a-f0-9]{64}:1:user$/)
  assert.equal(message?.messageId, event?.messageId)
})

test("prisma checkpoint saver stores empty blobs for versioned channels without values", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-checkpoint-empty-versioned-channels"
  await createThread(threadId)

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-empty-versioned-channels"
  checkpoint.channel_values = {
    messages: [{ kwargs: { content: "retry", id: "message-retry" }, type: "human" }]
  }
  checkpoint.channel_versions = {
    __pregel_tasks: "checkpoint-empty-pregel-tasks",
    __start__: "checkpoint-empty-start",
    messages: "checkpoint-empty-messages"
  }

  const saver = new PrismaCheckpointSaver()
  await saver.put(
    {
      configurable: {
        thread_id: threadId
      }
    },
    checkpoint,
    {
      parents: {},
      source: "input",
      step: 0
    },
    {
      messages: "checkpoint-empty-messages"
    }
  )

  const prisma = getPrismaClient()
  const blobRows = await prisma.checkpointBlob.findMany({
    orderBy: [{ channel: "asc" }, { version: "asc" }],
    where: { threadId }
  })
  const stateVersionRows = await prisma.messageStateVersion.findMany({
    where: { threadId }
  })
  const latest = await saver.getTuple({
    configurable: {
      thread_id: threadId
    }
  })

  assert.deepEqual(
    blobRows.map((row) => `${row.channel}:${row.version}:${row.type}`),
    ["__pregel_tasks:checkpoint-empty-pregel-tasks:empty", "__start__:checkpoint-empty-start:empty"]
  )
  assert.deepEqual(
    stateVersionRows.map((row) => row.version),
    ["checkpoint-empty-messages"]
  )
  assert.deepEqual(latest?.checkpoint.channel_values, checkpoint.channel_values)
})

test("prisma checkpoint saver advances restored string channel versions", async () => {
  const { createThread } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-checkpoint-string-version"
  await createThread(threadId)

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-string-version-0001"
  checkpoint.channel_values = {
    artifacts: {
      manifestsById: {},
      presentationsByIdempotencyKey: {}
    }
  }
  checkpoint.channel_versions = {}

  const saver = new PrismaCheckpointSaver()
  await saver.put(
    {
      configurable: {
        thread_id: threadId
      }
    },
    checkpoint,
    {
      parents: {},
      source: "update",
      step: 0
    },
    {}
  )

  const latest = await saver.getTuple({
    configurable: {
      thread_id: threadId
    }
  })
  const restoredVersion = latest?.checkpoint.channel_versions.artifacts

  assert.equal(restoredVersion, checkpoint.id)
  assert.equal(typeof saver.getNextVersion(restoredVersion), "string")
  assert.notEqual(saver.getNextVersion(restoredVersion), restoredVersion)
})

test("prisma checkpoint saver rejects non-string channel versions", async () => {
  const { createThread } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-checkpoint-numeric-version"
  await createThread(threadId)

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-numeric-version-0001"
  checkpoint.channel_values = {
    messages: [{ kwargs: { content: "first", id: "message-first" }, type: "human" }]
  }
  checkpoint.channel_versions = {
    messages: 10
  }

  const saver = new PrismaCheckpointSaver()
  await assert.rejects(
    saver.put(
      {
        configurable: {
          thread_id: threadId
        }
      },
      checkpoint,
      {
        parents: {},
        source: "input",
        step: 0
      },
      checkpoint.channel_versions
    ),
    /non-string version/
  )
})

test("syncRunFromLatestCheckpoint accepts submitted message in message projection", async () => {
  const { createRun, createThread, getRun } = await loadDbModules()
  const { syncRunFromLatestCheckpoint } = await import("../../src/main/agent/persistence")
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-with-submitted-message"
  const runId = "run-with-submitted-message"

  await createThread(threadId)
  await createRun(runId, threadId, { status: "running" })

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-with-submitted-message"
  checkpoint.channel_values = {
    messages: [{ content: "new", id: "message-new", type: "human" }]
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
      source: "input",
      step: 0
    }
  )

  await assert.doesNotReject(
    syncRunFromLatestCheckpoint(threadId, runId, {
      expectedMessageId: "message-new"
    })
  )
  assert.equal((await getRun(runId))?.status, "success")
})

test("syncRunFromLatestCheckpoint rejects success when submitted message is missing", async () => {
  const { createRun, createThread, getRun } = await loadDbModules()
  const { syncRunFromLatestCheckpoint } = await import("../../src/main/agent/persistence")
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const threadId = "thread-missing-submitted-message"
  const runId = "run-missing-submitted-message"

  await createThread(threadId)
  await createRun(runId, threadId, { status: "running" })

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-missing-submitted-message"
  checkpoint.channel_values = {
    messages: [{ kwargs: { content: "old", id: "message-old" }, type: "human" }]
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
      source: "input",
      step: 0
    }
  )

  await assert.rejects(
    syncRunFromLatestCheckpoint(threadId, runId, {
      expectedMessageId: "message-new"
    }),
    /does not include submitted message/
  )
  assert.equal((await getRun(runId))?.status, "running")
})

test("runtime checkpointer syncs derived thread state after checkpoint writes", async () => {
  const { createThread, createRun, getLatestHitlRequest, getPrismaClient } = await loadDbModules()
  const { RuntimeCheckpointSaver, flushMessageSearchProjection } =
    await import("../../src/main/checkpointer/runtime-checkpointer")

  const threadId = "thread-runtime-checkpoint-store"
  const runId = "run-runtime-checkpoint-store"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "running" })

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-runtime-store"
  checkpoint.channel_values = {
    __interrupt__: [
      {
        value: {
          actionRequests: [
            {
              args: { path: `${repoRoot}/pending.txt` },
              name: "write_file",
              toolCallId: "tool-call-runtime-store"
            }
          ]
        }
      }
    ],
    messages: [{ kwargs: { content: "needs approval", id: "message-user-runtime" }, type: "human" }]
  }

  const saver = new RuntimeCheckpointSaver()
  try {
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

    assert.equal((await getLatestHitlRequest(threadId))?.tool_call_id, "tool-call-runtime-store")

    await flushMessageSearchProjection()

    const prisma = getPrismaClient()
    const messageRows = await prisma.message.findMany({ where: { threadId } })
    const searchRows = await prisma.$queryRawUnsafe<Array<{ search_text: string }>>(
      `SELECT search_text FROM "messages_fts" WHERE thread_id = ?`,
      threadId
    )

    assert.equal(messageRows.length, 1)
    assert.equal(searchRows.length, 1)
    assert.match(searchRows[0]!.search_text, /needs approval/)
  } finally {
    await saver.close()
  }
})

test("runtime checkpointer stores message facts in the checkpoint transaction", async () => {
  const { createThread, createRun, getLatestHitlRequest, getPrismaClient } = await loadDbModules()
  const { RuntimeCheckpointSaver, flushMessageSearchProjection } =
    await import("../../src/main/checkpointer/runtime-checkpointer")
  const threadId = "thread-runtime-search-failure"
  const runId = "run-runtime-search-failure"

  await createThread(threadId)
  await createRun(runId, threadId, { status: "running" })

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-runtime-search-failure"
  checkpoint.channel_values = {
    __interrupt__: [
      {
        value: {
          actionRequests: [
            {
              args: { path: `${repoRoot}/pending.txt` },
              name: "write_file",
              toolCallId: "tool-call-search-failure"
            }
          ]
        }
      }
    ],
    messages: [{ kwargs: { content: "still saved", id: "message-search-failure" }, type: "human" }]
  }

  const saver = new RuntimeCheckpointSaver()
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
  await flushMessageSearchProjection()

  const prisma = getPrismaClient()
  const checkpointRows = await prisma.checkpoint.findMany({ where: { threadId } })
  const messageEvents = await prisma.messageEvent.findMany({ where: { threadId } })
  const messageStateVersions = await prisma.messageStateVersion.findMany({ where: { threadId } })
  const searchRows = await prisma.$queryRawUnsafe<Array<{ search_text: string }>>(
    `SELECT search_text FROM "messages_fts" WHERE thread_id = ?`,
    threadId
  )

  assert.equal(checkpointRows.length, 1)
  assert.equal((await getLatestHitlRequest(threadId))?.tool_call_id, "tool-call-search-failure")
  assert.deepEqual(
    messageEvents.map((event) => `${event.type}:${event.messageId ?? ""}`),
    ["message.upsert:message-search-failure"]
  )
  assert.deepEqual(
    messageStateVersions.map((version) => version.version),
    [checkpoint.id]
  )
  assert.equal(searchRows.length, 1)
})

test("closeRuntimeCheckpointers closes checkpointers without a message projection queue", async () => {
  const { closeRuntimeCheckpointers, getCheckpointer } =
    await import("../../src/main/checkpointer/runtime-checkpointer-manager")
  const threadId = "thread-close-runtime-no-search-projection"
  const firstSaver = await getCheckpointer(threadId)

  await closeRuntimeCheckpointers()

  const secondSaver = await getCheckpointer(threadId)
  assert.notEqual(secondSaver, firstSaver)
  await closeRuntimeCheckpointers()
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
      checkpoint_run_id: firstRunId,
      thread_id: threadId
    }
  })

  assert.equal(latestForThread?.checkpoint.id, secondCheckpoint.id)
  assert.equal(latestForThread?.config.configurable?.run_id, undefined)
  assert.equal(firstRunScoped?.checkpoint.id, firstCheckpoint.id)
  assert.equal(firstRunScoped?.config.configurable?.run_id, firstRunId)
})

test("thread delete cancels never-resolving read-only runtime setup before removing metadata", async () => {
  const { createThread, getThread } = await loadDbModules()
  const { ThreadLifecycleGate } = await import("../../src/main/agent/thread-lifecycle-gate")
  const consoleLog = mock.method(console, "log", () => {})

  const threadId = "thread-delete-waits-for-runtime"
  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)

  let contextPackStarted = false
  const memoryService = {
    buildContextPack: async () => {
      contextPackStarted = true
      return new Promise<null>(() => {})
    },
    createContextSnapshot: () => null,
    recordInclusions: async () => undefined
  }
  const lifecycleGate = new ThreadLifecycleGate()
  const agentService = await createAgentServiceForTest({
    jingleMemoryService: memoryService,
    threadLifecycleGate: lifecycleGate
  })
  const service = await createThreadsServiceForTest({
    threadLifecycleGate: lifecycleGate
  })

  const invoke = agentService.invoke(
    {
      message: {
        content: "delete while starting",
        id: "message-delete-while-starting"
      },
      modelId: "bdd",
      threadId
    },
    {
      send: () => undefined
    }
  )

  try {
    while (!contextPackStarted) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }

    await service.delete(threadId)
    await invoke
    assert.equal(await getThread(threadId), null)
  } finally {
    consoleLog.mock.restore()
  }
})

test("cloneUntilMessage branches from the checkpoint that first contains the target message", async () => {
  const { createRun, createThread, getPrismaClient } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")
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
  await bindThreadWorkspace(sourceThreadId, repoRoot)
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

  const service = await createThreadsServiceForTest()
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
  const clonedSaver = new PrismaCheckpointSaver()
  const clonedCheckpoint = await clonedSaver.getTuple({
    configurable: {
      thread_id: clonedThread.thread_id
    }
  })

  assert.deepEqual(
    clonedCheckpointRows.map((checkpoint) => checkpoint.checkpointId),
    [firstCheckpoint.id]
  )
  assert.deepEqual(
    clonedCheckpointRows.map((checkpoint) => checkpoint.runId),
    [null]
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
  assert.deepEqual(
    clonedCheckpoint?.checkpoint.channel_values.messages,
    firstCheckpoint.channel_values.messages
  )
})

test("cloneThread copies checkpoint payload rows without preserving source run ownership", async () => {
  const { cloneThread, createRun, createThread, getPrismaClient } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")

  const sourceThreadId = "thread-clone-checkpoint-source"
  const targetThreadId = "thread-clone-checkpoint-target"
  const runId = "run-clone-checkpoint-source"
  const largeContent = "large checkpoint payload ".repeat(12_000)

  await createThread(sourceThreadId, {
    metadata: {
      model: "openai:gpt-test"
    },
    title: "Clone checkpoint source"
  })
  await createRun(runId, sourceThreadId, { status: "success" })

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-clone-payload"
  checkpoint.channel_values = {
    messages: [
      {
        kwargs: {
          content: largeContent,
          id: "message-clone-payload"
        },
        type: "human"
      }
    ],
    todos: [{ content: "copied todo", id: "todo-clone-payload", status: "pending" }]
  }
  checkpoint.channel_versions = {
    messages: "checkpoint-clone-messages-version",
    todos: "checkpoint-clone-todos-version"
  }

  const saver = new PrismaCheckpointSaver()
  const config = await saver.put(
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
    },
    {
      messages: "checkpoint-clone-messages-version",
      todos: "checkpoint-clone-todos-version"
    }
  )
  await saver.putWrites(
    config,
    [
      ["messages", { marker: "message-write" }],
      [
        "__pregel_tasks",
        {
          args: {
            messages: checkpoint.channel_values.messages
          },
          node: "tools"
        }
      ]
    ],
    "task-clone-payload"
  )

  const clonedThread = await cloneThread(sourceThreadId, targetThreadId, {
    metadata: { model: "openai:gpt-test" },
    title: "Clone checkpoint target"
  })
  const prisma = getPrismaClient()
  const checkpointRows = await prisma.checkpoint.findMany({
    where: { threadId: clonedThread.thread_id }
  })
  const blobRows = await prisma.checkpointBlob.findMany({
    orderBy: [{ channel: "asc" }, { version: "asc" }],
    where: { threadId: clonedThread.thread_id }
  })
  const writeRows = await prisma.checkpointWrite.findMany({
    orderBy: [{ channel: "asc" }, { taskId: "asc" }, { idx: "asc" }],
    where: { threadId: clonedThread.thread_id }
  })
  const clonedCheckpoint = await saver.getTuple({
    configurable: {
      thread_id: clonedThread.thread_id
    }
  })

  assert.equal(clonedThread.thread_id, targetThreadId)
  assert.deepEqual(
    checkpointRows.map((row) => row.runId),
    [null]
  )
  assert.deepEqual(
    blobRows.map((row) => `${row.channel}:${row.version}`),
    ["todos:checkpoint-clone-todos-version"]
  )
  assert.deepEqual(
    writeRows.map((row) => row.channel),
    ["__pregel_tasks", "messages"]
  )
  assert.deepEqual(clonedCheckpoint?.checkpoint.channel_values, checkpoint.channel_values)
})

test("thread fork rejects threads with pending HITL requests", async () => {
  const { createRun, createThread, upsertHitlRequest } = await loadDbModules()

  const sourceThreadId = "thread-pending-hitl"
  const runId = "run-pending-hitl"

  await createThread(sourceThreadId, {
    metadata: {
      model: "openai:gpt-test"
    }
  })
  await bindThreadWorkspace(sourceThreadId, repoRoot)
  await createRun(runId, sourceThreadId, { status: "interrupted" })
  await upsertHitlRequest({
    request_id: "request-pending-hitl",
    thread_id: sourceThreadId,
    run_id: runId,
    tool_call_id: "tool-call-pending-hitl",
    tool_name: "write_file",
    tool_args: { path: `${repoRoot}/pending.txt` },
    allowed_decisions: ["approve", "user_declined", "corrected"],
    status: "pending"
  })

  const service = await createThreadsServiceForTest()

  await assert.rejects(
    service.cloneUntilMessage(sourceThreadId, "message-user-1"),
    /Cannot fork a thread while human approval is pending/
  )
  await assert.rejects(
    service.clone(sourceThreadId),
    /Cannot fork a thread while human approval is pending/
  )

  const threadData = await service.getAgentThreadData(sourceThreadId)
  assert.deepEqual(threadData.runState.forkState, {
    canFork: false,
    reason: "pending_hitl"
  })
  assert.equal(threadData.runState.pendingApproval?.id, "request-pending-hitl")
})

test("thread fork state blocks busy threads", async () => {
  const { createThread, updateThread } = await loadDbModules()
  const sourceThreadId = "thread-busy-fork-state"

  await createThread(sourceThreadId, {
    metadata: {
      model: "openai:gpt-test"
    }
  })
  await bindThreadWorkspace(sourceThreadId, repoRoot)
  await updateThread(sourceThreadId, {
    status: "busy"
  })

  const service = await createThreadsServiceForTest()

  const threadData = await service.getAgentThreadData(sourceThreadId)
  assert.deepEqual(threadData.runState.forkState, {
    canFork: false,
    reason: "busy"
  })
  await assert.rejects(service.clone(sourceThreadId), /Cannot fork a thread while it is running/)
})

test("thread fork rejects checkpoints that contain HITL interrupts", async () => {
  const { createRun, createThread, getPrismaClient } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")
  const sourceThreadId = "thread-interrupt-checkpoint"
  const runId = "run-interrupt-checkpoint"

  await createThread(sourceThreadId, {
    metadata: {
      model: "openai:gpt-test"
    }
  })
  await bindThreadWorkspace(sourceThreadId, repoRoot)
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

  const service = await createThreadsServiceForTest()

  await assert.rejects(
    service.cloneUntilMessage(sourceThreadId, "message-user-interrupt"),
    /Cannot fork from a message that is waiting for human approval/
  )
  await assert.rejects(
    service.clone(sourceThreadId),
    /Cannot fork from a message that is waiting for human approval/
  )

  const threadData = await service.getAgentThreadData(sourceThreadId)
  assert.deepEqual(threadData.runState.forkState, {
    canFork: false,
    reason: "checkpoint_interrupt"
  })
  assert.deepEqual(
    threadData.messages.messages.map((message) => message.id),
    ["message-user-interrupt"]
  )
})
