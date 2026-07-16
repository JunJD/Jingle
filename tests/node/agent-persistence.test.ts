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
import type { AgentService } from "../../src/main/agent/service"
import { ExtensionMainDefinitionRegistry } from "../../src/main/extensions/registry/main-definition-registry"
import type { ExtensionMainRef } from "../../src/main/extensions/registry/types"

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

  await resumeAgentRun(
    threadId,
    request!.run_id!,
    {
      requestId: request!.request_id,
      source: "resume"
    },
    {
      resumeEvent: {
        requestId: request!.request_id
      }
    }
  )
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

test("resumeAgentRun rolls back the run update when marking the thread busy fails", async () => {
  const { createRun, createThread, getPrismaClient, getRun, getThread } = await loadDbModules()
  const { resumeAgentRun } = await import("../../src/main/agent/persistence")
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
      resumeAgentRun(
        threadId,
        runId,
        { requestId: "request-rollback" },
        {
          resumeEvent: {
            modelId: "gpt-test",
            requestId: "request-rollback"
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
  assert.equal((await getThread(threadId))?.status, "idle")
  assert.equal(await prisma.agentEvent.count({ where: { runId } }), 0)
  assert.equal(await prisma.agentEventSequence.count(), sequenceCountBefore)
})

test("agent resume keeps HITL request pending when resumed stream fails before first chunk", async () => {
  const { createRun, createThread, getHitlRequest, upsertHitlRequest } = await loadDbModules()
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
    allowed_decisions: ["approve", "reject"],
    status: "pending"
  })

  const events: Array<{ type: string }> = []
  let outcome: Awaited<ReturnType<AgentService["dispatchResume"]>> | null = null
  process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"
  try {
    outcome = await (
      await createAgentServiceForTest()
    ).dispatchResume(
      {
        decision: {
          feedback: "bdd:fail-before-first-chunk",
          request_id: requestId,
          tool_call_id: "tool-call-resume-failure",
          type: "approve"
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
      delete process.env.JINGLE_BDD_AGENT_RUNTIME
    } else {
      process.env.JINGLE_BDD_AGENT_RUNTIME = previousRuntimeMode
    }
    consoleError.mock.restore()
    consoleLog.mock.restore()
  }

  const request = await getHitlRequest(requestId)
  assert.ok(outcome)
  assert.equal(request?.status, "pending")
  assert.equal(request?.decision, null)
  assert.equal(outcome.type, "rejected")
  assert.deepEqual(events, [])
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
    allowed_decisions: ["approve", "reject"],
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
    allowed_decisions: ["approve", "reject"],
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

test("resume admission atomically records one resume event", async () => {
  const { createRun, createThread, getPrismaClient, getRun, getThread } = await loadDbModules()
  const { resumeAgentRun } = await import("../../src/main/agent/persistence")
  const threadId = "thread-atomic-resume-admission"
  const runId = "run-atomic-resume-admission"
  const requestId = "request-atomic-resume-admission"

  await createThread(threadId)
  await createRun(runId, threadId, { status: "interrupted" })
  await resumeAgentRun(
    threadId,
    runId,
    { requestId, source: "resume" },
    { resumeEvent: { modelId: "gpt-test", requestId } }
  )

  assert.equal((await getRun(runId))?.status, "running")
  assert.equal((await getThread(threadId))?.status, "busy")
  const events = await getPrismaClient().agentEvent.findMany({
    orderBy: { seq: "asc" },
    where: { runId, type: "run.resumed" }
  })
  assert.equal(events.length, 1)
  assert.equal(events[0]?.seq, 1)
  assert.deepEqual(JSON.parse(events[0]?.payload ?? "{}"), {
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
    tool_name: "callExtension",
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

  await resumeAgentRun(
    threadId,
    runId,
    {
      requestId: "request-1",
      source: "resume"
    },
    {
      resumeEvent: {
        requestId: "request-1"
      }
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
  const { createThread, getRun } = await loadDbModules()
  const { beginAgentRun, resumeAgentRun, updateRunExtensionAiCapabilitiesSnapshot } =
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

  await Promise.all([
    updateRunExtensionAiCapabilitiesSnapshot(runId, {
      aiCapabilities
    }),
    resumeAgentRun(
      threadId,
      runId,
      {
        requestId: "request-loaded-extension",
        source: "resume"
      },
      {
        resumeEvent: {
          requestId: "request-loaded-extension"
        }
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
    allowed_decisions: ["approve", "reject"],
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
