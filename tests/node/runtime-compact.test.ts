import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { HumanMessage, RemoveMessage, type BaseMessage } from "@langchain/core/messages"
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph"
import {
  copyCheckpoint,
  emptyCheckpoint,
  uuid6,
  type CheckpointMetadata
} from "@langchain/langgraph-checkpoint"
import {
  createJingleCompactionController,
  type JingleCompactionController
} from "../../packages/langchain-agent-harness/src/compaction-controller"
import type { JingleSummarizationController } from "../../packages/langchain-agent-harness/src/harness-runtime/summarization"
import {
  CompactBoundaryNotStable,
  CompactCheckpointConflict,
  CompactOperationIdentityConflict,
  readRuntimeCompactionCommitMetadata,
  type RuntimeCheckpointCompactionStore
} from "../../packages/langchain-agent-harness/src/runtime-checkpoint-compaction"
import {
  parseRuntimeCompactInput,
  type RuntimeCompactInput
} from "../../packages/langchain-agent-harness/src/runtime-operation"
import { createRuntimeCompactionSummarizationController } from "../../packages/langchain-agent-harness/src/agent-loop"
import { createRuntimeThreadContext } from "../../packages/langchain-agent-harness/src/runtime-thread-context"
import { createRuntimeThreadOperationControl } from "../../packages/langchain-agent-harness/src/runtime-thread-operations"
import { createCheckpointCompactionStore } from "../../src/main/checkpointer/checkpoint-compaction-store"
import type { PrismaCheckpointSaver } from "../../src/main/checkpointer/prisma-saver"
import { FakeToolCallingModel } from "langchain"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

async function loadDbModules() {
  const db = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  return { ...db, getPrismaClient }
}

test.before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-runtime-compact-"))
  process.env.JINGLE_HOME = jingleHome
  execFileSync("node", ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: { ...process.env, JINGLE_HOME: jingleHome }
  })
})

test.beforeEach(async () => {
  const { closeDatabase, getPrismaClient, initializeDatabase } = await loadDbModules()
  await closeDatabase()
  await initializeDatabase()
  await getPrismaClient().thread.deleteMany()
})

test.after(async () => {
  const { closeDatabase } = await loadDbModules()
  await closeDatabase()
  if (originalJingleHome === undefined) {
    delete process.env.JINGLE_HOME
  } else {
    process.env.JINGLE_HOME = originalJingleHome
  }
  await rm(jingleHome, { force: true, recursive: true })
})

test("manual compact commits owned values while preserving checkpoint facts", async () => {
  const fixture = await createFixture("thread-compact-success")
  const calls = { count: 0, modelIds: [] as string[] }
  const controller = createController(fixture.store, calls)
  const control = createRuntimeThreadOperationControl(
    createRuntimeThreadContext({ threadId: fixture.threadId, workspacePath: repoRoot }),
    controller
  )

  const result = await control.compact({
    modelId: "  provider/model-selected  ",
    operationId: "  compact-success-1  ",
    reason: "manual verification",
    trigger: "manual"
  })

  const latest = await fixture.saver.getTuple({
    configurable: { thread_id: fixture.threadId }
  })
  assert.ok(latest)
  assert.ok(latest.metadata)
  assert.notEqual(latest.checkpoint.id, fixture.checkpointId)
  assert.equal(latest.parentConfig?.configurable?.checkpoint_id, fixture.checkpointId)
  assert.equal((latest.metadata as Record<string, unknown>).ownerMetadata, "preserve")
  assert.deepEqual(readRuntimeCompactionCommitMetadata(latest.metadata), {
    expectedCheckpointId: fixture.checkpointId,
    messageCountAfterCompaction: 1,
    messageCountBeforeCompaction: 2,
    modelId: "provider/model-selected",
    operationId: "compact-success-1",
    preserveLastUserMessageCount: null,
    preserveLastUserMessageCountPresent: false,
    reason: "manual verification",
    trigger: "manual"
  })
  assert.deepEqual(latest.checkpoint.channel_values.opaque, { coreFact: "preserve" })
  assert.deepEqual(latest.checkpoint.versions_seen.opaque_owner, fixture.opaqueVersionSeen)
  assert.equal(readMessages(latest.checkpoint.channel_values.messages)[0]?.content, "summary-1")
  assert.equal(result.compaction.compactionId, "compact-success-1")
  assert.equal(result.compaction.reason, "manual verification")
  assert.equal(result.messageCountBeforeCompaction, 2)
  assert.equal(result.messageCountAfterCompaction, 1)
  assert.equal(calls.count, 1)
  assert.deepEqual(calls.modelIds, ["provider/model-selected"])
  const receipt = await fixture.saver.readCompactionCommit({
    operationId: "compact-success-1",
    threadId: fixture.threadId
  })
  assert.ok(receipt)
  assert.deepEqual(
    {
      modelId: receipt.modelId,
      preserveLastUserMessageCount: receipt.preserveLastUserMessageCount,
      preserveLastUserMessageCountPresent: receipt.preserveLastUserMessageCountPresent,
      reason: receipt.reason,
      trigger: receipt.trigger
    },
    {
      modelId: "provider/model-selected",
      preserveLastUserMessageCount: null,
      preserveLastUserMessageCountPresent: false,
      reason: "manual verification",
      trigger: "manual"
    }
  )
})

test("manual compact rejects malformed input before any compact side effect", async () => {
  const fixture = await createFixture("thread-compact-invalid-input")
  const calls = { count: 0 }
  const controller = createController(fixture.store, calls)
  let compactionPortCalls = 0
  const context = createRuntimeThreadContext({
    threadId: fixture.threadId,
    workspacePath: repoRoot
  })
  const control = createRuntimeThreadOperationControl(context, {
    compact: async (input) => {
      compactionPortCalls += 1
      return controller.compact(input)
    }
  })
  const validInput = {
    modelId: "provider/model-selected",
    operationId: "compact-invalid-base",
    trigger: "manual"
  } as const
  let accessorReads = 0
  const accessorInput = { ...validInput }
  Object.defineProperty(accessorInput, "reason", {
    enumerable: true,
    get: () => {
      accessorReads += 1
      return "must-not-be-read"
    }
  })
  const alternatingAccessorInput = { ...validInput }
  Object.defineProperty(alternatingAccessorInput, "preserveLastUserMessageCount", {
    enumerable: true,
    get: () => {
      accessorReads += 1
      return accessorReads % 2 === 0 ? -1 : 1
    }
  })
  const customPrototypeInput = Object.assign(Object.create({ inherited: true }), validInput)
  const sparseArrayInput = Object.assign(new Array(4), validInput)
  const invalidInputs: readonly unknown[] = [
    null,
    customPrototypeInput,
    sparseArrayInput,
    accessorInput,
    alternatingAccessorInput,
    { ...validInput, operationId: "   " },
    { ...validInput, operationId: 42 },
    { ...validInput, modelId: "   " },
    { ...validInput, modelId: { provider: "invalid" } },
    { ...validInput, trigger: "pre-run" },
    { ...validInput, reason: { text: "invalid" } },
    { ...validInput, preserveLastUserMessageCount: -1 },
    { ...validInput, preserveLastUserMessageCount: 1.5 },
    { ...validInput, preserveLastUserMessageCount: Number.MAX_SAFE_INTEGER + 1 }
  ]

  for (const invalidInput of invalidInputs) {
    await assert.rejects(control.compact(invalidInput as RuntimeCompactInput), /\[RuntimeCompact\]/)
  }

  const reservation = context.reserveRun()
  context.releaseRunReservation(reservation)
  assert.equal(accessorReads, 0)
  assert.equal(compactionPortCalls, 0)
  assert.equal(calls.count, 0)
  assert.equal(await countCheckpoints(fixture.threadId), 1)
  assert.equal(await countCompactionCommits(fixture.threadId), 0)
})

test("manual compact parser returns a detached frozen canonical command", () => {
  const original: RuntimeCompactInput = {
    modelId: "  provider/model-selected  ",
    operationId: "  compact-canonical-1  ",
    reason: undefined,
    trigger: "manual"
  }

  const canonical = parseRuntimeCompactInput(original)
  original.modelId = "provider/changed"
  original.reason = "changed"

  assert.ok(Object.isFrozen(canonical))
  assert.notEqual(canonical, original)
  assert.deepEqual(canonical, {
    modelId: "provider/model-selected",
    operationId: "compact-canonical-1",
    reason: null,
    trigger: "manual"
  })
})

test("manual compact snapshots transitional command and scope descriptors exactly once", async () => {
  const fixture = await createFixture("thread-compact-scope-snapshot")
  const calls = { count: 0 }
  let checkpointStoreCalls = 0
  let threadIdDescriptorReads = 0
  const controller = createController(
    {
      commit: async (input) => {
        checkpointStoreCalls += 1
        return fixture.store.commit(input)
      },
      prepare: async (input) => {
        checkpointStoreCalls += 1
        return fixture.store.prepare(input)
      },
      readCommitted: async (input) => {
        checkpointStoreCalls += 1
        return fixture.store.readCommitted(input)
      }
    },
    calls
  )
  const target = {
    modelId: "provider/model-selected",
    operationId: "compact-scope-snapshot-1",
    threadId: fixture.threadId,
    trigger: "manual" as const,
    workspacePath: repoRoot
  }
  const changingScope = new Proxy(target, {
    getOwnPropertyDescriptor: (proxyTarget, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(proxyTarget, property)
      if (property !== "threadId" || !descriptor) return descriptor
      threadIdDescriptorReads += 1
      return {
        ...descriptor,
        value: threadIdDescriptorReads === 1 ? 42 : fixture.threadId
      }
    }
  })

  await assert.rejects(
    controller.compact(changingScope as unknown as Parameters<typeof controller.compact>[0]),
    /threadId must be an own string data property/
  )

  assert.equal(threadIdDescriptorReads, 1)
  assert.equal(checkpointStoreCalls, 0)
  assert.equal(calls.count, 0)
  assert.equal(await countCheckpoints(fixture.threadId), 1)
  assert.equal(await countCompactionCommits(fixture.threadId), 0)
})

test("manual compact rejects a checkpoint with pending HITL before summarization", async () => {
  const fixture = await createFixture("thread-compact-hitl", { pendingHitl: true })
  const prepared = await fixture.store.prepare({ threadId: fixture.threadId })
  assert.equal(prepared.status, "ready")
  const calls = { count: 0 }
  const controller = createController(fixture.store, calls)

  await assert.rejects(
    controller.compact({
      modelId: "provider/model-selected",
      operationId: "compact-hitl-1",
      threadId: fixture.threadId,
      trigger: "manual",
      workspacePath: repoRoot
    }),
    (error: unknown) => {
      assert.ok(error instanceof CompactBoundaryNotStable)
      assert.equal(error.checkpointId, fixture.checkpointId)
      assert.equal(error.reason, "pending-hitl")
      return true
    }
  )

  assert.equal(calls.count, 0)
  assert.equal(await countCheckpoints(fixture.threadId), 1)
})

test("retrying a compact operation after response loss returns its committed result", async () => {
  const fixture = await createFixture("thread-compact-retry")
  const calls = { count: 0 }
  let loseFirstCommittedResponse = true
  const responseLossStore: RuntimeCheckpointCompactionStore = {
    commit: async (input) => {
      const result = await fixture.store.commit(input)
      if (loseFirstCommittedResponse && result.status === "committed") {
        loseFirstCommittedResponse = false
        throw new Error("simulated compact response loss")
      }
      return result
    },
    prepare: (input) => fixture.store.prepare(input),
    readCommitted: (input) => fixture.store.readCommitted(input)
  }
  const controller = createController(responseLossStore, calls)
  const compactInput = {
    modelId: "provider/model-selected",
    operationId: "compact-retry-1",
    preserveLastUserMessageCount: Number.MAX_SAFE_INTEGER,
    reason: "response lost",
    threadId: fixture.threadId,
    trigger: "manual" as const,
    workspacePath: repoRoot
  }

  await assert.rejects(controller.compact(compactInput), /simulated compact response loss/)
  const committedCheckpoint = await fixture.saver.getTuple({
    configurable: { thread_id: fixture.threadId }
  })
  assert.ok(committedCheckpoint)
  const committedCheckpointId = committedCheckpoint.checkpoint.id
  const laterCheckpointId = await appendCheckpoint(fixture.saver, fixture.threadId)
  const recovered = await controller.compact(compactInput)

  assert.notEqual(laterCheckpointId, committedCheckpointId)
  assert.equal(recovered.checkpointConfig.configurable?.checkpoint_id, committedCheckpointId)
  assert.equal(recovered.compaction.compactionId, compactInput.operationId)
  assert.equal(recovered.messageCountBeforeCompaction, 2)
  assert.equal(recovered.messageCountAfterCompaction, 1)
  assert.equal(calls.count, 1)
  assert.equal(await countCheckpoints(fixture.threadId), 3)
  assert.equal(await countCompactionCommits(fixture.threadId), 1)
  const receipt = await fixture.saver.readCompactionCommit({
    operationId: compactInput.operationId,
    threadId: fixture.threadId
  })
  assert.ok(receipt)
  assert.equal(receipt.modelId, compactInput.modelId)
  assert.equal(receipt.preserveLastUserMessageCount, Number.MAX_SAFE_INTEGER)
  assert.equal(receipt.preserveLastUserMessageCountPresent, true)
  assert.equal(receipt.reason, compactInput.reason)
})

test("same compact operation ID rejects canonical request identity drift without side effects", async () => {
  const fixture = await createFixture("thread-compact-identity-drift")
  const calls = { count: 0 }
  const controller = createController(fixture.store, calls)
  const requestWithoutPreserve = {
    modelId: "provider/model-selected",
    operationId: "compact-identity-1",
    reason: "baseline",
    threadId: fixture.threadId,
    trigger: "manual" as const,
    workspacePath: repoRoot
  }
  const baseline = {
    ...requestWithoutPreserve,
    preserveLastUserMessageCount: undefined
  }

  const committed = await controller.compact(baseline)
  const exactRetry = await controller.compact({ ...baseline })
  assert.deepEqual(exactRetry, committed)
  const receipt = await fixture.saver.readCompactionCommit({
    operationId: baseline.operationId,
    threadId: fixture.threadId
  })
  assert.ok(receipt)
  assert.equal(receipt.preserveLastUserMessageCount, null)
  assert.equal(receipt.preserveLastUserMessageCountPresent, true)

  const driftedInputs = [
    { ...baseline, modelId: "provider/model-drifted" },
    { ...baseline, reason: "changed" },
    requestWithoutPreserve,
    { ...baseline, preserveLastUserMessageCount: 0 }
  ] as const

  for (const driftedInput of driftedInputs) {
    await assert.rejects(controller.compact(driftedInput), (error: unknown) => {
      assert.ok(error instanceof CompactOperationIdentityConflict)
      assert.equal(error.operationId, baseline.operationId)
      return true
    })
  }

  assert.equal(calls.count, 1)
  assert.equal(await countCheckpoints(fixture.threadId), 2)
  assert.equal(await countCompactionCommits(fixture.threadId), 1)
})

test("transaction already-committed path replays matching identity and rejects drift", async () => {
  const fixture = await createFixture("thread-compact-transaction-identity")
  const initialCalls = { count: 0 }
  const operationId = "compact-transaction-identity-1"
  const baseline = {
    modelId: "provider/model-selected",
    operationId,
    reason: "baseline",
    threadId: fixture.threadId,
    trigger: "manual" as const,
    workspacePath: repoRoot
  }
  const committed = await createController(fixture.store, initialCalls).compact(baseline)
  const raceStore: RuntimeCheckpointCompactionStore = {
    commit: (input) => fixture.store.commit(input),
    prepare: (input) => fixture.store.prepare(input),
    readCommitted: async () => null
  }
  const raceCalls = { count: 0 }
  const raceController = createController(raceStore, raceCalls)

  const replayed = await raceController.compact({ ...baseline })
  assert.deepEqual(replayed, committed)
  assert.equal(raceCalls.count, 1)
  assert.equal(await countCheckpoints(fixture.threadId), 2)
  assert.equal(await countCompactionCommits(fixture.threadId), 1)

  await assert.rejects(
    raceController.compact({ ...baseline, modelId: "provider/model-drifted" }),
    (error: unknown) => {
      assert.ok(error instanceof CompactOperationIdentityConflict)
      assert.equal(error.operationId, operationId)
      return true
    }
  )

  assert.equal(initialCalls.count, 1)
  assert.equal(raceCalls.count, 2)
  assert.equal(await countCheckpoints(fixture.threadId), 2)
  assert.equal(await countCompactionCommits(fixture.threadId), 1)
})

test("production manual compact keeps history in checkpoint facts without filesystem writes", async () => {
  const fixture = await createFixture("thread-compact-pure-summary")
  const workspacePath = await mkdtemp(join(tmpdir(), "jingle-compact-workspace-"))
  const calls = { count: 0 }
  try {
    const result = await createProductionController(fixture.store, calls).compact({
      modelId: "provider/model-selected",
      operationId: "compact-pure-summary-1",
      threadId: fixture.threadId,
      trigger: "manual",
      workspacePath
    })

    assert.equal(calls.count, 1)
    assert.equal(result.compaction.historyRef, null)
    assert.deepEqual(await readdir(workspacePath), [])
  } finally {
    await rm(workspacePath, { force: true, recursive: true })
  }
})

test("compact CAS conflict leaves the workspace unchanged", async () => {
  const fixture = await createFixture("thread-compact-pure-cas-conflict")
  const workspacePath = await mkdtemp(join(tmpdir(), "jingle-compact-workspace-"))
  const prepared = await fixture.store.prepare({ threadId: fixture.threadId })
  assert.equal(prepared.status, "ready")
  await appendCheckpoint(fixture.saver, fixture.threadId)
  const staleStore: RuntimeCheckpointCompactionStore = {
    commit: (input) => fixture.store.commit(input),
    prepare: async () => prepared,
    readCommitted: (input) => fixture.store.readCommitted(input)
  }
  const calls = { count: 0 }
  try {
    await assert.rejects(
      createProductionController(staleStore, calls).compact({
        modelId: "provider/model-selected",
        operationId: "compact-pure-cas-conflict-1",
        threadId: fixture.threadId,
        trigger: "manual",
        workspacePath
      }),
      CompactCheckpointConflict
    )

    assert.equal(calls.count, 1)
    assert.deepEqual(await readdir(workspacePath), [])
    assert.equal(await countCheckpoints(fixture.threadId), 2)
    assert.equal(await countCompactionCommits(fixture.threadId), 0)
  } finally {
    await rm(workspacePath, { force: true, recursive: true })
  }
})

test("compact database failure leaves the workspace and checkpoint unchanged", async () => {
  const fixture = await createFixture("thread-compact-pure-db-failure")
  const workspacePath = await mkdtemp(join(tmpdir(), "jingle-compact-workspace-"))
  const { getPrismaClient } = await loadDbModules()
  const prisma = getPrismaClient()
  const persistenceBefore = await readCompactPersistenceCounts(fixture.threadId)
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_runtime_compaction_commit
    BEFORE INSERT ON runtime_compaction_commits
    BEGIN
      SELECT RAISE(FAIL, 'injected compact commit failure');
    END
  `)
  const calls = { count: 0 }
  try {
    await assert.rejects(
      createProductionController(fixture.store, calls).compact({
        modelId: "provider/model-selected",
        operationId: "compact-pure-db-failure-1",
        threadId: fixture.threadId,
        trigger: "manual",
        workspacePath
      })
    )

    assert.equal(calls.count, 1)
    assert.deepEqual(await readdir(workspacePath), [])
    assert.equal(await countCheckpoints(fixture.threadId), 1)
    assert.equal(await countCompactionCommits(fixture.threadId), 0)
    assert.deepEqual(await readCompactPersistenceCounts(fixture.threadId), persistenceBefore)
  } finally {
    await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_runtime_compaction_commit")
    await rm(workspacePath, { force: true, recursive: true })
  }
})

test("compact ledger survives checkpoint retention and is deleted with its thread", async () => {
  const fixture = await createFixture("thread-compact-ledger-retention")
  const calls = { count: 0 }
  const controller = createController(fixture.store, calls)
  const compactInput = {
    modelId: "provider/model-selected",
    operationId: "compact-ledger-retention-1",
    threadId: fixture.threadId,
    trigger: "manual" as const,
    workspacePath: repoRoot
  }

  const committed = await controller.compact(compactInput)
  const committedCheckpointId = committed.checkpointConfig.configurable?.checkpoint_id
  assert.equal(await countCompactionCommits(fixture.threadId), 1)

  const { getPrismaClient } = await loadDbModules()
  await getPrismaClient().checkpoint.deleteMany({ where: { threadId: fixture.threadId } })
  assert.equal(await countCheckpoints(fixture.threadId), 0)

  const recovered = await controller.compact(compactInput)
  assert.equal(recovered.checkpointConfig.configurable?.checkpoint_id, committedCheckpointId)
  assert.equal(calls.count, 1)
  assert.equal(await countCompactionCommits(fixture.threadId), 1)

  await getPrismaClient().thread.delete({ where: { threadId: fixture.threadId } })
  assert.equal(await countCompactionCommits(fixture.threadId), 0)
})

test("different compact operation IDs conflict against the same checkpoint envelope", async () => {
  const fixture = await createFixture("thread-compact-conflict")
  const prepared = await fixture.store.prepare({ threadId: fixture.threadId })
  assert.equal(prepared.status, "ready")
  const staleStore: RuntimeCheckpointCompactionStore = {
    commit: (input) => fixture.store.commit(input),
    prepare: async () => prepared,
    readCommitted: (input) => fixture.store.readCommitted(input)
  }
  const calls = { count: 0 }
  const controller = createController(staleStore, calls)

  const committed = await controller.compact({
    modelId: "provider/model-selected",
    operationId: "compact-conflict-winner",
    threadId: fixture.threadId,
    trigger: "manual",
    workspacePath: repoRoot
  })
  await assert.rejects(
    controller.compact({
      modelId: "provider/model-selected",
      operationId: "compact-conflict-loser",
      threadId: fixture.threadId,
      trigger: "manual",
      workspacePath: repoRoot
    }),
    (error: unknown) => {
      assert.ok(error instanceof CompactCheckpointConflict)
      assert.equal(error.expectedCheckpointId, fixture.checkpointId)
      assert.equal(error.actualCheckpointId, committed.checkpointConfig.configurable?.checkpoint_id)
      return true
    }
  )

  assert.equal(calls.count, 2)
  assert.equal(await countCheckpoints(fixture.threadId), 2)
})

async function createFixture(
  threadId: string,
  input: { pendingHitl?: boolean } = {}
): Promise<{
  checkpointId: string
  opaqueVersionSeen: Record<string, string>
  saver: PrismaCheckpointSaver
  store: RuntimeCheckpointCompactionStore
  threadId: string
}> {
  const { createThread } = await loadDbModules()
  const { PrismaCheckpointSaver } = await import("../../src/main/checkpointer/prisma-saver")
  await createThread(threadId)

  const checkpoint = emptyCheckpoint()
  checkpoint.id = uuid6(-1)
  const version = uuid6(-2)
  checkpoint.channel_values = {
    compactions: [],
    messages: [
      new HumanMessage({ content: "first", id: `${threadId}-message-1` }),
      new HumanMessage({ content: "second", id: `${threadId}-message-2` })
    ],
    opaque: { coreFact: "preserve" },
    ...(input.pendingHitl
      ? {
          __interrupt__: [
            {
              value: {
                actionRequests: [{ name: "write_file", toolCallId: "tool-call-1" }]
              }
            }
          ]
        }
      : {})
  }
  checkpoint.channel_versions = Object.fromEntries(
    Object.keys(checkpoint.channel_values).map((channel) => [channel, version])
  )
  const opaqueVersionSeen = { opaque: version }
  checkpoint.versions_seen = { opaque_owner: opaqueVersionSeen }
  const metadata = {
    ownerMetadata: "preserve",
    parents: {},
    source: "loop",
    step: 3
  } as CheckpointMetadata
  const saver = new PrismaCheckpointSaver()
  await saver.put(
    { configurable: { thread_id: threadId } },
    checkpoint,
    metadata,
    checkpoint.channel_versions
  )

  return {
    checkpointId: checkpoint.id,
    opaqueVersionSeen,
    saver,
    store: createCheckpointCompactionStore({ getCheckpointer: async () => saver }),
    threadId
  }
}

function createController(
  store: RuntimeCheckpointCompactionStore,
  calls: { count: number; modelIds?: string[] }
): JingleCompactionController {
  return createJingleCompactionController({
    checkpointStore: store,
    summarization: (scope) => {
      calls.modelIds?.push(scope.modelId)
      return createSummarizationController(calls)
    }
  })
}

function createProductionController(
  store: RuntimeCheckpointCompactionStore,
  calls: { count: number }
): JingleCompactionController {
  return createJingleCompactionController({
    checkpointStore: store,
    summarization: () => {
      const controller = createRuntimeCompactionSummarizationController({
        model: new FakeToolCallingModel()
      })
      return {
        ...controller,
        compactMessages: async (input) => {
          calls.count += 1
          return controller.compactMessages(input)
        }
      }
    }
  })
}

function createSummarizationController(calls: { count: number }): JingleSummarizationController {
  return {
    compactMessages: async (input) => {
      calls.count += 1
      const summaryMessage = new HumanMessage({
        content: `summary-${calls.count}`,
        id: `summary-${calls.count}`
      })
      const event = {
        compactionCount: calls.count,
        cutoffIndex: input.messages.length - 1,
        filePath: null,
        preservedUserMessages: [],
        summaryMessage,
        warning: null
      }
      return {
        event,
        modelMessages: [summaryMessage],
        summaryMessage,
        update: {
          _summarizationEvent: event,
          _summarizationSessionId: `session-${calls.count}`,
          messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), summaryMessage]
        }
      }
    },
    observeContextOverflow: () => undefined,
    prepareModelCall: async () => {
      throw new Error("prepareModelCall was not expected during explicit compact.")
    }
  }
}

async function countCheckpoints(threadId: string): Promise<number> {
  const { getPrismaClient } = await loadDbModules()
  return getPrismaClient().checkpoint.count({ where: { threadId } })
}

async function appendCheckpoint(saver: PrismaCheckpointSaver, threadId: string): Promise<string> {
  const latest = await saver.getTuple({ configurable: { thread_id: threadId } })
  assert.ok(latest)
  const checkpoint = copyCheckpoint(latest.checkpoint)
  checkpoint.id = uuid6(-1)
  checkpoint.ts = new Date().toISOString()
  await saver.put(
    latest.config,
    checkpoint,
    {
      parents: {},
      source: "loop",
      step: 100
    },
    {}
  )
  return checkpoint.id
}

async function countCompactionCommits(threadId: string): Promise<number> {
  const { getPrismaClient } = await loadDbModules()
  const rows = await getPrismaClient().$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*) AS "count"
    FROM "runtime_compaction_commits"
    WHERE "thread_id" = ${threadId}
  `
  return Number(rows[0]?.count ?? 0)
}

async function readCompactPersistenceCounts(threadId: string): Promise<{
  checkpointBlobs: number
  messageEvents: number
  messageStateVersions: number
  messages: number
  messagesFts: number
  messagesFtsTrigram: number
}> {
  const { getPrismaClient } = await loadDbModules()
  const prisma = getPrismaClient()
  const [
    checkpointBlobs,
    messageEvents,
    messageStateVersions,
    messages,
    messagesFts,
    messagesFtsTrigram
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint | number }>>`
        SELECT COUNT(*) AS "count" FROM "checkpoint_blobs" WHERE "thread_id" = ${threadId}
      `,
    prisma.$queryRaw<Array<{ count: bigint | number }>>`
        SELECT COUNT(*) AS "count" FROM "message_events" WHERE "thread_id" = ${threadId}
      `,
    prisma.$queryRaw<Array<{ count: bigint | number }>>`
        SELECT COUNT(*) AS "count" FROM "message_state_versions" WHERE "thread_id" = ${threadId}
      `,
    prisma.$queryRaw<Array<{ count: bigint | number }>>`
        SELECT COUNT(*) AS "count" FROM "messages" WHERE "thread_id" = ${threadId}
      `,
    prisma.$queryRaw<Array<{ count: bigint | number }>>`
        SELECT COUNT(*) AS "count" FROM "messages_fts" WHERE "thread_id" = ${threadId}
      `,
    prisma.$queryRaw<Array<{ count: bigint | number }>>`
        SELECT COUNT(*) AS "count" FROM "messages_fts_trigram" WHERE "thread_id" = ${threadId}
      `
  ])
  return {
    checkpointBlobs: readCount(checkpointBlobs),
    messageEvents: readCount(messageEvents),
    messageStateVersions: readCount(messageStateVersions),
    messages: readCount(messages),
    messagesFts: readCount(messagesFts),
    messagesFtsTrigram: readCount(messagesFtsTrigram)
  }
}

function readCount(rows: Array<{ count: bigint | number }>): number {
  return Number(rows[0]?.count ?? 0)
}

function readMessages(value: unknown): BaseMessage[] {
  assert.ok(Array.isArray(value))
  return value as BaseMessage[]
}
