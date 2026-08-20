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
import { ThreadLifecycleGate } from "../../src/main/agent/thread-lifecycle-gate"
import {
  AGENT_RUN_FAILURE_METADATA_KEY,
  parseAgentRunFailure,
  type AgentRunFailureTerminalFact
} from "../../src/shared/agent-run-failure"
import { toAgentRunFailure } from "../../src/main/agent/errors"
import { ExtensionMainDefinitionRegistry } from "../../src/main/extensions/registry/main-definition-registry"
import type { ExtensionMainRef } from "../../src/main/extensions/registry/types"
import { ThreadsService } from "../../src/main/threads/service"
import {
  resolveComposerMessageReplay,
  toComposerMessageMetadata,
  toMessageContent
} from "../../src/shared/message-content"
import {
  MODEL_RUNTIME_SELECTION_METADATA_KEY,
  MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY,
  readRunModelRuntimeSelection,
  readThreadModelRuntimeSelection,
  readThreadModelRuntimeSelectionRevision
} from "../../src/shared/model-runtime-selection"
import { buildJingleSubmittedMessages } from "../../packages/langchain-agent-harness/src/submitted-messages"
import type { ModelRuntimeSelection } from "../../src/shared/app-types"
import type { PrismaCheckpointPutTransactionInput } from "../../src/main/checkpointer/prisma-saver"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
const originalDeepSeekApiKey = process.env.DEEPSEEK_API_KEY
let jingleHome = ""
let testDiagnosticsGraph: typeof import("../../src/main/diagnostics/instance").diagnosticsGraph

function createTestModelRuntimeSelection(modelId: string): ModelRuntimeSelection {
  return { modelId, thinkingEffort: "high" as const, version: 1 as const }
}

function createTestRunMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...metadata,
    [MODEL_RUNTIME_SELECTION_METADATA_KEY]: createTestModelRuntimeSelection(
      "deepseek:deepseek-v4-pro"
    )
  }
}

function createTestPersistedResumeAdmission(modelId = "deepseek:deepseek-v4-pro") {
  return {
    kind: "persisted" as const,
    selection: createTestModelRuntimeSelection(modelId)
  }
}

function createTestLegacyResumeAdmission(modelId = "deepseek:deepseek-v4-pro") {
  return {
    expectedLegacyModelId: modelId,
    kind: "legacy_upgrade" as const,
    selection: createTestModelRuntimeSelection(modelId)
  }
}

async function loadDbModules() {
  const db = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  const createThread: typeof db.createThread = (threadId, input) => {
    const metadata = input?.metadata
    const preservesExplicitSelectionState =
      metadata &&
      (Object.hasOwn(metadata, MODEL_RUNTIME_SELECTION_METADATA_KEY) ||
        Object.hasOwn(metadata, "model"))
    return db.createThread(threadId, {
      ...input,
      metadata: preservesExplicitSelectionState
        ? metadata
        : {
            ...(metadata ?? {}),
            [MODEL_RUNTIME_SELECTION_METADATA_KEY]: createTestModelRuntimeSelection(
              "deepseek:deepseek-v4-pro"
            ),
            [MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY]: 1
          }
    })
  }
  return { ...db, createThread, getPrismaClient }
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
    computerUseRuntime?: unknown
    extensionRegistryReader?: unknown
    jingleMemoryService?: unknown
    threadLifecycleGate?: unknown
    workspaceService?: unknown
  } = {}
) {
  const { AgentService } = await import("../../src/main/agent/service")
  const { ComputerUseRuntime } = await import("../../src/main/computer-use/runtime")
  const { JingleMemoryService } = await import("../../src/main/jingle-memory/service")
  const { ThreadLifecycleGate } = await import("../../src/main/agent/thread-lifecycle-gate")

  return new AgentService(
    (input.computerUseRuntime ??
      new ComputerUseRuntime({
        createService: async () => {
          throw new Error("Computer Use must remain disabled in AgentService persistence tests.")
        },
        initialConfig: { computerUseApplicationAllowlist: [], computerUseEnabled: false }
      })) as ConstructorParameters<typeof AgentService>[0],
    (input.jingleMemoryService ?? new JingleMemoryService()) as ConstructorParameters<
      typeof AgentService
    >[1],
    (input.threadLifecycleGate ?? new ThreadLifecycleGate()) as ConstructorParameters<
      typeof AgentService
    >[2],
    (input.workspaceService ?? (await createWorkspaceServiceForTest())) as ConstructorParameters<
      typeof AgentService
    >[3],
    (input.extensionRegistryReader ?? {
      listManifests: () => [],
      readMainDefinitionSnapshot: () => ({
        definitions: [],
        failures: [],
        pendingExtensionNames: [],
        revision: 1
      })
    }) as ConstructorParameters<typeof AgentService>[4]
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
  input: {
    modelProviderService?: unknown
    threadDigestService?: unknown
    threadLifecycleGate?: unknown
    workspaceService?: unknown
  } = {}
) {
  const { ArtifactsService } = await import("../../src/main/artifacts/service")
  const { ThreadsService } = await import("../../src/main/threads/service")
  const { ThreadWorkspaceRepository } = await import("../../src/main/thread-workspace/repository")
  const { ThreadWorkspaceService } = await import("../../src/main/thread-workspace/service")
  const { ThreadLifecycleGate } = await import("../../src/main/agent/thread-lifecycle-gate")
  const { ThreadDigestService } = await import("../../src/main/thread-digest/service")

  return new ThreadsService(
    new ArtifactsService(),
    (input.modelProviderService ?? {
      getDefaultRuntimeSelection: () => ({
        modelId: "deepseek:deepseek-v4-pro",
        thinkingEffort: "high",
        version: 1
      }),
      validateRuntimeSelection: (selection: ReturnType<typeof createTestModelRuntimeSelection>) =>
        selection
    }) as ConstructorParameters<typeof ThreadsService>[1],
    { getAgentConfig: () => ({ locale: "en-US" }) } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[2],
    (input.workspaceService ?? {
      createDefaultWorkspace: async () => repoRoot,
      resolveGlobalWorkspacePath: async () => repoRoot
    }) as ConstructorParameters<typeof ThreadsService>[3],
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
  testDiagnosticsGraph = (await import("../../src/main/diagnostics/instance")).diagnosticsGraph
  process.env.DEEPSEEK_API_KEY = "sk-test-reasoning-admission"
  const { API_KEY_CREDENTIAL_VARIABLE } = await import("../../src/main/model-provider/catalog")
  const { setProviderCredential } = await import("../../src/main/model-provider/secrets")
  setProviderCredential("deepseek", API_KEY_CREDENTIAL_VARIABLE, "sk-test-reasoning-admission")

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

test("threads create and model switch persist one canonical runtime selection owner", async () => {
  const service = await createThreadsServiceForTest()
  const created = await service.create({
    metadata: { source: "runtime-selection-test" },
    workspacePath: repoRoot
  })

  assert.deepEqual(readThreadModelRuntimeSelection(created.metadata), {
    kind: "ready",
    selection: {
      modelId: "deepseek:deepseek-v4-pro",
      thinkingEffort: "high",
      version: 1
    }
  })

  const switched = await service.setModel(created.thread_id, {
    modelId: "deepseek:deepseek-v4-flash",
    thinkingEffort: "max",
    version: 1
  })
  assert.deepEqual(readThreadModelRuntimeSelection(switched.metadata), {
    kind: "ready",
    selection: {
      modelId: "deepseek:deepseek-v4-flash",
      thinkingEffort: "max",
      version: 1
    }
  })
  assert.equal(switched.metadata?.source, "runtime-selection-test")
})

test("threads create validates the model before creating a default workspace", async () => {
  let workspaceCreateCalls = 0
  const service = await createThreadsServiceForTest({
    modelProviderService: {
      getDefaultRuntimeSelection: () => {
        throw new Error("Configure a model provider before creating a thread.")
      }
    },
    workspaceService: {
      createDefaultWorkspace: async () => {
        workspaceCreateCalls += 1
        return repoRoot
      },
      resolveGlobalWorkspacePath: async () => repoRoot
    }
  })

  await assert.rejects(
    service.create({
      createDefaultWorkspace: true,
      metadata: { title: "No provider draft" }
    }),
    /Configure a model provider before creating a thread/
  )
  assert.equal(workspaceCreateCalls, 0)
  assert.equal(await service.list().then((threads) => threads.length), 0)
})

test("generic thread metadata cannot forge or delete the runtime selection", async () => {
  const service = await createThreadsServiceForTest()
  const created = await service.create({ workspacePath: repoRoot })
  for (const protectedKey of [
    MODEL_RUNTIME_SELECTION_METADATA_KEY,
    MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY,
    "model",
    "modelId"
  ]) {
    await assert.rejects(
      service.create({
        metadata: {
          [protectedKey]: undefined
        },
        workspacePath: repoRoot
      }),
      new RegExp(`Thread metadata cannot write ${protectedKey}`)
    )
    await assert.rejects(
      service.update({
        threadId: created.thread_id,
        updates: {
          metadata: {
            [protectedKey]: undefined
          }
        }
      }),
      new RegExp(`Thread metadata cannot write ${protectedKey}`)
    )
  }
})

test("serialized metadata mutations cannot roll back a concurrent model switch", async () => {
  const service = await createThreadsServiceForTest()
  const created = await service.create({
    metadata: { source: "runtime-selection-race" },
    workspacePath: repoRoot
  })

  await Promise.all([
    service.update({
      threadId: created.thread_id,
      updates: { metadata: { permissionMode: "auto" } }
    }),
    service.setModel(created.thread_id, {
      modelId: "deepseek:deepseek-v4-flash",
      thinkingEffort: "max",
      version: 1
    }),
    service.setPinned(created.thread_id, true)
  ])

  const persisted = await service.get(created.thread_id)
  assert.deepEqual(readThreadModelRuntimeSelection(persisted?.metadata), {
    kind: "ready",
    selection: {
      modelId: "deepseek:deepseek-v4-flash",
      thinkingEffort: "max",
      version: 1
    }
  })
  assert.equal(persisted?.metadata?.permissionMode, "auto")
  assert.equal(persisted?.metadata?.pinned, true)
  assert.equal(persisted?.metadata?.source, "runtime-selection-race")
})

test("pending HITL rejects model changes without writes, revision increments, or events", async () => {
  const { upsertHitlRequest } = await loadDbModules()
  const service = await createThreadsServiceForTest()
  const created = await service.create({ workspacePath: repoRoot })
  await upsertHitlRequest({
    allowed_decisions: ["approve", "user_declined"],
    request_id: "request-model-switch-pending",
    thread_id: created.thread_id,
    tool_args: {},
    tool_call_id: "tool-model-switch-pending",
    tool_name: "execute"
  })
  const events: unknown[] = []
  service.onModelRuntimeSelectionChanged((event) => events.push(event))

  await assert.rejects(
    service.setModel(created.thread_id, {
      modelId: "deepseek:deepseek-v4-flash",
      thinkingEffort: "max",
      version: 1
    }),
    /Resolve the pending approval/
  )

  const persisted = await service.get(created.thread_id)
  assert.deepEqual(readThreadModelRuntimeSelection(persisted?.metadata), {
    kind: "ready",
    selection: {
      modelId: "deepseek:deepseek-v4-pro",
      thinkingEffort: "high",
      version: 1
    }
  })
  assert.equal(readThreadModelRuntimeSelectionRevision(persisted?.metadata), 1)
  assert.deepEqual(events, [])
})

test("corrupt thread selection revision fails closed without resetting fan-out ordering", async () => {
  const { updateThread } = await loadDbModules()
  const service = await createThreadsServiceForTest()
  const created = await service.create({ workspacePath: repoRoot })
  const corruptedMetadata = {
    ...created.metadata,
    [MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY]: "corrupt"
  }
  await updateThread(created.thread_id, { metadata: JSON.stringify(corruptedMetadata) })
  const events: unknown[] = []
  service.onModelRuntimeSelectionChanged((event) => events.push(event))

  await assert.rejects(
    service.setModel(created.thread_id, {
      modelId: "deepseek:deepseek-v4-flash",
      thinkingEffort: "max",
      version: 1
    }),
    /revision is invalid/
  )

  const persisted = await service.get(created.thread_id)
  assert.equal(persisted?.metadata?.[MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY], "corrupt")
  assert.deepEqual(readThreadModelRuntimeSelection(persisted?.metadata), { kind: "invalid" })
  assert.deepEqual(events, [])
})

test("invoke setup lease rejects a racing model change and preserves the admitted pair", async () => {
  let releaseClaim!: () => void
  const claimBarrier = new Promise<void>((resolve) => {
    releaseClaim = resolve
  })
  let signalClaimed!: (claim: Awaited<ReturnType<ThreadLifecycleGate["claimRun"]>>) => void
  const claimed = new Promise<Awaited<ReturnType<ThreadLifecycleGate["claimRun"]>>>((resolve) => {
    signalClaimed = resolve
  })
  class HoldingThreadLifecycleGate extends ThreadLifecycleGate {
    override async claimRun(threadId: string) {
      const claim = await super.claimRun(threadId)
      signalClaimed(claim)
      await claimBarrier
      return claim
    }
  }
  const gate = new HoldingThreadLifecycleGate()
  const threadsService = await createThreadsServiceForTest({ threadLifecycleGate: gate })
  const created = await threadsService.create({ workspacePath: repoRoot })
  const agentService = await createAgentServiceForTest({
    threadLifecycleGate: gate
  })
  const events: unknown[] = []
  threadsService.onModelRuntimeSelectionChanged((event) => events.push(event))
  const invoke = agentService.dispatchInvoke(
    {
      message: { content: "hold setup", id: "message-model-switch-race" },
      threadId: created.thread_id
    },
    { send: () => undefined }
  )
  const activeClaim = await claimed

  await assert.rejects(
    threadsService.setModel(created.thread_id, {
      modelId: "deepseek:deepseek-v4-flash",
      thinkingEffort: "max",
      version: 1
    }),
    /Stop the active run/
  )
  assert.equal(activeClaim.status, "accepted")
  if (activeClaim.status === "accepted") {
    activeClaim.lease.abortController.abort()
  }
  releaseClaim()
  await invoke

  const persisted = await threadsService.get(created.thread_id)
  assert.deepEqual(readThreadModelRuntimeSelection(persisted?.metadata), {
    kind: "ready",
    selection: {
      modelId: "deepseek:deepseek-v4-pro",
      thinkingEffort: "high",
      version: 1
    }
  })
  assert.equal(readThreadModelRuntimeSelectionRevision(persisted?.metadata), 1)
  assert.deepEqual(events, [])
})

test("invalid runtime selections fail before core admission or durable run writes", async () => {
  const { createThread, getPrismaClient, getThread } = await loadDbModules()
  const service = await createAgentServiceForTest()
  const cases: Array<{ metadata: Record<string, unknown>; name: string }> = [
    {
      metadata: { model: "deepseek:deepseek-v4-pro" },
      name: "legacy"
    },
    {
      metadata: {
        [MODEL_RUNTIME_SELECTION_METADATA_KEY]: {
          extra: true,
          modelId: "deepseek:deepseek-v4-pro",
          thinkingEffort: "high",
          version: 1
        }
      },
      name: "invalid"
    },
    {
      metadata: {
        [MODEL_RUNTIME_SELECTION_METADATA_KEY]: {
          modelId: "deepseek:deepseek-v4-pro",
          thinkingEffort: "low",
          version: 1
        }
      },
      name: "unsupported"
    }
  ]

  for (const testCase of cases) {
    const threadId = `thread-runtime-selection-${testCase.name}`
    await createThread(threadId, { metadata: testCase.metadata })
    await bindThreadWorkspace(threadId, repoRoot)
    const events: AgentStreamPayload[] = []
    let coreAdmissions = 0
    const outcome = await service.dispatchInvoke(
      {
        message: {
          content: `must reject ${testCase.name} selection`,
          id: `message-runtime-selection-${testCase.name}`
        },
        threadId
      },
      { send: (event) => events.push(event) },
      { onCoreAdmitted: () => (coreAdmissions += 1) }
    )

    assert.equal(outcome.type, "rejected")
    assert.equal(outcome.type === "rejected" ? outcome.error.code : null, "FAILED_PRECONDITION")
    assert.equal(coreAdmissions, 0)
    assert.deepEqual(events, [])
    assert.equal(await getPrismaClient().run.count({ where: { threadId } }), 0)
    assert.equal(await getPrismaClient().agentEvent.count({ where: { threadId } }), 0)
    assert.equal(await getPrismaClient().message.count({ where: { threadId } }), 0)
    assert.equal((await getThread(threadId))?.status, "idle")
  }
})

test("legacy resume recovery rejects missing, mismatched, and unsupported pairs before writes", async () => {
  const {
    createRun,
    createThread,
    getHitlRequest,
    getPrismaClient,
    getRun,
    getThread,
    upsertHitlRequest
  } = await loadDbModules()
  const service = await createAgentServiceForTest()
  const cases: Array<{
    name: string
    recovery?: ReturnType<typeof createTestModelRuntimeSelection>
  }> = [
    { name: "missing" },
    {
      name: "different-model",
      recovery: createTestModelRuntimeSelection("deepseek:deepseek-v4-flash")
    },
    {
      name: "unsupported-effort",
      recovery: {
        modelId: "deepseek:deepseek-v4-pro",
        thinkingEffort: "low",
        version: 1
      }
    }
  ]

  for (const testCase of cases) {
    const threadId = `thread-legacy-resume-${testCase.name}`
    const runId = `run-legacy-resume-${testCase.name}`
    const requestId = `request-legacy-resume-${testCase.name}`
    const toolCallId = `tool-legacy-resume-${testCase.name}`
    await createThread(threadId)
    await bindThreadWorkspace(threadId, repoRoot)
    await createRun(runId, threadId, {
      metadata: { modelId: "deepseek:deepseek-v4-pro", preserved: testCase.name },
      status: "interrupted"
    })
    await upsertHitlRequest({
      allowed_decisions: ["approve", "user_declined", "corrected"],
      request_id: requestId,
      run_id: runId,
      status: "pending",
      thread_id: threadId,
      tool_args: {},
      tool_call_id: toolCallId,
      tool_name: "write_file"
    })
    let coreAdmissions = 0
    const events: AgentStreamPayload[] = []
    const outcome = await service.dispatchResume(
      {
        decision: { request_id: requestId, tool_call_id: toolCallId, type: "approve" },
        ...(testCase.recovery ? { runModelRuntimeSelectionRecovery: testCase.recovery } : {}),
        threadId
      },
      { send: (event) => events.push(event) },
      { onCoreAdmitted: () => (coreAdmissions += 1) }
    )

    assert.equal(outcome.type, "rejected")
    assert.equal(outcome.type === "rejected" ? outcome.error.code : null, "FAILED_PRECONDITION")
    assert.equal(coreAdmissions, 0)
    assert.deepEqual(events, [])
    assert.equal((await getHitlRequest(requestId))?.status, "pending")
    const run = await getRun(runId)
    assert.equal(run?.status, "interrupted")
    assert.deepEqual(JSON.parse(run?.metadata ?? "{}"), {
      modelId: "deepseek:deepseek-v4-pro",
      preserved: testCase.name
    })
    assert.equal(await getPrismaClient().agentEvent.count({ where: { runId } }), 0)
    assert.equal((await getThread(threadId))?.status, "idle")
  }
})

test("thread hydration projects recovery from the pending approval source run only", async () => {
  const { createRun, createThread, updateRun, upsertHitlRequest } = await loadDbModules()
  const threadId = "thread-hydrate-legacy-run-recovery"
  const sourceRunId = "run-hydrate-legacy-source"
  const newerRunId = "run-hydrate-newer-ready"
  const requestId = "request-hydrate-legacy-source"
  const toolCallId = "tool-hydrate-legacy-source"
  await createThread(threadId)
  await createRun(sourceRunId, threadId, {
    metadata: { modelId: "deepseek:deepseek-v4-pro" },
    status: "interrupted"
  })
  await createRun(newerRunId, threadId, {
    metadata: createTestRunMetadata(),
    status: "interrupted"
  })
  await upsertHitlRequest({
    allowed_decisions: ["approve", "user_declined", "corrected"],
    request_id: requestId,
    run_id: sourceRunId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: toolCallId,
    tool_name: "write_file"
  })
  const service = await createThreadsServiceForTest()

  const legacy = await service.getAgentThreadData(threadId)
  assert.deepEqual(legacy.runState.pendingApprovalRunModelRuntimeRecovery, {
    kind: "legacy_missing_effort",
    modelId: "deepseek:deepseek-v4-pro",
    requestId,
    runId: sourceRunId,
    toolCallId
  })

  await updateRun(sourceRunId, { metadata: createTestRunMetadata() })
  const ready = await service.getAgentThreadData(threadId)
  assert.equal(ready.runState.pendingApprovalRunModelRuntimeRecovery, null)

  await updateRun(sourceRunId, {
    metadata: { [MODEL_RUNTIME_SELECTION_METADATA_KEY]: { version: 2 } }
  })
  const invalid = await service.getAgentThreadData(threadId)
  assert.deepEqual(invalid.runState.pendingApprovalRunModelRuntimeRecovery, {
    kind: "invalid",
    requestId,
    runId: sourceRunId,
    toolCallId
  })

  await updateRun(sourceRunId, { metadata: { preserved: true } })
  const missing = await service.getAgentThreadData(threadId)
  assert.deepEqual(missing.runState.pendingApprovalRunModelRuntimeRecovery, {
    kind: "missing",
    requestId,
    runId: sourceRunId,
    toolCallId
  })
})

test("legacy pending HITL survives database restart and resumes after explicit same-model recovery", async () => {
  const {
    closeDatabase,
    createRun,
    createThread,
    getHitlRequest,
    getRun,
    initializeDatabase,
    upsertHitlRequest
  } = await loadDbModules()
  const threadId = "thread-restart-legacy-hitl-recovery"
  const runId = "run-restart-legacy-hitl-recovery"
  const requestId = "request-restart-legacy-hitl-recovery"
  const toolCallId = "tool-restart-legacy-hitl-recovery"
  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  await createRun(runId, threadId, {
    metadata: { modelId: "deepseek:deepseek-v4-pro", preservedAcrossRestart: true },
    status: "interrupted"
  })
  await upsertHitlRequest({
    allowed_decisions: ["approve", "user_declined", "corrected"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: toolCallId,
    tool_name: "write_file"
  })

  await closeDatabase()
  await initializeDatabase()

  const snapshot = await (await createThreadsServiceForTest()).getAgentThreadData(threadId)
  assert.deepEqual(snapshot.runState.pendingApprovalRunModelRuntimeRecovery, {
    kind: "legacy_missing_effort",
    modelId: "deepseek:deepseek-v4-pro",
    requestId,
    runId,
    toolCallId
  })

  const previousRuntimeMode = process.env.JINGLE_BDD_AGENT_RUNTIME
  const consoleLog = mock.method(console, "log", () => {})
  const consoleError = mock.method(console, "error", () => {})
  const events: AgentStreamPayload[] = []
  let resolveTerminal!: () => void
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve
  })
  process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"
  try {
    const outcome = await (
      await createAgentServiceForTest()
    ).dispatchResume(
      {
        decision: {
          correction: "bdd:fail-before-first-chunk",
          request_id: requestId,
          tool_call_id: toolCallId,
          type: "corrected"
        },
        runModelRuntimeSelectionRecovery: createTestModelRuntimeSelection(
          "deepseek:deepseek-v4-pro"
        ),
        threadId
      },
      {
        send: (event) => {
          events.push(event)
          if (event.type === "error") {
            resolveTerminal()
          }
        }
      }
    )
    assert.equal(outcome.type, "accepted")
    await terminal
  } finally {
    if (previousRuntimeMode === undefined) {
      delete process.env.JINGLE_BDD_AGENT_RUNTIME
    } else {
      process.env.JINGLE_BDD_AGENT_RUNTIME = previousRuntimeMode
    }
    consoleError.mock.restore()
    consoleLog.mock.restore()
  }

  assert.equal((await getHitlRequest(requestId))?.status, "corrected")
  const run = await getRun(runId)
  const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  assert.equal(metadata.preservedAcrossRestart, true)
  assert.equal(Object.hasOwn(metadata, "modelId"), false)
  assert.deepEqual(readRunModelRuntimeSelection(metadata), {
    kind: "ready",
    selection: createTestModelRuntimeSelection("deepseek:deepseek-v4-pro")
  })
  assert.deepEqual(
    events.map((event) => event.type),
    ["run_started", "error"]
  )
})

test("database startup records a durable failure for agent state left active by a previous process", async () => {
  const {
    closeDatabase,
    createRun,
    createThread,
    getPrismaClient,
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

    assert.equal(run?.status, "error")
    assert.equal(thread?.status, "error")
    const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
    assert.deepEqual(metadata[AGENT_RUN_FAILURE_METADATA_KEY], {
      ipcCode: "UNAVAILABLE",
      kind: "transport_interrupted",
      message:
        "The agent run was interrupted when Jingle stopped. Its previous execution owner no longer exists. Retry the task to start a new run.",
      schemaVersion: 1,
      status: 503
    })
    const finished = await getPrismaClient().agentEvent.findMany({
      orderBy: { seq: "asc" },
      where: { runId, type: "run.finished" }
    })
    assert.equal(finished.length, 1)
    assert.deepEqual(JSON.parse(finished[0]!.payload), {
      completionReason: null,
      errorMessage:
        "The agent run was interrupted when Jingle stopped. Its previous execution owner no longer exists. Retry the task to start a new run.",
      errorType: "transport_interrupted",
      status: "error"
    })
    assert.equal(consoleWarn.mock.callCount(), 1)
  } finally {
    consoleWarn.mock.restore()
  }
})

test("database startup preserves pending HITL while recording one interrupted failure", async () => {
  const {
    closeDatabase,
    createRun,
    createThread,
    getHitlRequest,
    getPrismaClient,
    getRun,
    getThread,
    initializeDatabase,
    updateThread,
    upsertHitlRequest
  } = await loadDbModules()
  const consoleWarn = mock.method(console, "warn", () => {})
  const threadId = "thread-startup-pending-hitl"
  const runId = "run-startup-pending-hitl"
  const requestId = "request-startup-pending-hitl"

  try {
    await createThread(threadId)
    await createRun(runId, threadId, { status: "running" })
    await updateThread(threadId, { status: "busy" })
    await upsertHitlRequest({
      allowed_decisions: ["approve", "user_declined"],
      request_id: requestId,
      run_id: runId,
      status: "pending",
      thread_id: threadId,
      tool_args: {},
      tool_call_id: "tool-startup-pending-hitl",
      tool_name: "write_file"
    })

    await closeDatabase()
    await initializeDatabase()

    assert.equal((await getRun(runId))?.status, "interrupted")
    assert.equal((await getThread(threadId))?.status, "interrupted")
    assert.equal((await getHitlRequest(requestId))?.status, "pending")
    const metadata = JSON.parse((await getRun(runId))?.metadata ?? "{}") as Record<
      string,
      unknown
    >
    assert.deepEqual(metadata[AGENT_RUN_FAILURE_METADATA_KEY], {
      ipcCode: "UNAVAILABLE",
      kind: "transport_interrupted",
      message:
        "The agent run was interrupted when Jingle stopped. Its previous execution owner no longer exists. Retry the task to start a new run.",
      schemaVersion: 1,
      status: 503
    })
    assert.equal(
      await getPrismaClient().agentEvent.count({ where: { runId, type: "run.finished" } }),
      1
    )

    await closeDatabase()
    await initializeDatabase()

    assert.equal(
      await getPrismaClient().agentEvent.count({ where: { runId, type: "run.finished" } }),
      1
    )
  } finally {
    consoleWarn.mock.restore()
  }
})

test("database startup fails approved Computer Use that cannot retain its native state", async () => {
  const {
    closeDatabase,
    createRun,
    createThread,
    getRun,
    getThread,
    initializeDatabase,
    resolveHitlRequest,
    updateThread,
    upsertHitlRequest
  } = await loadDbModules()
  const consoleWarn = mock.method(console, "warn", () => {})
  const threadId = "thread-startup-computer-use-approved"
  const runId = "run-startup-computer-use-approved"
  const requestId = "request-startup-computer-use-approved"
  const toolCallId = "tool-startup-computer-use-approved"

  try {
    await createThread(threadId)
    await bindThreadWorkspace(threadId, repoRoot)
    await createRun(runId, threadId, {
      metadata: createTestRunMetadata(),
      status: "running"
    })
    await updateThread(threadId, { status: "busy" })
    await upsertHitlRequest({
      allowed_decisions: ["approve"],
      request_id: requestId,
      run_id: runId,
      status: "pending",
      thread_id: threadId,
      tool_args: {
        actions: [{ kind: "press", ref: "@save" }],
        sessionId: "session-before-restart",
        stateId: "state-before-restart"
      },
      tool_call_id: toolCallId,
      tool_name: "computer_use_action"
    })
    await resolveHitlRequest(requestId, "approved", {
      request_id: requestId,
      tool_call_id: toolCallId,
      type: "approve"
    })

    await closeDatabase()
    await initializeDatabase()

    const run = await getRun(runId)
    const thread = await getThread(threadId)
    const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
    const failure = parseAgentRunFailure(metadata[AGENT_RUN_FAILURE_METADATA_KEY])
    const snapshot = await (await createThreadsServiceForTest()).getAgentThreadData(threadId)
    assert.equal(run?.status, "error")
    assert.equal(thread?.status, "error")
    assert.equal(failure?.kind, "transport_interrupted")
    assert.equal(failure?.ipcCode, "UNAVAILABLE")
    assert.match(failure?.message ?? "", /No desktop action was dispatched/)
    assert.equal(snapshot.runState.pendingApproval, null)
    assert.equal(snapshot.runState.error?.message, failure?.message)
    const terminalEvents = await (await loadDbModules()).getPrismaClient().agentEvent.findMany({
      where: { runId, type: "run.finished" }
    })
    assert.equal(terminalEvents.length, 1)
    assert.equal(JSON.parse(terminalEvents[0]?.payload ?? "{}").status, "error")
    assert.equal(consoleWarn.mock.callCount(), 1)
  } finally {
    consoleWarn.mock.restore()
  }
})

test("database startup preserves settled Computer Use before interrupting later Agent work", async () => {
  const {
    closeDatabase,
    createRun,
    createThread,
    getRun,
    getThread,
    initializeDatabase,
    resolveHitlRequest,
    updateThread,
    upsertHitlRequest
  } = await loadDbModules()
  const { ComputerUseActionLedger } = await import("@jingle/computer-use-core")
  const { createPrismaComputerUseActionLedgerPort } =
    await import("../../src/main/db/computer-use-action-ledger")
  const { createComputerUseTransactionId } =
    await import("../../src/main/computer-use/transaction-identity")
  const threadId = "thread-startup-computer-use-settled"
  const runId = "run-startup-computer-use-settled"
  const requestId = "request-startup-computer-use-settled"
  const toolCallId = "tool-startup-computer-use-settled"
  const attemptId = createComputerUseTransactionId({ runId, toolCallId })

  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  await createRun(runId, threadId, { metadata: createTestRunMetadata(), status: "running" })
  await updateThread(threadId, { status: "busy" })
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {
      actions: [{ kind: "press", ref: "@save" }],
      sessionId: "session-settled",
      stateId: "state-settled"
    },
    tool_call_id: toolCallId,
    tool_name: "computer_use_action"
  })
  await resolveHitlRequest(requestId, "approved", {
    request_id: requestId,
    tool_call_id: toolCallId,
    type: "approve"
  })
  const ledger = new ComputerUseActionLedger(createPrismaComputerUseActionLedgerPort())
  const { attempt } = await ledger.begin({
    actions: [{ kind: "press", ref: "@save" }],
    authorization: {
      expiresAt: Date.now() + 60_000,
      runId,
      sessionId: "session-settled",
      threadId,
      window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" }
    },
    baseStateId: "state-settled",
    target: {
      applicationId: "com.example.editor",
      resourceKey: "desktop-pid:42",
      window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" }
    },
    transactionId: attemptId
  })
  await ledger.dispatched(attempt.attemptId)
  await ledger.settle(attempt.attemptId, {
    baseStateId: "state-settled",
    outcome: "worked",
    steps: [
      {
        action: { kind: "press", ref: "@save" },
        evidence: {
          delivery: "semantic",
          noSideEffectProof: false,
          route: "ax_action",
          verification: "verified"
        },
        outcome: "worked"
      }
    ],
    successor: {
      application: { id: "com.example.editor", name: "Editor" },
      capturedAt: Date.now(),
      elements: [{ actions: ["press"], index: 0, ref: "@save", role: "button" }],
      epoch: 1,
      resourceKey: "desktop-pid:42",
      sourceTruncated: false,
      stateId: "state-settled-successor",
      window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" }
    }
  })

  await closeDatabase()
  await initializeDatabase()

  assert.equal((await getRun(runId))?.status, "error")
  assert.equal((await getThread(threadId))?.status, "error")
  const recovered = await createPrismaComputerUseActionLedgerPort().read(attemptId)
  assert.equal(recovered?.phase, "settled")
  assert.equal(recovered?.result?.outcome, "worked")
})

test("database startup settles dispatched Computer Use as unknown before failing its run", async () => {
  const { closeDatabase, createRun, createThread, getPrismaClient, getRun, initializeDatabase } =
    await loadDbModules()
  const { ComputerUseActionLedger } = await import("@jingle/computer-use-core")
  const { createPrismaComputerUseActionLedgerPort } =
    await import("../../src/main/db/computer-use-action-ledger")
  const threadId = "thread-startup-computer-use-dispatched"
  const runId = "run-startup-computer-use-dispatched"
  const attemptId = "attempt-startup-computer-use-dispatched"

  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  await createRun(runId, threadId, { metadata: "{malformed", status: "running" })
  const ledger = new ComputerUseActionLedger(createPrismaComputerUseActionLedgerPort())
  const { attempt } = await ledger.begin({
    actions: [{ kind: "press", ref: "@save" }],
    authorization: {
      expiresAt: Date.now() + 60_000,
      runId,
      sessionId: "session-dispatched",
      threadId,
      window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" }
    },
    baseStateId: "state-dispatched",
    target: {
      applicationId: "com.example.editor",
      resourceKey: "desktop-pid:42",
      window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" }
    },
    transactionId: attemptId
  })
  await ledger.dispatched(attempt.attemptId)

  await closeDatabase()
  await initializeDatabase()

  const run = await getRun(runId)
  const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  const failure = parseAgentRunFailure(metadata[AGENT_RUN_FAILURE_METADATA_KEY])
  const recovered = await createPrismaComputerUseActionLedgerPort().read(attemptId)
  assert.equal(run?.status, "error")
  assert.match(failure?.message ?? "", /action outcome is unknown/)
  assert.equal(recovered?.phase, "settled")
  assert.equal(recovered?.result?.outcome, "unknown")
  assert.equal(
    await getPrismaClient().agentEvent.count({ where: { runId, type: "run.finished" } }),
    1
  )
})

test.after(async () => {
  const { closeDatabase } = await loadDbModules()
  await closeDatabase()
  if (originalJingleHome === undefined) {
    delete process.env.JINGLE_HOME
  } else {
    process.env.JINGLE_HOME = originalJingleHome
  }
  if (originalDeepSeekApiKey === undefined) {
    delete process.env.DEEPSEEK_API_KEY
  } else {
    process.env.DEEPSEEK_API_KEY = originalDeepSeekApiKey
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
  await createRun(olderRunId, threadId, {
    metadata: createTestRunMetadata(),
    status: "interrupted"
  })
  await createRun(latestRunId, threadId, {
    metadata: createTestRunMetadata(),
    status: "interrupted"
  })
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
    { modelRuntimeSelectionAdmission: createTestPersistedResumeAdmission() }
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
  await createRun(runId, threadId, {
    metadata: createTestRunMetadata(),
    status: "interrupted"
  })
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
    {}
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

test("user_declined bypasses corrupt run metadata and execution setup", async () => {
  const { createRun, createThread, getHitlRequest, getPrismaClient, getRun, upsertHitlRequest } =
    await loadDbModules()
  const threadId = "thread-hitl-decline-corrupt-metadata"
  const runId = "run-hitl-decline-corrupt-metadata"
  const requestId = "request-hitl-decline-corrupt-metadata"
  const toolCallId = "tool-hitl-decline-corrupt-metadata"
  await createThread(threadId)
  await createRun(runId, threadId, {
    metadata: "{corrupt-run-metadata",
    status: "interrupted"
  })
  await upsertHitlRequest({
    allowed_decisions: ["approve", "user_declined"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {
      actions: [{ kind: "press", ref: "@save" }],
      sessionId: "session-decline-cleanup",
      stateId: "state-decline-cleanup"
    },
    tool_call_id: toolCallId,
    tool_name: "computer_use_action"
  })
  let cleanupCalls = 0
  const service = await createAgentServiceForTest({
    computerUseRuntime: {
      closeRun: async () => {
        cleanupCalls += 1
        throw new Error("simulated decline cleanup failure")
      }
    },
    workspaceService: {
      getWorkspacePath: async () => {
        throw new Error("terminal decline must not read workspace execution state")
      }
    }
  })
  const consoleLog = mock.method(console, "log", () => {})
  const events: AgentStreamPayload[] = []
  let coreAdmissions = 0
  try {
    const outcome = await service.dispatchResume(
      {
        decision: { request_id: requestId, tool_call_id: toolCallId, type: "user_declined" },
        threadId
      },
      { send: (event) => events.push(event) },
      { onCoreAdmitted: () => (coreAdmissions += 1) }
    )
    assert.equal(outcome.type, "accepted")
  } finally {
    consoleLog.mock.restore()
  }

  assert.equal(coreAdmissions, 1)
  assert.equal((await getHitlRequest(requestId))?.status, "user_declined")
  assert.equal((await getRun(runId))?.status, "cancelled")
  assert.equal(cleanupCalls, 1)
  assert.deepEqual(
    events.map((event) => event.type),
    ["run_started", "cancelled"]
  )
  assert.deepEqual(
    (
      await getPrismaClient().agentEvent.findMany({
        orderBy: { seq: "asc" },
        where: { runId }
      })
    ).map((event) => event.type),
    ["approval.resolved", "run.finished"]
  )
})

test("Computer Use approval without a durable window fails before resume CAS", async () => {
  const { createRun, createThread, getHitlRequest, getRun, upsertHitlRequest } =
    await loadDbModules()
  const threadId = "thread-cua-launcher-approval"
  const runId = "run-cua-launcher-approval"
  const requestId = "request-cua-launcher-approval"
  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  await createRun(runId, threadId, {
    metadata: { modelId: "deepseek:deepseek-v4-pro" },
    status: "interrupted"
  })
  await upsertHitlRequest({
    allowed_decisions: ["approve", "user_declined", "corrected"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {
      actions: [{ kind: "press", ref: "@save" }],
      sessionId: "session-1",
      stateId: "state-1"
    },
    tool_call_id: "tool-call-cua-launcher-approval",
    tool_name: "computer_use_action"
  })

  const outcome = await (
    await createAgentServiceForTest()
  ).dispatchResume(
    {
      decision: {
        request_id: requestId,
        tool_call_id: "tool-call-cua-launcher-approval",
        type: "approve"
      },
      runModelRuntimeSelectionRecovery: createTestModelRuntimeSelection("deepseek:deepseek-v4-pro"),
      threadId
    },
    { send: () => undefined }
  )

  assert.equal(outcome.type, "rejected")
  assert.equal(outcome.type === "rejected" ? outcome.error.code : null, "FAILED_PRECONDITION")
  assert.equal((await getHitlRequest(requestId))?.status, "pending")
  assert.equal((await getRun(runId))?.status, "interrupted")
})

test("Computer Use lease revocation after review preserves the pending approval", async () => {
  const { createRun, createThread, getHitlRequest, getRun, upsertHitlRequest } =
    await loadDbModules()
  const threadId = "thread-cua-revoked-approval"
  const runId = "run-cua-revoked-approval"
  const requestId = "request-cua-revoked-approval"
  const leaseController = new AbortController()
  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  await createRun(runId, threadId, {
    metadata: { modelId: "deepseek:deepseek-v4-pro" },
    status: "interrupted"
  })
  await upsertHitlRequest({
    allowed_decisions: ["approve", "user_declined", "corrected"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {
      actions: [{ kind: "press", ref: "@save" }],
      sessionId: "session-1",
      stateId: "state-1"
    },
    tool_call_id: "tool-call-cua-revoked-approval",
    tool_name: "computer_use_action"
  })

  const service = await createAgentServiceForTest({
    computerUseRuntime: {
      prepareActionApproval: async () => ({ review: {}, signal: leaseController.signal })
    }
  })
  const outcome = await service.dispatchResume(
    {
      decision: {
        request_id: requestId,
        tool_call_id: "tool-call-cua-revoked-approval",
        type: "approve"
      },
      runModelRuntimeSelectionRecovery: createTestModelRuntimeSelection("deepseek:deepseek-v4-pro"),
      threadId
    },
    { send: () => undefined },
    {
      computerUseCallerLease: {
        incarnation: 1,
        signal: leaseController.signal,
        threadId,
        window: { kind: "main", windowId: "main" }
      },
      onCoreAdmitted: () => leaseController.abort(new Error("window closed"))
    }
  )

  assert.equal(outcome.type, "rejected")
  assert.equal((await getHitlRequest(requestId))?.status, "pending")
  assert.equal((await getRun(runId))?.status, "interrupted")
})

test("interrupted runtime settlement retains Computer Use until the final terminal state", async () => {
  const { createRuntimeRunLifecycleController } =
    await import("../../src/main/agent/run-lifecycle-controller")
  const closedRuns: string[] = []
  const controller = createRuntimeRunLifecycleController({
    computerUseRuntime: {
      closeRun: async (runId: string) => {
        closedRuns.push(runId)
      }
    } as never
  })

  await controller.settleRun({
    retainSuspendedResources: true,
    runId: "run-cua-suspended",
    threadId: "thread-cua-suspended"
  })
  assert.deepEqual(closedRuns, [])

  await controller.settleRun({
    runId: "run-cua-suspended",
    threadId: "thread-cua-suspended"
  })
  assert.deepEqual(closedRuns, ["run-cua-suspended"])
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
  await createRun(runId, threadId, {
    metadata: { modelId: "deepseek:deepseek-v4-pro" },
    status: "interrupted"
  })
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

  const controller = createRuntimeRunLifecycleController({
    computerUseRuntime: { closeRun: async () => undefined } as never
  })
  const createStart = (type: "approve" | "user_declined") =>
    controller.beginResumeRun({
      resume: {
        decision: { request_id: requestId, tool_call_id: toolCallId, type },
        ...(type === "approve"
          ? { modelRuntimeSelectionAdmission: createTestLegacyResumeAdmission() }
          : {}),
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
  const runMetadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  assert.ok(request)
  assert.equal(run?.status, request.status === "user_declined" ? "cancelled" : "running")
  if (request.status === "approved") {
    assert.equal(Object.hasOwn(runMetadata, "modelId"), false)
    assert.deepEqual(readRunModelRuntimeSelection(runMetadata), {
      kind: "ready",
      selection: createTestModelRuntimeSelection("deepseek:deepseek-v4-pro")
    })
  } else {
    assert.deepEqual(readRunModelRuntimeSelection(runMetadata), {
      kind: "legacy_missing_effort",
      modelId: "deepseek:deepseek-v4-pro"
    })
  }
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
      {}
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
  await createRun(runId, threadId, {
    metadata: { modelId: "deepseek:deepseek-v4-pro", preserved: true },
    status: "interrupted"
  })
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
        { modelRuntimeSelectionAdmission: createTestLegacyResumeAdmission() }
      )
    )
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`)
  }

  assert.equal((await getHitlRequest(requestId))?.status, "pending")
  const run = await getRun(runId)
  assert.equal(run?.status, "interrupted")
  assert.deepEqual(JSON.parse(run?.metadata ?? "{}"), {
    modelId: "deepseek:deepseek-v4-pro",
    preserved: true
  })
  assert.equal(await prisma.agentEvent.count({ where: { runId } }), 0)
})

test("legacy HITL approval atomically upgrades the source run and records admitted effort", async () => {
  const {
    createRun,
    createThread,
    flushAgentTraceProjection,
    getHitlRequest,
    getPrismaClient,
    getRun,
    upsertHitlRequest
  } = await loadDbModules()
  const { commitAgentResumeDecision } = await import("../../src/main/agent/persistence")
  const threadId = "thread-hitl-legacy-effort-upgrade"
  const runId = "run-hitl-legacy-effort-upgrade"
  const requestId = "request-hitl-legacy-effort-upgrade"
  const toolCallId = "tool-hitl-legacy-effort-upgrade"

  await createThread(threadId)
  await createRun(runId, threadId, {
    metadata: {
      keep: "durable",
      modelId: "deepseek:deepseek-v4-pro"
    },
    status: "interrupted"
  })
  await upsertHitlRequest({
    allowed_decisions: ["approve", "user_declined", "corrected"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: toolCallId,
    tool_name: "write_file"
  })

  await commitAgentResumeDecision(
    threadId,
    runId,
    { request_id: requestId, tool_call_id: toolCallId, type: "approve" },
    { requestId, source: "resume" },
    { modelRuntimeSelectionAdmission: createTestLegacyResumeAdmission() }
  )

  const run = await getRun(runId)
  const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  assert.equal(run?.status, "running")
  assert.equal(metadata.keep, "durable")
  assert.equal(Object.hasOwn(metadata, "modelId"), false)
  assert.deepEqual(readRunModelRuntimeSelection(metadata), {
    kind: "ready",
    selection: createTestModelRuntimeSelection("deepseek:deepseek-v4-pro")
  })
  assert.equal((await getHitlRequest(requestId))?.status, "approved")
  const resumed = await getPrismaClient().agentEvent.findFirstOrThrow({
    where: { runId, type: "run.resumed" }
  })
  assert.deepEqual(JSON.parse(resumed.payload), {
    modelRuntimeSelection: {
      modelId: "deepseek:deepseek-v4-pro",
      thinkingEffort: "high",
      version: 1
    },
    requestId,
    source: "resume"
  })
  await flushAgentTraceProjection()
  const trace = await getPrismaClient().agentTrace.findUniqueOrThrow({ where: { runId } })
  assert.equal(trace.model, "deepseek:deepseek-v4-pro")
  assert.equal(trace.modelSelectionVersion, 1)
  assert.equal(trace.thinkingEffort, "high")
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
      beginAgentRun(threadId, createTestModelRuntimeSelection("gpt-test"), {
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

test("accepted user messages hydrate exact composer facts before the first checkpoint", async () => {
  const { createThread } = await loadDbModules()
  const { beginAgentRun } = await import("../../src/main/agent/persistence")
  const { recordUserMessageCreated } = await import("../../src/main/agent/event-recorder")
  const threadId = "thread-admission-message-hydration"
  const refs = [
    {
      name: "notes.txt",
      source: { kind: "text" as const, text: "中文 source" },
      type: "file-attachment" as const
    }
  ]

  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  const { runId } = await beginAgentRun(
    threadId,
    createTestModelRuntimeSelection("deepseek:deepseek-v4-pro"),
    {
      startEvent: {
        composerText: "Review the notes",
        contentPreview: "Review the notes",
        refs,
        userMessageId: "message-invoke"
      }
    }
  )
  await recordUserMessageCreated({
    composerText: "Follow up",
    contentPreview: "Follow up",
    refs,
    runId,
    threadId,
    userMessageId: "message-steer"
  })

  const snapshot = await (await createThreadsServiceForTest()).getAgentThreadData(threadId)
  assert.deepEqual(
    snapshot.messages.messages.map((message) => ({
      id: message.id,
      replay: resolveComposerMessageReplay(message.content, message.metadata)
    })),
    [
      {
        id: "message-invoke",
        replay: { input: { refs, text: "Review the notes" }, type: "ready" }
      },
      {
        id: "message-steer",
        replay: { input: { refs, text: "Follow up" }, type: "ready" }
      }
    ]
  )
})

test("pending same-id edits replace stale projections without reviving checkpoint removals", async () => {
  const { createRun, createThread, getPrismaClient } = await loadDbModules()
  const { beginAgentRun } = await import("../../src/main/agent/persistence")
  const { recordUserMessageCreated } = await import("../../src/main/agent/event-recorder")
  const { persistMessageStateVersion } = await import("../../src/main/db/message-state")
  const threadId = "thread-pending-same-id-edit"
  const messageId = "message-edited"
  const removedAssistantId = "message-old-assistant"
  const prisma = getPrismaClient()
  const oldRefs = [
    {
      name: "old.txt",
      source: { kind: "text" as const, text: "old source" },
      type: "file-attachment" as const
    }
  ]
  const oldComposerText = "Old input"
  const oldUserItem = {
    content: JSON.stringify(toMessageContent({ refs: oldRefs, text: oldComposerText })),
    kind: "message",
    messageId,
    metadata: JSON.stringify(toComposerMessageMetadata({ refs: oldRefs, text: oldComposerText })),
    name: null,
    order: 1,
    rawHash: "unchanged-user-hash",
    rawMessageEncoding: "text" as const,
    rawMessageType: "json",
    rawMessageValue: "{}",
    role: "user",
    toolCallId: null,
    toolCalls: null
  }
  const assistantItem = {
    content: JSON.stringify("Old response"),
    kind: "message",
    messageId: removedAssistantId,
    metadata: null,
    name: null,
    order: 2,
    rawHash: "old-assistant-hash",
    rawMessageEncoding: "text" as const,
    rawMessageType: "json",
    rawMessageValue: "{}",
    role: "assistant",
    toolCallId: null,
    toolCalls: null
  }

  await createThread(threadId)
  await createRun("run-before-edit", threadId, { status: "success" })
  const oldAdmission = await recordUserMessageCreated({
    composerText: oldComposerText,
    contentPreview: oldComposerText,
    refs: oldRefs,
    runId: "run-before-edit",
    threadId,
    userMessageId: messageId
  })
  const checkpointedOldUserItem = {
    ...oldUserItem,
    admission: oldAdmission
  }
  await persistMessageStateVersion({
    checkpointId: "checkpoint-before-edit",
    checkpointNs: "",
    messages: [checkpointedOldUserItem, assistantItem],
    runId: "run-before-edit",
    threadId,
    version: "1"
  })
  await prisma.message.deleteMany({ where: { threadId } })
  assert.equal(await prisma.message.count({ where: { threadId } }), 0)

  const refs = [
    {
      name: "replacement.txt",
      source: { kind: "text" as const, text: "replacement source" },
      type: "file-attachment" as const
    }
  ]
  const composerText = "Replacement input"
  const { admission, runId } = await beginAgentRun(
    threadId,
    createTestModelRuntimeSelection("deepseek:deepseek-v4-pro"),
    {
      startEvent: {
        composerText,
        contentPreview: composerText,
        refs,
        removeMessageIds: [removedAssistantId],
        userMessageId: messageId
      }
    }
  )

  const pendingSnapshot = await (await createThreadsServiceForTest()).getAgentThreadData(threadId)
  assert.deepEqual(
    pendingSnapshot.messages.messages.map((message) => ({
      id: message.id,
      replay: resolveComposerMessageReplay(message.content, message.metadata)
    })),
    [
      {
        id: messageId,
        replay: { input: { refs, text: composerText }, type: "ready" }
      }
    ]
  )

  await persistMessageStateVersion({
    checkpointId: "checkpoint-stale-same-id",
    checkpointNs: "",
    messages: [checkpointedOldUserItem],
    runId,
    threadId,
    version: "2"
  })
  const admissionEvent = await prisma.agentEvent.findFirstOrThrow({
    where: { runId, type: "message.user.created" }
  })
  assert.equal(admissionEvent.checkpointId, null)
  const staleCheckpointSnapshot = await (
    await createThreadsServiceForTest()
  ).getAgentThreadData(threadId)
  assert.deepEqual(
    staleCheckpointSnapshot.messages.messages.map((message) => ({
      id: message.id,
      replay: resolveComposerMessageReplay(message.content, message.metadata)
    })),
    [
      {
        id: messageId,
        replay: { input: { refs, text: composerText }, type: "ready" }
      }
    ]
  )

  const currentUserItem = {
    ...checkpointedOldUserItem,
    admission,
    content: JSON.stringify(toMessageContent({ refs, text: composerText })),
    metadata: JSON.stringify(toComposerMessageMetadata({ refs, text: composerText }))
  }
  await persistMessageStateVersion({
    checkpointId: "checkpoint-current-admission",
    checkpointNs: "",
    messages: [currentUserItem],
    runId,
    threadId,
    version: "3"
  })
  assert.equal(
    await prisma.messageEvent.count({
      where: { checkpointId: "checkpoint-current-admission", messageId }
    }),
    1
  )
  assert.equal(
    await prisma.agentEvent.count({
      where: {
        checkpointId: "checkpoint-current-admission",
        runId,
        type: "message.user.created"
      }
    }),
    1
  )

  await persistMessageStateVersion({
    checkpointId: "checkpoint-current-admission-retry",
    checkpointNs: "",
    messages: [currentUserItem],
    runId,
    threadId,
    version: "4"
  })
  assert.equal(
    (
      await prisma.agentEvent.findFirstOrThrow({
        where: { runId, type: "message.user.created" }
      })
    ).checkpointId,
    "checkpoint-current-admission"
  )
  assert.equal(
    await prisma.messageEvent.count({
      where: { checkpointId: "checkpoint-current-admission-retry", messageId }
    }),
    0
  )

  await persistMessageStateVersion({
    checkpointId: "checkpoint-after-edit-removal",
    checkpointNs: "",
    messages: [],
    runId: null,
    threadId,
    version: "5"
  })

  const checkpointedSnapshot = await (
    await createThreadsServiceForTest()
  ).getAgentThreadData(threadId)
  assert.deepEqual(checkpointedSnapshot.messages.messages, [])
})

test("cloned admission identities cannot consume a target admission with the same sequence", async () => {
  const { cloneThread, cloneThreadUntilCheckpoint, createRun, createThread, getPrismaClient } =
    await loadDbModules()
  const { beginAgentRun } = await import("../../src/main/agent/persistence")
  const { recordUserMessageCreated } = await import("../../src/main/agent/event-recorder")
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")
  const sourceThreadId = "thread-admission-clone-source"
  const sourceRunId = "run-admission-clone-source"
  const sourceMessageId = "message-admission-clone-source"
  const sourceText = "Source question"
  const prisma = getPrismaClient()

  await createThread(sourceThreadId)
  await bindThreadWorkspace(sourceThreadId, repoRoot)
  await createRun(sourceRunId, sourceThreadId, { status: "success" })
  const sourceAdmission = await recordUserMessageCreated({
    composerText: sourceText,
    contentPreview: sourceText,
    refs: [],
    runId: sourceRunId,
    threadId: sourceThreadId,
    userMessageId: sourceMessageId
  })
  assert.equal(sourceAdmission.sequence, 1)
  const [sourceMessage] = buildJingleSubmittedMessages({
    message: {
      admission: sourceAdmission,
      composerText: sourceText,
      content: sourceText,
      id: sourceMessageId,
      refs: []
    },
    removeMessageIds: []
  })
  assert.ok(sourceMessage)

  const sourceCheckpoint = emptyCheckpoint()
  sourceCheckpoint.id = "checkpoint-admission-clone-source"
  sourceCheckpoint.channel_values = { messages: [sourceMessage] }
  const sourceSaver = new PrismaCheckpointSaver()
  await sourceSaver.put(
    {
      configurable: { thread_id: sourceThreadId },
      metadata: { run_id: sourceRunId }
    },
    sourceCheckpoint,
    { parents: {}, source: "update", step: 0 }
  )

  const cloneCases = [
    {
      clone: (targetThreadId: string) => cloneThread(sourceThreadId, targetThreadId),
      name: "full"
    },
    {
      clone: (targetThreadId: string) =>
        cloneThreadUntilCheckpoint(sourceThreadId, targetThreadId, {
          checkpointId: sourceCheckpoint.id
        }),
      name: "branch"
    }
  ] as const

  for (const cloneCase of cloneCases) {
    const targetThreadId = `thread-admission-clone-target-${cloneCase.name}`
    const targetMessageId = `message-admission-clone-target-${cloneCase.name}`
    const targetText = `Target question ${cloneCase.name}`
    await cloneCase.clone(targetThreadId)
    const { admission: targetAdmission, runId: targetRunId } = await beginAgentRun(
      targetThreadId,
      createTestModelRuntimeSelection("deepseek:deepseek-v4-pro"),
      {
        startEvent: {
          composerText: targetText,
          contentPreview: targetText,
          refs: [],
          userMessageId: targetMessageId
        }
      }
    )
    assert.equal(targetAdmission.sequence, 1)
    assert.notEqual(targetAdmission.eventId, sourceAdmission.eventId)
    const [targetMessage] = buildJingleSubmittedMessages({
      message: {
        admission: targetAdmission,
        composerText: targetText,
        content: targetText,
        id: targetMessageId,
        refs: []
      },
      removeMessageIds: []
    })
    assert.ok(targetMessage)

    const targetSaver = new PrismaCheckpointSaver()
    const intermediateCheckpoint = emptyCheckpoint()
    intermediateCheckpoint.id = `checkpoint-admission-clone-intermediate-${cloneCase.name}`
    intermediateCheckpoint.channel_values = { messages: [sourceMessage] }
    await targetSaver.put(
      {
        configurable: {
          checkpoint_id: sourceCheckpoint.id,
          thread_id: targetThreadId
        },
        metadata: { run_id: targetRunId }
      },
      intermediateCheckpoint,
      { parents: { "": sourceCheckpoint.id }, source: "update", step: 1 }
    )
    assert.equal(
      (
        await prisma.agentEvent.findUniqueOrThrow({
          where: { eventId: targetAdmission.eventId }
        })
      ).checkpointId,
      null
    )
    assert.deepEqual(
      (
        await (await createThreadsServiceForTest()).getAgentThreadData(targetThreadId)
      ).messages.messages.map((message) => message.id),
      [sourceMessageId, targetMessageId]
    )

    const admittedCheckpoint = emptyCheckpoint()
    admittedCheckpoint.id = `checkpoint-admission-clone-current-${cloneCase.name}`
    admittedCheckpoint.channel_values = { messages: [sourceMessage, targetMessage] }
    await targetSaver.put(
      {
        configurable: {
          checkpoint_id: intermediateCheckpoint.id,
          thread_id: targetThreadId
        },
        metadata: { run_id: targetRunId }
      },
      admittedCheckpoint,
      { parents: { "": intermediateCheckpoint.id }, source: "update", step: 2 }
    )
    assert.equal(
      (
        await prisma.agentEvent.findUniqueOrThrow({
          where: { eventId: targetAdmission.eventId }
        })
      ).checkpointId,
      admittedCheckpoint.id
    )

    const retryCheckpoint = emptyCheckpoint()
    retryCheckpoint.id = `checkpoint-admission-clone-retry-${cloneCase.name}`
    retryCheckpoint.channel_values = { messages: [sourceMessage, targetMessage] }
    await targetSaver.put(
      {
        configurable: {
          checkpoint_id: admittedCheckpoint.id,
          thread_id: targetThreadId
        },
        metadata: { run_id: targetRunId }
      },
      retryCheckpoint,
      { parents: { "": admittedCheckpoint.id }, source: "update", step: 3 }
    )
    assert.equal(
      (
        await prisma.agentEvent.findUniqueOrThrow({
          where: { eventId: targetAdmission.eventId }
        })
      ).checkpointId,
      admittedCheckpoint.id
    )

    const removalCheckpoint = emptyCheckpoint()
    removalCheckpoint.id = `checkpoint-admission-clone-removal-${cloneCase.name}`
    removalCheckpoint.channel_values = { messages: [sourceMessage] }
    await targetSaver.put(
      {
        configurable: {
          checkpoint_id: retryCheckpoint.id,
          thread_id: targetThreadId
        },
        metadata: { run_id: targetRunId }
      },
      removalCheckpoint,
      { parents: { "": retryCheckpoint.id }, source: "update", step: 4 }
    )
    assert.deepEqual(
      (
        await (await createThreadsServiceForTest()).getAgentThreadData(targetThreadId)
      ).messages.messages.map((message) => message.id),
      [sourceMessageId]
    )
  }
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
    metadata: createTestRunMetadata({ existing: true }),
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
        { modelRuntimeSelectionAdmission: createTestPersistedResumeAdmission() }
      )
    )
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`)
  }

  const run = await getRun(runId)
  assert.equal(run?.status, "interrupted")
  assert.deepEqual(JSON.parse(run?.metadata ?? "{}"), createTestRunMetadata({ existing: true }))
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
  await createRun(runId, threadId, {
    metadata: createTestRunMetadata(),
    status: "interrupted"
  })
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
    { modelRuntimeSelectionAdmission: createTestPersistedResumeAdmission() }
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
  await createRun(runId, threadId, {
    metadata: createTestRunMetadata(),
    status: "running"
  })
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
      { modelRuntimeSelectionAdmission: createTestPersistedResumeAdmission() }
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
  await createRun(runId, threadId, {
    metadata: { modelId: "deepseek:deepseek-v4-pro" },
    status: "interrupted"
  })
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
        runModelRuntimeSelectionRecovery: createTestModelRuntimeSelection(
          "deepseek:deepseek-v4-pro"
        ),
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
  assert.equal(Object.hasOwn(metadata, "modelId"), false)
  assert.deepEqual(readRunModelRuntimeSelection(metadata), {
    kind: "ready",
    selection: createTestModelRuntimeSelection("deepseek:deepseek-v4-pro")
  })
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
  await createRun(resumeRunId, resumeThreadId, {
    metadata: createTestRunMetadata(),
    status: "interrupted"
  })
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
  const diagnostics: unknown[] = []
  const capture = mock.method(testDiagnosticsGraph, "capture", (input) => {
    diagnostics.push(input)
    return { eventId: "diag:admission-persistence:1", sequence: 1, sessionId: "test" }
  })
  const lifecycleGate = new ThreadLifecycleGate()
  const service = await createAgentServiceForTest({ threadLifecycleGate: lifecycleGate })
  Object.defineProperty(service, "agentRuntime", {
    value: {
      thread: ({ threadId }: { threadId: string }) => ({
        startInvoke: async (invoke: {
          permissionMode: "ask-to-edit" | "auto" | "explore"
          selection: ReturnType<typeof createTestModelRuntimeSelection>
          userMessage: { id: string }
        }) => {
          const started = await beginAgentRun(threadId, invoke.selection, {
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
          modelRuntimeSelectionAdmission: ReturnType<typeof createTestPersistedResumeAdmission>
          runId: string
        }) => {
          const committed = await commitAgentResumeDecision(
            threadId,
            resume.runId,
            resume.decision,
            undefined,
            { modelRuntimeSelectionAdmission: resume.modelRuntimeSelectionAdmission }
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
  const diagnostics: unknown[] = []
  const capture = mock.method(testDiagnosticsGraph, "capture", (input) => {
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
  await createRun(runId, threadId, {
    metadata: createTestRunMetadata({ existing: true }),
    status: "interrupted"
  })
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
      { message: { content: "blocked", id: "blocked-invoke" }, threadId },
      sink
    ),
    service.dispatchEditLastUserMessageAndInvoke(
      { message: { content: "blocked", id: "blocked-edit" }, threadId },
      sink
    ),
    service.dispatchResume(
      {
        decision: {
          request_id: requestId,
          tool_call_id: "tool-call-resume-persistence-recovery",
          type: "approve"
        },
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
    metadata: createTestRunMetadata({
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
    }),
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
    metadata: createTestRunMetadata({
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
    }),
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
      await agentService.steerActiveRun(threadId, {
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

test("agent cancel keeps controller ownership when the runtime abort already lost", async () => {
  const agentService = await createAgentServiceForTest()
  const threadId = "thread-cancel-runtime-abort-lost"
  const controller = new AbortController()
  let abortCalls = 0
  const activeRuns = (
    agentService as unknown as {
      activeRuns: Map<
        string,
        {
          controller: AbortController
          preparationSettled: Promise<void>
          run: { abort: () => Promise<boolean> }
          settled: Promise<void>
        }
      >
    }
  ).activeRuns
  activeRuns.set(threadId, {
    controller,
    preparationSettled: Promise.resolve(),
    run: {
      abort: async () => {
        abortCalls += 1
        return false
      }
    },
    settled: Promise.resolve()
  })

  const ownerCancel = agentService.cancel({ threadId })
  const duplicateCancel = agentService.cancel({ threadId })
  assert.equal(await ownerCancel, true)
  assert.equal(await duplicateCancel, false)
  assert.equal(abortCalls, 1)
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
          composerText: "atomic invoke admission",
          content: "atomic invoke admission",
          id: "message-atomic-invoke"
        },
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
    assert.deepEqual(JSON.parse(preparationEvents[1]?.payload ?? "{}"), {
      admissionSequence: 1,
      composerText: "atomic invoke admission",
      contentPreview: "atomic invoke admission",
      refs: [],
      removeMessageIds: [],
      userMessageId: "message-atomic-invoke"
    })
    assert.deepEqual(JSON.parse(preparationEvents[1]?.metadata ?? "{}"), {
      admissionSequence: 1
    })
    assert.match(
      preparationEvents[1]?.eventId ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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

test("edit retry derives removals from canonical message state without its projection", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const { persistMessageStateVersion } = await import("../../src/main/db/message-state")
  const consoleLog = mock.method(console, "log", () => {})
  const previousRuntimeMode = process.env.JINGLE_BDD_AGENT_RUNTIME
  const threadId = "thread-edit-canonical-message-state"
  const userMessageId = "message-edit-canonical-user"
  const assistantMessageId = "message-edit-canonical-assistant"
  const prisma = getPrismaClient()
  process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"

  try {
    await createThread(threadId)
    await bindThreadWorkspace(threadId, repoRoot)
    await persistMessageStateVersion({
      checkpointId: "checkpoint-edit-canonical-message-state",
      checkpointNs: "",
      messages: [
        {
          content: JSON.stringify("original user message"),
          kind: "message",
          messageId: userMessageId,
          metadata: null,
          name: null,
          order: 1,
          rawHash: "hash-edit-canonical-user",
          rawMessageEncoding: "text",
          rawMessageType: "json",
          rawMessageValue: "{}",
          role: "user",
          toolCallId: null,
          toolCalls: null
        },
        {
          content: JSON.stringify("original assistant message"),
          kind: "message",
          messageId: assistantMessageId,
          metadata: null,
          name: null,
          order: 2,
          rawHash: "hash-edit-canonical-assistant",
          rawMessageEncoding: "text",
          rawMessageType: "json",
          rawMessageValue: "{}",
          role: "assistant",
          toolCallId: null,
          toolCalls: null
        }
      ],
      runId: null,
      threadId,
      version: "1"
    })
    await prisma.message.deleteMany({ where: { threadId } })

    const service = await createAgentServiceForTest()
    delete process.env.JINGLE_BDD_AGENT_RUNTIME
    const outcome = await service.dispatchEditLastUserMessageAndInvoke(
      {
        message: { content: "bdd:long edited user message", id: userMessageId },
        threadId
      },
      { send: () => undefined }
    )

    assert.deepEqual(outcome, { disposition: "run", type: "accepted" })
    const event = await prisma.agentEvent.findFirstOrThrow({
      orderBy: { createdAt: "desc" },
      where: { threadId, type: "message.user.created" }
    })
    assert.deepEqual(
      (JSON.parse(event.payload) as { removeMessageIds?: string[] }).removeMessageIds,
      [assistantMessageId]
    )
    assert.equal(await service.cancel({ threadId }), true)
  } finally {
    if (previousRuntimeMode === undefined) {
      delete process.env.JINGLE_BDD_AGENT_RUNTIME
    } else {
      process.env.JINGLE_BDD_AGENT_RUNTIME = previousRuntimeMode
    }
    consoleLog.mock.restore()
  }
})

test("invoke admission rejects file content that differs from canonical composer refs", async () => {
  const { createThread, getPrismaClient } = await loadDbModules()
  const threadId = "thread-file-content-ref-mismatch"
  await createThread(threadId)
  const agentService = await createAgentServiceForTest()

  const outcome = await agentService.dispatchInvoke(
    {
      message: {
        composerText: "Review",
        content: [
          { text: "Review", type: "text" },
          {
            mimeType: "application/pdf",
            name: "remote.pdf",
            type: "file",
            url: "https://example.com/remote.pdf"
          }
        ],
        id: "message-file-content-ref-mismatch",
        refs: [
          {
            name: "embedded.pdf",
            source: {
              data: "cGRm",
              kind: "data",
              mimeType: "application/pdf"
            },
            type: "file-attachment"
          }
        ]
      },
      threadId
    },
    { send: () => {} }
  )

  assert.equal(outcome.type, "rejected")
  assert.equal(outcome.type === "rejected" ? outcome.error.code : null, "INVALID_ARGUMENT")
  assert.match(
    outcome.type === "rejected" ? outcome.error.message : "",
    /does not match canonical composer references/
  )
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
  await createRun(runId, threadId, {
    metadata: createTestRunMetadata(),
    status: "interrupted"
  })
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
    { modelRuntimeSelectionAdmission: createTestPersistedResumeAdmission() }
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
    modelRuntimeSelection: {
      modelId: "deepseek:deepseek-v4-pro",
      thinkingEffort: "high",
      version: 1
    },
    requestId,
    source: "resume"
  })
})

test("agent cancel records one aborted lifecycle for an active run", async () => {
  const { createThread, getPrismaClient, getRun } = await loadDbModules()
  const { ComputerUseRuntime } = await import("../../src/main/computer-use/runtime")
  const consoleLog = mock.method(console, "log", () => {})
  const previousRuntimeMode = process.env.JINGLE_BDD_AGENT_RUNTIME

  const threadId = "thread-cancel-active-run"
  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"

  let runId: string | null = null
  let valuesSeen = false
  const streamEvents: string[] = []
  const diagnostics: unknown[] = []
  const capture = mock.method(testDiagnosticsGraph, "capture", (input) => {
    diagnostics.push(input)
    return { eventId: "diag:cleanup:1", sequence: 1, sessionId: "test" }
  })
  const computerUseRuntime = new ComputerUseRuntime({
    createService: async () => {
      throw new Error("Computer Use remains disabled in the cancellation fixture.")
    },
    initialConfig: { computerUseApplicationAllowlist: [], computerUseEnabled: false }
  })
  let cleanupCalls = 0
  const closeRun = mock.method(computerUseRuntime, "closeRun", async () => {
    cleanupCalls += 1
    throw new Error("simulated Computer Use cleanup failure")
  })
  const agentService = await createAgentServiceForTest({ computerUseRuntime })
  const invoke = agentService.invoke(
    {
      message: {
        content: "bdd:long",
        id: "message-cancel-active-run"
      },
      threadId
    },
    {
      send: (event) => {
        streamEvents.push(event.type)
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
    assert.equal(cleanupCalls, 1)
    assert.equal(streamEvents.filter((event) => event === "cancelled").length, 1)
    assert.equal(
      diagnostics.some(
        (diagnostic) =>
          (diagnostic as { eventCode?: string }).eventCode === "agent.ownership_cleanup_failed"
      ),
      true
    )

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
    capture.mock.restore()
    closeRun.mock.restore()
    consoleLog.mock.restore()
  }
})

test("Computer Use caller lease revocation aborts one accepted Agent run", async () => {
  const { createThread, getPrismaClient, getRun } = await loadDbModules()
  const consoleLog = mock.method(console, "log", () => {})
  const previousRuntimeMode = process.env.JINGLE_BDD_AGENT_RUNTIME
  const threadId = "thread-computer-use-caller-revocation"
  const caller = new AbortController()
  await createThread(threadId)
  await bindThreadWorkspace(threadId, repoRoot)
  process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"

  let runId: string | null = null
  let valuesSeen = false
  let accepted = false
  const events: string[] = []
  const agentService = await createAgentServiceForTest()
  const invoke = agentService.invoke(
    {
      message: { content: "bdd:long", id: "message-computer-use-caller-revocation" },
      threadId
    },
    {
      send: (event) => {
        events.push(event.type)
        if (event.type === "run_started") runId = event.runId
        if (event.type === "stream" && event.mode === "values") valuesSeen = true
      }
    },
    {
      computerUseCallerLease: {
        incarnation: 1,
        signal: caller.signal,
        threadId,
        window: { kind: "main", windowId: "main" }
      },
      onCommandOutcome: (outcome) => {
        accepted = outcome.type === "accepted"
      }
    }
  )

  try {
    while (!runId || !valuesSeen) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    caller.abort(new DOMException("durable window closed", "AbortError"))
    await invoke

    assert.equal(accepted, true)
    assert.equal((await getRun(runId))?.status, "interrupted")
    assert.equal(events.filter((event) => event === "run_started").length, 1)
    assert.equal(events.filter((event) => event === "cancelled").length, 1)
    const terminalEvents = await getPrismaClient().agentEvent.findMany({
      where: { runId, type: "run.finished" }
    })
    assert.equal(terminalEvents.length, 1)
    assert.equal(JSON.parse(terminalEvents[0]?.payload ?? "{}").completionReason, "aborted")
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
  const { persistMessageStateVersion } = await import("../../src/main/db/message-state")
  const threadId = "thread-invalid-persisted-message-content"
  await createThread(threadId)
  const canonicalContent = [
    {
      name: "result.png",
      source: { data: "aW1hZ2U=", kind: "data", mimeType: "image/png" },
      type: "image"
    }
  ]
  await persistMessageStateVersion({
    checkpointId: "checkpoint-invalid-persisted-message-content",
    checkpointNs: "",
    messages: [
      {
        content: JSON.stringify(canonicalContent),
        kind: "message",
        messageId: "message-canonical",
        metadata: null,
        name: null,
        order: 1,
        rawHash: "hash-canonical",
        rawMessageEncoding: "text",
        rawMessageType: "json",
        rawMessageValue: "{}",
        role: "assistant",
        toolCallId: null,
        toolCalls: null
      },
      {
        content: JSON.stringify("placeholder corrupt content"),
        kind: "message",
        messageId: "message-corrupt",
        metadata: null,
        name: null,
        order: 2,
        rawHash: "hash-corrupt",
        rawMessageEncoding: "text",
        rawMessageType: "json",
        rawMessageValue: "{}",
        role: "user",
        toolCallId: null,
        toolCalls: null
      },
      {
        content: JSON.stringify("placeholder noncanonical content"),
        kind: "message",
        messageId: "message-noncanonical",
        metadata: null,
        name: null,
        order: 3,
        rawHash: "hash-noncanonical",
        rawMessageEncoding: "text",
        rawMessageType: "json",
        rawMessageValue: "{}",
        role: "user",
        toolCallId: null,
        toolCalls: null
      }
    ],
    runId: null,
    threadId,
    version: "1"
  })
  const prisma = getPrismaClient()
  for (const [messageId, content] of [
    ["message-corrupt", "secret raw corrupt payload"],
    ["message-noncanonical", JSON.stringify([{ content: "legacy raw payload", type: "text" }])]
  ] as const) {
    const event = await prisma.messageEvent.findFirstOrThrow({ where: { messageId, threadId } })
    await prisma.messageEvent.update({
      data: {
        payload: JSON.stringify({
          ...(JSON.parse(event.payload) as Record<string, unknown>),
          content
        })
      },
      where: { eventId: event.eventId }
    })
  }

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
    metadata: createTestRunMetadata({
      [AGENT_RUN_FAILURE_METADATA_KEY]: toAgentRunFailure(
        "agent:runtime",
        new Error("previous resume failed")
      ),
      error: "401 authentication_error"
    }),
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
    { modelRuntimeSelectionAdmission: createTestPersistedResumeAdmission() }
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

test("abort atomically seals pending HITL and rejects every later resume decision", async () => {
  const {
    createRun,
    createThread,
    getHitlRequest,
    getLatestPendingHitlRequest,
    getPrismaClient,
    getRun,
    getThread,
    hasPendingHitlRequest,
    hasPendingHitlRequestForRun,
    upsertHitlRequest
  } = await loadDbModules()
  const { commitAgentResumeDecision, markRunAborted } =
    await import("../../src/main/agent/persistence")
  const threadId = "thread-abort-clears-stale-run-failure"
  const runId = "run-abort-clears-stale-run-failure"
  const pendingRequestId = "request-abort-seals-hitl"
  const prisma = getPrismaClient()
  await createThread(threadId)
  await prisma.thread.update({ data: { status: "busy" }, where: { threadId } })
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
  await upsertHitlRequest({
    allowed_decisions: ["approve", "user_declined", "corrected"],
    request_id: pendingRequestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-abort-seals-hitl",
    tool_name: "write_file"
  })

  await markRunAborted(threadId, runId)
  const run = await getRun(runId)
  const metadata = JSON.parse(run?.metadata ?? "{}") as Record<string, unknown>
  assert.equal(run?.status, "interrupted")
  assert.equal((await getThread(threadId))?.status, "interrupted")
  assert.equal(Object.hasOwn(metadata, AGENT_RUN_FAILURE_METADATA_KEY), false)
  assert.equal(Object.hasOwn(metadata, "error"), false)
  assert.equal((await getHitlRequest(pendingRequestId))?.status, "cancelled")

  const terminalEvents = await prisma.agentEvent.findMany({
    orderBy: { seq: "asc" },
    where: { runId, type: { in: ["run.interrupted", "run.finished"] } }
  })
  assert.deepEqual(
    terminalEvents.map((event) => [event.type, JSON.parse(event.payload)]),
    [
      ["run.interrupted", { status: "interrupted" }],
      [
        "run.finished",
        {
          completionReason: "aborted",
          errorMessage: null,
          errorType: null,
          status: "interrupted"
        }
      ]
    ]
  )

  const decisions = [
    { type: "approve" as const },
    { correction: "retry after abort", type: "corrected" as const },
    { type: "user_declined" as const }
  ]
  for (const [index, decision] of decisions.entries()) {
    const requestId = `request-after-abort-${decision.type}`
    const toolCallId = `tool-after-abort-${decision.type}`
    await assert.rejects(
      upsertHitlRequest({
        allowed_decisions: ["approve", "user_declined", "corrected"],
        request_id: requestId,
        run_id: runId,
        status: "pending",
        thread_id: threadId,
        tool_args: {},
        tool_call_id: toolCallId,
        tool_name: "write_file"
      }),
      /Cannot persist pending request .* for terminal run/
    )
    assert.equal(await getHitlRequest(requestId), null, `write fence ${index}`)

    const now = BigInt(Date.now() + index)
    await prisma.hitlRequest.create({
      data: {
        allowedDecisions: JSON.stringify(["approve", "user_declined", "corrected"]),
        createdAt: now,
        decision: null,
        requestId,
        resolvedAt: null,
        runId,
        status: "pending",
        threadId,
        toolArgs: "{}",
        toolCallId,
        toolName: "write_file",
        updatedAt: now
      }
    })
    await assert.rejects(
      commitAgentResumeDecision(
        threadId,
        runId,
        { ...decision, request_id: requestId, tool_call_id: toolCallId },
        undefined,
        decision.type === "user_declined"
          ? {}
          : { modelRuntimeSelectionAdmission: createTestPersistedResumeAdmission() }
      ),
      /Cannot resume terminal run/
    )
    assert.equal((await getHitlRequest(requestId))?.status, "pending", `decision ${index}`)
  }

  assert.equal(await getLatestPendingHitlRequest(threadId), null)
  assert.equal(await hasPendingHitlRequest(threadId), false)
  assert.equal(await hasPendingHitlRequestForRun(threadId, runId), false)
  await assert.rejects(markRunAborted(threadId, runId), /Cannot abort terminal run/)
  assert.equal(await prisma.agentEvent.count({ where: { runId, type: "run.finished" } }), 1)
  assert.equal(await prisma.agentEvent.count({ where: { runId, type: "run.resumed" } }), 0)
})

test("abort terminal transaction rolls back HITL, Run, Thread, and events together", async () => {
  const {
    createRun,
    createThread,
    getHitlRequest,
    getPrismaClient,
    getRun,
    getThread,
    upsertHitlRequest
  } = await loadDbModules()
  const { markRunAborted } = await import("../../src/main/agent/persistence")
  const threadId = "thread-abort-terminal-rollback"
  const runId = "run-abort-terminal-rollback"
  const requestId = "request-abort-terminal-rollback"
  const triggerName = "fail_abort_run_finished_append"
  const prisma = getPrismaClient()
  await createThread(threadId)
  await prisma.thread.update({ data: { status: "busy" }, where: { threadId } })
  await createRun(runId, threadId, { status: "running" })
  await upsertHitlRequest({
    allowed_decisions: ["approve", "user_declined", "corrected"],
    request_id: requestId,
    run_id: runId,
    status: "pending",
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-abort-terminal-rollback",
    tool_name: "write_file"
  })
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON "agent_events"
    WHEN NEW."run_id" = '${runId}' AND NEW."type" = 'run.finished'
    BEGIN
      SELECT RAISE(FAIL, 'injected abort run.finished append failure');
    END
  `)

  try {
    await assert.rejects(markRunAborted(threadId, runId))
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`)
  }

  assert.equal((await getRun(runId))?.status, "running")
  assert.equal((await getThread(threadId))?.status, "busy")
  assert.equal((await getHitlRequest(requestId))?.status, "pending")
  assert.equal(await prisma.agentEvent.count({ where: { runId } }), 0)
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

  const { runId } = await beginAgentRun(threadId, createTestModelRuntimeSelection("gpt-test"), {
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
  assert.deepEqual(readRunModelRuntimeSelection(createdMetadata), {
    kind: "ready",
    selection: createTestModelRuntimeSelection("gpt-test")
  })
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
    { modelRuntimeSelectionAdmission: createTestPersistedResumeAdmission("gpt-test") }
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

  const { runId } = await beginAgentRun(threadId, createTestModelRuntimeSelection("gpt-test"), {
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

  const { runId } = await beginAgentRun(threadId, createTestModelRuntimeSelection("gpt-test"), {
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
      { modelRuntimeSelectionAdmission: createTestPersistedResumeAdmission("gpt-test") }
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

test("checkpoint projection reads only the run selected by the core interrupted outcome", async () => {
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

  const status = await syncRunFromLatestCheckpoint(threadId, interruptedRunId, {
    interrupted: true
  })
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

test("prisma checkpoint saver stores message facts without runtime projection side effects", async () => {
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

  assert.equal(searchRows.length, 0)
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

test("syncRunFromLatestCheckpoint accepts submitted canonical message without its projection", async () => {
  const { createRun, createThread, getPrismaClient, getRun } = await loadDbModules()
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
  await getPrismaClient().message.deleteMany({ where: { threadId } })

  await assert.doesNotReject(
    syncRunFromLatestCheckpoint(threadId, runId, {
      expectedMessageId: "message-new"
    })
  )
  assert.equal((await getRun(runId))?.status, "success")
})

test("missing canonical submitted message commits durable failure instead of success", async () => {
  const { createRun, createThread, getPrismaClient, getRun, getThread } = await loadDbModules()
  const { markRunAborted, RunCompletionCoreValidationError, syncRunFromLatestCheckpoint } =
    await import("../../src/main/agent/persistence")
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
    syncRunFromLatestCheckpoint(threadId, runId, { expectedMessageId: "message-new" }),
    (error) => {
      assert.ok(error instanceof RunCompletionCoreValidationError)
      assert.equal(error.durableFailure.status, "error")
      return true
    }
  )

  assert.equal((await getRun(runId))?.status, "error")
  assert.equal((await getThread(threadId))?.status, "error")
  assert.equal(
    await getPrismaClient().agentEvent.count({ where: { runId, type: "run.finished" } }),
    1
  )
  const finished = await getPrismaClient().agentEvent.findFirstOrThrow({
    where: { runId, type: "run.finished" }
  })
  assert.equal((JSON.parse(finished.payload) as { status: string }).status, "error")
  await assert.rejects(markRunAborted(threadId, runId), /Cannot abort terminal run/)
})

test("missing checkpoint commits durable failure and one terminal winner", async () => {
  const {
    createRun,
    createThread,
    getHitlRequest,
    getPrismaClient,
    getRun,
    getThread,
    upsertHitlRequest
  } = await loadDbModules()
  const { markRunCancelled, RunCompletionCoreValidationError, syncRunFromLatestCheckpoint } =
    await import("../../src/main/agent/persistence")
  const threadId = "thread-missing-core-checkpoint"
  const runId = "run-missing-core-checkpoint"
  const prisma = getPrismaClient()
  await createThread(threadId)
  await prisma.thread.update({ data: { status: "busy" }, where: { threadId } })
  await createRun(runId, threadId, { status: "running" })
  await upsertHitlRequest({
    allowed_decisions: ["approve"],
    request_id: "request-missing-core-checkpoint",
    run_id: runId,
    thread_id: threadId,
    tool_args: {},
    tool_call_id: "tool-missing-core-checkpoint",
    tool_name: "write_file"
  })

  await assert.rejects(syncRunFromLatestCheckpoint(threadId, runId), (error) => {
    assert.ok(error instanceof RunCompletionCoreValidationError)
    assert.equal(error.durableFailure.status, "error")
    return true
  })

  assert.equal((await getRun(runId))?.status, "error")
  assert.equal((await getThread(threadId))?.status, "error")
  assert.equal((await getHitlRequest("request-missing-core-checkpoint"))?.status, "cancelled")
  assert.equal(await prisma.agentEvent.count({ where: { runId, type: "run.finished" } }), 1)
  assert.equal(
    (
      JSON.parse(
        (await prisma.agentEvent.findFirstOrThrow({ where: { runId, type: "run.finished" } }))
          .payload
      ) as { status: string }
    ).status,
    "error"
  )
  await assert.rejects(markRunCancelled(threadId, runId), /Cannot cancel terminal run/)
  assert.equal(await prisma.agentEvent.count({ where: { runId, type: "run.finished" } }), 1)
})

test("damaged checkpoint core facts commit durable failure", async () => {
  const { createRun, createThread, getPrismaClient, getRun } = await loadDbModules()
  const { RunCompletionCoreValidationError, syncRunFromLatestCheckpoint } =
    await import("../../src/main/agent/persistence")
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")
  const threadId = "thread-damaged-core-checkpoint"
  const runId = "run-damaged-core-checkpoint"
  const prisma = getPrismaClient()
  await createThread(threadId)
  await prisma.thread.update({ data: { status: "busy" }, where: { threadId } })
  await createRun(runId, threadId, { status: "running" })

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-damaged-core-facts"
  checkpoint.channel_values = {
    contextInclusions: [{ id: "context-core-fact", kind: "memory" }]
  }
  const saver = new PrismaCheckpointSaver()
  await saver.put(
    {
      configurable: { thread_id: threadId },
      metadata: { run_id: runId }
    },
    checkpoint,
    { parents: {}, source: "update", step: 0 }
  )
  await prisma.checkpointBlob.deleteMany({
    where: { channel: "contextInclusions", threadId }
  })

  await assert.rejects(syncRunFromLatestCheckpoint(threadId, runId), (error) => {
    assert.ok(error instanceof RunCompletionCoreValidationError)
    assert.equal(error.durableFailure.status, "error")
    return true
  })
  assert.equal((await getRun(runId))?.status, "error")
  assert.equal(await prisma.agentEvent.count({ where: { runId, type: "run.finished" } }), 1)
  assert.equal(
    (
      JSON.parse(
        (await prisma.agentEvent.findFirstOrThrow({ where: { runId, type: "run.finished" } }))
          .payload
      ) as { status: string }
    ).status,
    "error"
  )
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

test("runtime checkpoint saver rolls back pending HITL and core facts together", async () => {
  const { createRun, createThread, getPrismaClient } = await loadDbModules()
  const { RuntimeCheckpointSaver } =
    await import("../../src/main/checkpointer/runtime-checkpointer")
  const { createRuntimeThreadStreamDrainControlFromController } =
    await import("../../packages/langchain-agent-harness/src/runtime-thread-stream")
  const threadId = "thread-checkpoint-transaction-fact-rollback"
  const runId = "run-checkpoint-transaction-fact-rollback"
  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-transaction-fact-rollback"
  checkpoint.channel_values = {
    __interrupt__: [
      {
        value: {
          actionRequests: [
            {
              args: { path: `${repoRoot}/must-roll-back.txt` },
              name: "write_file",
              toolCallId: "tool-call-transaction-fact-rollback"
            }
          ]
        }
      }
    ],
    messages: [
      {
        kwargs: { content: "must roll back", id: "message-transaction-fact-rollback" },
        type: "human"
      }
    ]
  }
  checkpoint.channel_versions = { messages: "messages-transaction-fact-rollback" }
  await createThread(threadId)
  await createRun(runId, threadId, { status: "running" })

  let streamedChunkCount = 0
  const stream = createRuntimeThreadStreamDrainControlFromController({
    pauseController: { parseReview: () => null },
    thread: { threadId, workspacePath: repoRoot }
  })
  const streamed = await stream.drainRunStream({
    onChunk: () => {
      streamedChunkCount += 1
    },
    runId,
    signal: new AbortController().signal,
    stream: {
      async *[Symbol.asyncIterator]() {
        yield ["values", checkpoint.channel_values] as [string, unknown]
      }
    }
  })
  const prisma = getPrismaClient()
  assert.deepEqual(streamed, { interrupted: true })
  assert.equal(streamedChunkCount, 1)
  assert.equal(await prisma.hitlRequest.count({ where: { runId } }), 0)

  class FailingRuntimeCheckpointSaver extends RuntimeCheckpointSaver {
    protected override async persistCheckpointTransactionFacts(
      input: PrismaCheckpointPutTransactionInput
    ): Promise<void> {
      await super.persistCheckpointTransactionFacts(input)
      throw new Error("injected checkpoint transaction fact failure")
    }
  }
  const saver = new FailingRuntimeCheckpointSaver()
  try {
    await assert.rejects(
      saver.put(
        { configurable: { thread_id: threadId }, metadata: { run_id: runId } },
        checkpoint,
        { parents: {}, source: "update", step: 0 }
      ),
      /injected checkpoint transaction fact failure/
    )

    assert.equal(await prisma.checkpoint.count({ where: { threadId } }), 0)
    assert.equal(await prisma.checkpointBlob.count({ where: { threadId } }), 0)
    assert.equal(await prisma.hitlRequest.count({ where: { runId } }), 0)
    assert.equal(await prisma.messageStateVersion.count({ where: { threadId } }), 0)
    assert.equal(await prisma.messageEvent.count({ where: { threadId } }), 0)
    assert.equal(await prisma.message.count({ where: { threadId } }), 0)
  } finally {
    await saver.close()
  }
})

test("completion and cancellation terminal writes roll back as one transaction", async () => {
  const { createRun, createThread, getPrismaClient, getRun, getThread } = await loadDbModules()
  const { finalizeRunWithoutCheckpoint, markRunCancelled } =
    await import("../../src/main/agent/persistence")
  const prisma = getPrismaClient()

  for (const terminal of ["completion", "cancellation"] as const) {
    const threadId = `thread-${terminal}-terminal-rollback`
    const runId = `run-${terminal}-terminal-rollback`
    const triggerName = `fail_${terminal}_run_finished_append`
    await createThread(threadId)
    await prisma.thread.update({ data: { status: "busy" }, where: { threadId } })
    await createRun(runId, threadId, { status: "running" })
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "agent_events"
      WHEN NEW."run_id" = '${runId}' AND NEW."type" = 'run.finished'
      BEGIN
        SELECT RAISE(FAIL, 'injected ${terminal} run.finished append failure');
      END
    `)

    try {
      await assert.rejects(
        terminal === "completion"
          ? finalizeRunWithoutCheckpoint(threadId, runId)
          : markRunCancelled(threadId, runId)
      )
      assert.equal((await getRun(runId))?.status, "running")
      assert.equal((await getThread(threadId))?.status, "busy")
      assert.equal(
        await prisma.agentEvent.count({
          where: { runId, type: { in: ["run.interrupted", "run.finished"] } }
        }),
        0
      )
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`)
    }
  }
})

test("completion, cancellation, and abort share one durable terminal winner", async () => {
  const { createRun, createThread, getPrismaClient, getRun, getThread } = await loadDbModules()
  const { finalizeRunWithoutCheckpoint, markRunAborted, markRunCancelled } =
    await import("../../src/main/agent/persistence")
  const prisma = getPrismaClient()
  const threadId = "thread-terminal-race"
  const runId = "run-terminal-race"
  await createThread(threadId)
  await prisma.thread.update({ data: { status: "busy" }, where: { threadId } })
  await createRun(runId, threadId, { status: "running" })

  const results = await Promise.allSettled([
    finalizeRunWithoutCheckpoint(threadId, runId),
    markRunCancelled(threadId, runId),
    markRunAborted(threadId, runId)
  ])
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1)
  assert.equal(results.filter((result) => result.status === "rejected").length, 2)

  const finishedEvents = await prisma.agentEvent.findMany({
    where: { runId, type: "run.finished" }
  })
  assert.equal(finishedEvents.length, 1)
  const payload = JSON.parse(finishedEvents[0]!.payload) as {
    completionReason: string | null
    status: string
  }
  const run = await getRun(runId)
  const thread = await getThread(threadId)
  assert.equal(run?.status, payload.status)
  assert.equal(thread?.status, payload.status === "interrupted" ? "interrupted" : "idle")
  assert.equal(
    await prisma.agentEvent.count({ where: { runId, type: "run.interrupted" } }),
    payload.status === "interrupted" ? 1 : 0
  )
})

test("pending HITL creation racing abort cannot survive the terminal fence", async () => {
  const {
    createRun,
    createThread,
    getHitlRequest,
    getPrismaClient,
    hasPendingHitlRequestForRun,
    upsertHitlRequest
  } = await loadDbModules()
  const { markRunAborted } = await import("../../src/main/agent/persistence")
  const prisma = getPrismaClient()
  const threadId = "thread-hitl-abort-fence-race"
  const runId = "run-hitl-abort-fence-race"
  const requestId = "request-hitl-abort-fence-race"
  await createThread(threadId)
  await prisma.thread.update({ data: { status: "busy" }, where: { threadId } })
  await createRun(runId, threadId, { status: "running" })

  const [hitlResult, abortResult] = await Promise.allSettled([
    upsertHitlRequest({
      allowed_decisions: ["approve"],
      request_id: requestId,
      run_id: runId,
      status: "pending",
      thread_id: threadId,
      tool_args: {},
      tool_call_id: "tool-hitl-abort-fence-race",
      tool_name: "write_file"
    }),
    markRunAborted(threadId, runId)
  ])
  assert.equal(abortResult.status, "fulfilled")
  assert.ok(
    hitlResult.status === "rejected" || (await getHitlRequest(requestId))?.status === "cancelled"
  )
  assert.equal(await hasPendingHitlRequestForRun(threadId, runId), false)
  assert.equal(await prisma.hitlRequest.count({ where: { runId, status: "pending", threadId } }), 0)
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

test("message search projection failure cannot roll back a committed checkpoint", async () => {
  const { createThread, createRun, getPrismaClient } = await loadDbModules()
  const {
    createMessageSearchProjectionCoordinator,
    flushMessageSearchProjection,
    RuntimeCheckpointSaver,
    startMessageSearchProjectionLifecycle
  } = await import("../../src/main/checkpointer/runtime-checkpointer")
  const threadId = "thread-runtime-search-projection-failure"
  const runId = "run-runtime-search-projection-failure"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "running" })

  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-runtime-search-projection-failure"
  checkpoint.channel_values = {
    messages: [
      {
        kwargs: { content: "checkpoint survives derived failure", id: "message-derived-failure" },
        type: "human"
      }
    ]
  }

  let markProjectionStarted: (() => void) | undefined
  const projectionStarted = new Promise<void>((resolve) => {
    markProjectionStarted = resolve
  })
  let releaseProjection: (() => void) | undefined
  const projectionRelease = new Promise<void>((resolve) => {
    releaseProjection = resolve
  })
  const projectionCoordinator = createMessageSearchProjectionCoordinator({
    async syncEntries() {
      markProjectionStarted?.()
      await projectionRelease
      throw new Error("forced message search projection failure")
    }
  })
  const saver = new RuntimeCheckpointSaver({
    messageSearchProjectionCoordinator: projectionCoordinator
  })
  await saver.put(
    {
      configurable: { thread_id: threadId },
      metadata: { run_id: runId }
    },
    checkpoint,
    { parents: {}, source: "update", step: 0 }
  )

  const prisma = getPrismaClient()
  const warningArgs: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => warningArgs.push(args)
  const projectionFlush = projectionCoordinator.flush()
  try {
    await projectionStarted

    assert.equal(await prisma.checkpoint.count({ where: { threadId } }), 1)
    assert.equal(await prisma.messageEvent.count({ where: { threadId } }), 1)
    assert.equal(await prisma.messageStateVersion.count({ where: { threadId } }), 1)
    assert.equal(await prisma.message.count({ where: { threadId } }), 1)

    releaseProjection?.()
    await projectionFlush
  } finally {
    releaseProjection?.()
    await projectionFlush
    console.warn = originalWarn
  }

  assert.equal(
    warningArgs.some((args) => String(args[0]).includes("MessageSearchProjector")),
    true
  )

  await saver.close()
  await startMessageSearchProjectionLifecycle()
  await flushMessageSearchProjection()
  const restoredRows = await prisma.$queryRawUnsafe<Array<{ search_text: string }>>(
    `SELECT search_text FROM "messages_fts" WHERE thread_id = ?`,
    threadId
  )
  assert.deepEqual(
    restoredRows.map((row) => row.search_text),
    ["checkpoint survives derived failure"]
  )
})

test("closeRuntimeCheckpointers closes producers before flushing message search projection", async () => {
  const { createThread, createRun, getPrismaClient } = await loadDbModules()
  const { closeRuntimeCheckpointers, getCheckpointer } =
    await import("../../src/main/checkpointer/runtime-checkpointer-manager")
  const threadId = "thread-close-runtime-search-projection"
  const runId = "run-close-runtime-search-projection"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "running" })
  const firstSaver = await getCheckpointer(threadId)
  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-close-runtime-search-projection"
  checkpoint.channel_values = {
    messages: [
      {
        kwargs: { content: "flush after saver close", id: "message-close-runtime" },
        type: "human"
      }
    ]
  }
  await firstSaver.put(
    {
      configurable: { thread_id: threadId },
      metadata: { run_id: runId }
    },
    checkpoint,
    { parents: {}, source: "update", step: 0 }
  )

  await closeRuntimeCheckpointers()

  const rows = await getPrismaClient().$queryRawUnsafe<Array<{ search_text: string }>>(
    `SELECT search_text FROM "messages_fts" WHERE thread_id = ?`,
    threadId
  )
  assert.deepEqual(
    rows.map((row) => row.search_text),
    ["flush after saver close"]
  )
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

test("generated title projection failure preserves terminal and remains retryable", async () => {
  const { createRun, createThread, getPrismaClient, getRun, getThread } = await loadDbModules()
  const { projectRunCompletionCheckpointFacts, syncRunFromLatestCheckpoint } =
    await import("../../src/main/agent/persistence")
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")
  const prisma = getPrismaClient()
  const threadId = "thread-title-projection-failure"
  const runId = "run-title-projection-failure"
  const triggerName = "fail_generated_title_projection"

  await createThread(threadId, {
    metadata: { source: "launcher-ai" },
    title: "快速提问"
  })
  await createRun(runId, threadId, { status: "running" })
  const checkpoint = emptyCheckpoint()
  checkpoint.id = "checkpoint-title-projection-failure"
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
      configurable: { thread_id: threadId },
      metadata: { run_id: runId }
    },
    checkpoint,
    { parents: {}, source: "update", step: 0 }
  )
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE UPDATE OF "title" ON "threads"
    WHEN NEW."thread_id" = '${threadId}'
    BEGIN
      SELECT RAISE(FAIL, 'injected title projection failure');
    END
  `)
  const consoleError = mock.method(console, "error", () => {})
  try {
    await assert.doesNotReject(syncRunFromLatestCheckpoint(threadId, runId))
  } finally {
    consoleError.mock.restore()
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`)
  }

  assert.equal((await getRun(runId))?.status, "success")
  assert.equal((await getThread(threadId))?.status, "idle")
  assert.equal((await getThread(threadId))?.title, "快速提问")
  assert.equal(await prisma.agentEvent.count({ where: { runId, type: "run.finished" } }), 1)

  await projectRunCompletionCheckpointFacts(threadId, runId)
  assert.equal((await getThread(threadId))?.title, "发布摘要整理")
  assert.equal(await prisma.agentEvent.count({ where: { runId, type: "run.finished" } }), 1)
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
      [MODEL_RUNTIME_SELECTION_METADATA_KEY]: createTestModelRuntimeSelection(
        "deepseek:deepseek-v4-pro"
      ),
      [MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY]: 1,
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

test("thread fork requires a ready runtime selection before any clone write", async () => {
  const { createThread, getPrismaClient, getThread } = await loadDbModules()
  const service = await createThreadsServiceForTest()
  const prisma = getPrismaClient()
  const nonReadyMetadata = [
    { model: "openai:gpt-legacy" },
    {
      [MODEL_RUNTIME_SELECTION_METADATA_KEY]: { modelId: "broken", version: 2 },
      [MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY]: 1
    },
    { [MODEL_RUNTIME_SELECTION_METADATA_KEY]: undefined }
  ]

  for (const [index, metadata] of nonReadyMetadata.entries()) {
    const sourceThreadId = `thread-non-ready-fork-${index}`
    await createThread(sourceThreadId, { metadata })
    await bindThreadWorkspace(sourceThreadId, repoRoot)
    const countsBefore = {
      checkpoints: await prisma.checkpoint.count(),
      threads: await prisma.thread.count(),
      workspaceBindings: await prisma.threadWorkspaceBinding.count()
    }

    for (const fork of [
      () => service.clone(sourceThreadId),
      () => service.cloneUntilMessage(sourceThreadId, "missing-message")
    ]) {
      await assert.rejects(
        fork(),
        (error: unknown) =>
          (error as { code?: string }).code === "FAILED_PRECONDITION" &&
          /Select (?:a |the )?model/.test((error as Error).message)
      )
      assert.deepEqual(
        {
          checkpoints: await prisma.checkpoint.count(),
          threads: await prisma.thread.count(),
          workspaceBindings: await prisma.threadWorkspaceBinding.count()
        },
        countsBefore
      )
    }
  }

  const readySourceThreadId = "thread-ready-fork"
  await createThread(readySourceThreadId)
  await bindThreadWorkspace(readySourceThreadId, repoRoot)
  const cloned = await service.clone(readySourceThreadId)
  const persistedClone = await getThread(cloned.thread_id)
  const persistedCloneMetadata = persistedClone?.metadata
    ? (JSON.parse(persistedClone.metadata) as Record<string, unknown>)
    : undefined
  assert.deepEqual(readThreadModelRuntimeSelection(persistedCloneMetadata), {
    kind: "ready",
    selection: createTestModelRuntimeSelection("deepseek:deepseek-v4-pro")
  })
  assert.ok(
    await prisma.threadWorkspaceBinding.findUnique({
      where: { threadId: cloned.thread_id }
    })
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
