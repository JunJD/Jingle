import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import type { PreparedMessageStateItem } from "../../src/main/db/message-state"
import { ContentAnnotationsService } from "../../src/main/content-annotations/service"
import { readAssistantContentPartsProjection } from "../../src/main/db/assistant-content-parts"
import {
  enqueueAssistantContentProjection,
  flushAssistantContentProjection,
  startAssistantContentProjectionLifecycle
} from "../../src/main/content-cards/projection-queue"
import {
  ASSISTANT_CONTENT_PROJECTION_RECOVERY_BATCH_SIZE,
  claimAssistantContentProjection,
  completeAssistantContentProjection,
  ensureAssistantContentProjectionPending,
  failAssistantContentProjection,
  markAssistantContentProjectionDirty,
  readAssistantContentProjectionJob,
  recoverAssistantContentProjectionJobs
} from "../../src/main/db/assistant-content-projection-jobs"
import { ContentCardsService } from "../../src/main/content-cards/service"
import { ASSISTANT_CONTENT_PROJECTION_ERROR_MAX_LENGTH } from "../../src/main/content-cards/projection-error"
import { createContentCardId } from "../../src/shared/content-card"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

async function loadDb() {
  const db = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  return { ...db, getPrismaClient }
}

function assistantItem(rawHash: string, metadata: string | null): PreparedMessageStateItem {
  return {
    content: JSON.stringify("Text\n\n```diff\n-old\n+new\n```"),
    kind: "message",
    messageId: "assistant-message",
    metadata,
    name: null,
    order: 1,
    rawHash,
    rawMessageEncoding: "text",
    rawMessageType: "json",
    rawMessageValue: JSON.stringify({ content: "raw" }),
    role: "assistant",
    toolCallId: null,
    toolCalls: null
  }
}

async function waitFor<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read()
    if (matches(value)) return value
    await delay(20)
  }
  throw new Error("Timed out waiting for assistant content projection state.")
}

async function readDiagnosticEventCodes(): Promise<string[]> {
  const { diagnosticsGraph, diagnosticsLogger } =
    await import("../../src/main/diagnostics/instance")
  await diagnosticsGraph.flush()
  return readFileSync(diagnosticsLogger.getLogFilePath(), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { eventCode?: string }).eventCode)
    .filter((eventCode): eventCode is string => Boolean(eventCode))
}

test.before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-content-parts-"))
  process.env.JINGLE_HOME = jingleHome
  execFileSync("node", ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: { ...process.env, JINGLE_HOME: jingleHome }
  })
})

test.after(async () => {
  const { closeDatabase } = await loadDb()
  await closeDatabase()
  if (originalJingleHome === undefined) delete process.env.JINGLE_HOME
  else process.env.JINGLE_HOME = originalJingleHome
  await rm(jingleHome, { force: true, recursive: true })
})

test("terminal content-part facts survive message projection rebuild and database restart", async () => {
  const {
    closeDatabase,
    createRun,
    createThread,
    getPrismaClient,
    initializeDatabase,
    listProjectedThreadMessages,
    persistMessageStateVersion
  } = await loadDb()
  await initializeDatabase()
  await createThread("thread-content-parts")
  await createRun("run-content-parts", "thread-content-parts")

  await persistMessageStateVersion({
    checkpointId: "checkpoint-1",
    checkpointNs: "",
    messages: [assistantItem("raw-1", null)],
    runId: "run-content-parts",
    threadId: "thread-content-parts",
    version: "1"
  })
  assert.equal(
    await readAssistantContentPartsProjection({
      messageId: "assistant-message",
      threadId: "thread-content-parts"
    }),
    null
  )
  void enqueueAssistantContentProjection({
    runId: "run-content-parts"
  })
  await flushAssistantContentProjection()
  assert.equal(
    await readAssistantContentPartsProjection({
      messageId: "assistant-message",
      threadId: "thread-content-parts"
    }),
    null
  )
  await getPrismaClient().run.update({
    data: { status: "success" },
    where: { runId: "run-content-parts" }
  })
  void enqueueAssistantContentProjection({
    runId: "run-content-parts"
  })
  await flushAssistantContentProjection()
  const firstProjection = await readAssistantContentPartsProjection({
    messageId: "assistant-message",
    threadId: "thread-content-parts"
  })
  assert.ok(firstProjection)

  await persistMessageStateVersion({
    checkpointId: "checkpoint-2",
    checkpointNs: "",
    messages: [assistantItem("raw-2", JSON.stringify({ provider: "updated" }))],
    runId: "run-content-parts",
    threadId: "thread-content-parts",
    version: "2"
  })
  const { projectMessageStateThroughSeq } = await import("../../src/main/db/message-state")
  await getPrismaClient().message.deleteMany({ where: { threadId: "thread-content-parts" } })
  await projectMessageStateThroughSeq({
    checkpointNs: "",
    runId: "run-content-parts",
    sourceThreadId: "thread-content-parts",
    targetThreadId: "thread-content-parts",
    throughSeq: 2,
    updatedAt: BigInt(Date.now())
  })
  await closeDatabase()
  await initializeDatabase()

  const restartedRow = (await listProjectedThreadMessages("thread-content-parts"))[0]!
  const restartedProjection = await readAssistantContentPartsProjection({
    messageId: "assistant-message",
    threadId: "thread-content-parts"
  })
  assert.ok(restartedProjection)
  assert.equal(JSON.parse(restartedRow.metadata ?? "{}").provider, "updated")
  assert.deepEqual(
    restartedProjection.parts.map((part) => part.id),
    firstProjection.parts.map((part) => part.id)
  )
  assert.deepEqual(
    restartedProjection.parts.map((part) => part.payload),
    firstProjection.parts.map((part) => part.payload)
  )
  assert.equal(await getPrismaClient().message.count(), 1)
})

test("transient projection writes remain durable and retry without changing the terminal run", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  const prisma = getPrismaClient()
  await createThread("thread-content-projection-failure")
  await createRun("run-content-projection-failure", "thread-content-projection-failure", {
    status: "success"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-failure",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-failure", null), messageId: "assistant-message-failure" }],
    runId: "run-content-projection-failure",
    threadId: "thread-content-projection-failure",
    version: "1"
  })
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_assistant_content_projection_insert
    BEFORE INSERT ON assistant_content_projections
    WHEN NEW.message_id = 'assistant-message-failure'
    BEGIN
      SELECT RAISE(FAIL, 'forced projection write failure');
    END
  `)

  assert.equal(await markAssistantContentProjectionDirty("run-content-projection-failure"), true)
  await startAssistantContentProjectionLifecycle()
  const failedJob = await waitFor(
    () => readAssistantContentProjectionJob("run-content-projection-failure"),
    (job) => job?.status === "failed"
  )
  assert.equal(failedJob?.status, "failed")
  assert.equal(failedJob?.attemptCount, 1)
  assert.ok((failedJob?.lastError ?? "").length > 0)
  await delay(100)
  assert.equal(
    (await readAssistantContentProjectionJob("run-content-projection-failure"))?.attemptCount,
    1
  )
  assert.equal(
    (await prisma.run.findUnique({ where: { runId: "run-content-projection-failure" } }))?.status,
    "success"
  )

  await prisma.$executeRawUnsafe("DROP TRIGGER fail_assistant_content_projection_insert")
  await waitFor(
    () => readAssistantContentProjectionJob("run-content-projection-failure"),
    (job) => job?.status === "completed"
  )
  assert.ok(
    await readAssistantContentPartsProjection({
      messageId: "assistant-message-failure",
      threadId: "thread-content-projection-failure"
    })
  )
  assert.ok(
    (await readDiagnosticEventCodes()).includes("assistant_content_projection.execution_failed")
  )
  await flushAssistantContentProjection()
})

test("a dirty write during execution prevents an older generation from completing the job", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  await createThread("thread-content-projection-generation")
  await createRun("run-content-projection-generation", "thread-content-projection-generation", {
    status: "success"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-generation",
    checkpointNs: "",
    messages: [
      { ...assistantItem("raw-generation", null), messageId: "assistant-message-generation" }
    ],
    runId: "run-content-projection-generation",
    threadId: "thread-content-projection-generation",
    version: "1"
  })

  assert.equal(await markAssistantContentProjectionDirty("run-content-projection-generation"), true)
  const firstClaim = await claimAssistantContentProjection("run-content-projection-generation")
  assert.ok(firstClaim)
  assert.equal(await claimAssistantContentProjection("run-content-projection-generation"), null)
  assert.equal(await markAssistantContentProjectionDirty("run-content-projection-generation"), true)
  assert.equal(await completeAssistantContentProjection(firstClaim), false)
  const pending = await readAssistantContentProjectionJob("run-content-projection-generation")
  assert.equal(pending?.generation, firstClaim.generation + 1)
  assert.equal(pending?.status, "pending")

  const secondClaim = await claimAssistantContentProjection("run-content-projection-generation")
  assert.ok(secondClaim)
  assert.equal(await completeAssistantContentProjection(secondClaim), true)
  assert.equal((await getPrismaClient().run.count({ where: { status: "success" } })) > 0, true)
})

test("hydrate scheduling during execution preserves a newer projection wake-up", async () => {
  const { createRun, createThread, persistMessageStateVersion } = await loadDb()
  const runId = "run-content-projection-ensure-generation"
  const threadId = "thread-content-projection-ensure-generation"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "success" })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-ensure-generation",
    checkpointNs: "",
    messages: [
      { ...assistantItem("raw-ensure-generation", null), messageId: "assistant-ensure-generation" }
    ],
    runId,
    threadId,
    version: "1"
  })
  assert.equal(await markAssistantContentProjectionDirty(runId), true)
  const staleClaim = await claimAssistantContentProjection(runId)
  assert.ok(staleClaim)

  assert.equal(
    await ensureAssistantContentProjectionPending(runId, { allowBlockedRetry: false }),
    true
  )
  assert.equal(await completeAssistantContentProjection(staleClaim), false)
  const pending = await readAssistantContentProjectionJob(runId)
  assert.equal(pending?.generation, staleClaim.generation + 1)
  assert.equal(pending?.status, "pending")
  const currentClaim = await claimAssistantContentProjection(runId)
  assert.ok(currentClaim)
  assert.equal(await completeAssistantContentProjection(currentClaim), true)
})

test("recovery invalidates a live claim before accepting new dirtiness", async () => {
  const { createRun, createThread, persistMessageStateVersion } = await loadDb()
  await createThread("thread-content-projection-reclaim")
  await createRun("run-content-projection-reclaim", "thread-content-projection-reclaim", {
    status: "success"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-reclaim",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-reclaim", null), messageId: "assistant-message-reclaim" }],
    runId: "run-content-projection-reclaim",
    threadId: "thread-content-projection-reclaim",
    version: "1"
  })

  assert.equal(await markAssistantContentProjectionDirty("run-content-projection-reclaim"), true)
  const staleClaim = await claimAssistantContentProjection("run-content-projection-reclaim")
  assert.ok(staleClaim)

  const recoveredRunIds: string[] = []
  await recoverAssistantContentProjectionJobs({
    onBatch: (runIds) => {
      recoveredRunIds.push(...runIds)
    }
  })
  assert.ok(recoveredRunIds.includes(staleClaim.runId))
  assert.equal(await markAssistantContentProjectionDirty(staleClaim.runId), true)
  assert.equal(await completeAssistantContentProjection(staleClaim), false)

  const pending = await readAssistantContentProjectionJob(staleClaim.runId)
  assert.equal(pending?.generation, staleClaim.generation + 1)
  assert.equal(pending?.status, "pending")
  const currentClaim = await claimAssistantContentProjection(staleClaim.runId)
  assert.ok(currentClaim)
  assert.equal(await completeAssistantContentProjection(currentClaim), true)
})

test("projection failure summaries are bounded and redact secrets and local paths", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  await createThread("thread-content-projection-redaction")
  await createRun("run-content-projection-redaction", "thread-content-projection-redaction", {
    status: "success"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-redaction",
    checkpointNs: "",
    messages: [
      { ...assistantItem("raw-redaction", null), messageId: "assistant-message-redaction" }
    ],
    runId: "run-content-projection-redaction",
    threadId: "thread-content-projection-redaction",
    version: "1"
  })

  assert.equal(await markAssistantContentProjectionDirty("run-content-projection-redaction"), true)
  const claim = await claimAssistantContentProjection("run-content-projection-redaction")
  assert.ok(claim)
  await failAssistantContentProjection(
    claim,
    new Error(`token=very-secret /Users/example/private.txt ${"x".repeat(2_000)}`)
  )
  const failed = await readAssistantContentProjectionJob("run-content-projection-redaction")
  const failureSummary = failed?.lastError ?? ""
  assert.equal(failed?.status, "failed")
  assert.ok(failureSummary.length <= ASSISTANT_CONTENT_PROJECTION_ERROR_MAX_LENGTH)
  assert.doesNotMatch(failureSummary, /very-secret|\/Users\/example/)
  assert.match(failureSummary, /REDACTED/)
  await getPrismaClient().assistantContentProjectionJob.delete({
    where: { runId: "run-content-projection-redaction" }
  })
})

test("cancelled runs remain eligible for terminal assistant content projection", async () => {
  const { createRun, createThread, persistMessageStateVersion } = await loadDb()
  const { createRuntimeRunLifecycleController } =
    await import("../../src/main/agent/run-lifecycle-controller")
  await createThread("thread-content-projection-cancelled")
  await createRun("run-content-projection-cancelled", "thread-content-projection-cancelled", {
    status: "cancelled"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-cancelled",
    checkpointNs: "",
    messages: [
      { ...assistantItem("raw-cancelled", null), messageId: "assistant-message-cancelled" }
    ],
    runId: "run-content-projection-cancelled",
    threadId: "thread-content-projection-cancelled",
    version: "1"
  })

  await createRuntimeRunLifecycleController({}).recordRunFinished({
    completionReason: "user_declined",
    runId: "run-content-projection-cancelled",
    status: "cancelled",
    threadId: "thread-content-projection-cancelled"
  })
  await flushAssistantContentProjection()

  assert.ok(
    await readAssistantContentPartsProjection({
      messageId: "assistant-message-cancelled",
      threadId: "thread-content-projection-cancelled"
    })
  )
})

test("atomic run failure schedules assistant content projection after its terminal commit", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  const { createRuntimeRunLifecycleController } =
    await import("../../src/main/agent/run-lifecycle-controller")
  await createThread("thread-content-projection-error-terminal")
  await createRun(
    "run-content-projection-error-terminal",
    "thread-content-projection-error-terminal",
    { status: "running" }
  )
  await persistMessageStateVersion({
    checkpointId: "checkpoint-error-terminal",
    checkpointNs: "",
    messages: [
      {
        ...assistantItem("raw-error-terminal", null),
        messageId: "assistant-message-error-terminal"
      }
    ],
    runId: "run-content-projection-error-terminal",
    threadId: "thread-content-projection-error-terminal",
    version: "1"
  })

  await createRuntimeRunLifecycleController({}).markRunFailed({
    error: new Error("terminal failure"),
    runId: "run-content-projection-error-terminal",
    threadId: "thread-content-projection-error-terminal"
  })
  await flushAssistantContentProjection()

  assert.equal(
    (
      await getPrismaClient().run.findUniqueOrThrow({
        where: { runId: "run-content-projection-error-terminal" }
      })
    ).status,
    "error"
  )
  assert.ok(
    await readAssistantContentPartsProjection({
      messageId: "assistant-message-error-terminal",
      threadId: "thread-content-projection-error-terminal"
    })
  )
})

test("startup recovery backfills a missing terminal projection job", async () => {
  const { createRun, createThread, persistMessageStateVersion } = await loadDb()
  await createThread("thread-content-projection-recovery")
  await createRun("run-content-projection-recovery", "thread-content-projection-recovery", {
    status: "success"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-recovery",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-recovery", null), messageId: "assistant-message-recovery" }],
    runId: "run-content-projection-recovery",
    threadId: "thread-content-projection-recovery",
    version: "1"
  })
  assert.equal(await readAssistantContentProjectionJob("run-content-projection-recovery"), null)

  await startAssistantContentProjectionLifecycle()
  await flushAssistantContentProjection()

  assert.equal(
    (await readAssistantContentProjectionJob("run-content-projection-recovery"))?.status,
    "completed"
  )
  assert.ok(
    await readAssistantContentPartsProjection({
      messageId: "assistant-message-recovery",
      threadId: "thread-content-projection-recovery"
    })
  )
})

test("projection recovery failure does not reject database readiness and remains retryable", async () => {
  const {
    closeDatabase,
    createRun,
    createThread,
    getPrismaClient,
    initializeDatabase,
    persistMessageStateVersion
  } = await loadDb()
  const threadId = "thread-content-projection-recovery-failure"
  const runId = "run-content-projection-recovery-failure"
  const messageId = "assistant-message-recovery-failure"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "success" })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-recovery-failure",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-recovery-failure", null), messageId }],
    runId,
    threadId,
    version: "1"
  })

  await closeDatabase()
  await initializeDatabase()
  const prisma = getPrismaClient()
  await prisma.$executeRawUnsafe("PRAGMA query_only = ON")
  try {
    await startAssistantContentProjectionLifecycle()
  } finally {
    await prisma.$executeRawUnsafe("PRAGMA query_only = OFF")
  }
  assert.ok(
    (await readDiagnosticEventCodes()).includes("assistant_content_projection.recovery_failed")
  )

  await waitFor(
    () => readAssistantContentPartsProjection({ messageId, threadId }),
    (projection) => projection !== null
  )
  await flushAssistantContentProjection()
  assert.equal((await prisma.run.findUniqueOrThrow({ where: { runId } })).status, "success")
})

test("startup recovery compares canonical revisions even when finalizedAt is newer", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  const prisma = getPrismaClient()
  await createThread("thread-content-projection-stale")
  await createRun("run-content-projection-stale", "thread-content-projection-stale", {
    status: "success"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-stale",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-stale", null), messageId: "assistant-message-stale" }],
    runId: "run-content-projection-stale",
    threadId: "thread-content-projection-stale",
    version: "1"
  })
  const message = await prisma.message.findUniqueOrThrow({
    where: {
      threadId_messageId: {
        messageId: "assistant-message-stale",
        threadId: "thread-content-projection-stale"
      }
    }
  })
  await prisma.assistantContentProjection.create({
    data: {
      contentRevision: `sha256:${"0".repeat(64)}`,
      finalizedAt: message.updatedAt + 86_400_000n,
      messageId: message.messageId,
      threadId: message.threadId
    }
  })

  await startAssistantContentProjectionLifecycle()
  await flushAssistantContentProjection()

  const projection = await readAssistantContentPartsProjection({
    messageId: message.messageId,
    threadId: message.threadId
  })
  assert.ok(projection)
  assert.notEqual(projection.contentRevision, `sha256:${"0".repeat(64)}`)
})

test("shutdown aborts recovery after the current bounded dispatch batch", async () => {
  const { createThread, getPrismaClient } = await loadDb()
  const prisma = getPrismaClient()
  const threadId = "thread-content-projection-bounded-recovery"
  const runIds = Array.from(
    { length: ASSISTANT_CONTENT_PROJECTION_RECOVERY_BATCH_SIZE + 1 },
    (_, index) => `run-content-projection-bounded-recovery-${String(index).padStart(3, "0")}`
  )
  const timestamp = BigInt(Date.now())
  await createThread(threadId)
  await prisma.run.createMany({
    data: runIds.map((runId) => ({
      createdAt: timestamp,
      runId,
      status: "success",
      threadId,
      updatedAt: timestamp
    }))
  })
  await prisma.message.createMany({
    data: runIds.map((runId, index) => ({
      content: JSON.stringify(`Bounded recovery ${index}`),
      createdAt: timestamp,
      kind: "message",
      messageId: `assistant-message-bounded-recovery-${String(index).padStart(3, "0")}`,
      rawHash: `raw-bounded-recovery-${index}`,
      rawMessage: JSON.stringify({ encoding: "text", type: "json", value: "raw" }),
      role: "assistant",
      runId,
      searchText: `Bounded recovery ${index}`,
      seq: index + 1,
      threadId,
      updatedAt: timestamp
    }))
  })

  const recoveryTask = startAssistantContentProjectionLifecycle()
  await waitFor(
    () =>
      readAssistantContentPartsProjection({
        messageId: "assistant-message-bounded-recovery-000",
        threadId
      }),
    (projection) => projection !== null
  )
  await flushAssistantContentProjection()
  await recoveryTask

  const completedAfterShutdown = await prisma.assistantContentProjectionJob.count({
    where: { runId: { in: runIds }, status: "completed" }
  })
  const pendingAfterShutdown = await prisma.assistantContentProjectionJob.count({
    where: { runId: { in: runIds }, status: "pending" }
  })
  assert.ok(completedAfterShutdown > 0)
  assert.ok(pendingAfterShutdown > 0)
  assert.equal(completedAfterShutdown + pendingAfterShutdown, runIds.length)

  const { closeDatabase, initializeDatabase } = await loadDb()
  await closeDatabase()
  await initializeDatabase()
  await startAssistantContentProjectionLifecycle()
  await flushAssistantContentProjection()
  assert.equal(
    await getPrismaClient().assistantContentProjectionJob.count({
      where: { runId: { in: runIds }, status: "completed" }
    }),
    runIds.length
  )

  const completedJob = await getPrismaClient().assistantContentProjectionJob.findUniqueOrThrow({
    where: { runId: runIds[0]! }
  })
  const part = await getPrismaClient().assistantContentPart.findFirstOrThrow({
    where: { messageId: "assistant-message-bounded-recovery-000", threadId }
  })
  await getPrismaClient().assistantContentPart.update({
    data: { payloadJson: "{" },
    where: { partId: part.partId }
  })
  await closeDatabase()
  await initializeDatabase()
  await startAssistantContentProjectionLifecycle()
  await flushAssistantContentProjection()

  const unchangedCompletedJob =
    await getPrismaClient().assistantContentProjectionJob.findUniqueOrThrow({
      where: { runId: runIds[0]! }
    })
  assert.equal(unchangedCompletedJob.status, "completed")
  assert.equal(unchangedCompletedJob.attemptCount, completedJob.attemptCount)
  await assert.rejects(
    readAssistantContentPartsProjection({
      messageId: "assistant-message-bounded-recovery-000",
      threadId
    })
  )

  const service = new ContentCardsService()
  assert.deepEqual(
    await service.getAssistantParts({
      messageId: "assistant-message-bounded-recovery-000",
      threadId
    }),
    { status: "pending-stream" }
  )
  await flushAssistantContentProjection()
  assert.equal(
    (
      await getPrismaClient().assistantContentProjectionJob.findUniqueOrThrow({
        where: { runId: runIds[0]! }
      })
    ).attemptCount,
    completedJob.attemptCount + 1
  )
  await getPrismaClient().thread.delete({ where: { threadId } })
})

test("a malformed assistant message blocks once while valid siblings remain repairable", async () => {
  const {
    closeDatabase,
    createRun,
    createThread,
    getPrismaClient,
    initializeDatabase,
    persistMessageStateVersion
  } = await loadDb()
  await createThread("thread-content-projection-core-boundary")
  await createRun(
    "run-content-projection-core-boundary",
    "thread-content-projection-core-boundary",
    { status: "success" }
  )
  await persistMessageStateVersion({
    checkpointId: "checkpoint-core-boundary",
    checkpointNs: "",
    messages: [
      {
        ...assistantItem("raw-core-boundary-bad", null),
        messageId: "assistant-message-core-boundary-bad"
      },
      {
        ...assistantItem("raw-core-boundary-good", null),
        content: JSON.stringify("Valid sibling content"),
        messageId: "assistant-message-core-boundary-good",
        order: 2
      }
    ],
    runId: "run-content-projection-core-boundary",
    threadId: "thread-content-projection-core-boundary",
    version: "1"
  })
  await getPrismaClient().message.update({
    data: { content: "{" },
    where: {
      threadId_messageId: {
        messageId: "assistant-message-core-boundary-bad",
        threadId: "thread-content-projection-core-boundary"
      }
    }
  })

  await closeDatabase()
  await initializeDatabase()
  const prisma = getPrismaClient()
  await startAssistantContentProjectionLifecycle()
  const blockedJob = await waitFor(
    () => readAssistantContentProjectionJob("run-content-projection-core-boundary"),
    (job) => job?.status === "blocked"
  )
  assert.equal(blockedJob?.attemptCount, 1)
  assert.match(blockedJob?.lastError ?? "", /invalid-json/)
  const blockedInput = await prisma.assistantContentProjectionBlockedInput.findUniqueOrThrow({
    where: {
      runId_messageId: {
        messageId: "assistant-message-core-boundary-bad",
        runId: "run-content-projection-core-boundary"
      }
    }
  })
  assert.match(blockedInput.sourceRevision, /^sha256:[a-f0-9]{64}$/)
  assert.equal(
    await readAssistantContentPartsProjection({
      messageId: "assistant-message-core-boundary-bad",
      threadId: "thread-content-projection-core-boundary"
    }),
    null
  )
  assert.ok(
    await readAssistantContentPartsProjection({
      messageId: "assistant-message-core-boundary-good",
      threadId: "thread-content-projection-core-boundary"
    })
  )

  const blockedEventCount = (await readDiagnosticEventCodes()).filter(
    (eventCode) => eventCode === "assistant_content_projection.input_blocked"
  ).length
  await delay(1_100)
  assert.equal(
    (await readAssistantContentProjectionJob("run-content-projection-core-boundary"))?.attemptCount,
    1
  )

  await prisma.assistantContentProjection.delete({
    where: {
      threadId_messageId: {
        messageId: "assistant-message-core-boundary-good",
        threadId: "thread-content-projection-core-boundary"
      }
    }
  })
  await flushAssistantContentProjection()
  await closeDatabase()
  await initializeDatabase()
  await startAssistantContentProjectionLifecycle()
  await flushAssistantContentProjection()

  const repairedSiblingJob = await readAssistantContentProjectionJob(
    "run-content-projection-core-boundary"
  )
  assert.equal(repairedSiblingJob?.status, "blocked")
  assert.equal(repairedSiblingJob?.attemptCount, 2)
  assert.equal(
    (
      await getPrismaClient().assistantContentProjectionBlockedInput.findUniqueOrThrow({
        where: {
          runId_messageId: {
            messageId: "assistant-message-core-boundary-bad",
            runId: "run-content-projection-core-boundary"
          }
        }
      })
    ).sourceRevision,
    blockedInput.sourceRevision
  )
  assert.ok(
    await readAssistantContentPartsProjection({
      messageId: "assistant-message-core-boundary-good",
      threadId: "thread-content-projection-core-boundary"
    })
  )
  assert.equal(
    (
      await getPrismaClient().run.findUniqueOrThrow({
        where: { runId: "run-content-projection-core-boundary" }
      })
    ).status,
    "success"
  )

  await closeDatabase()
  await initializeDatabase()
  await startAssistantContentProjectionLifecycle()
  await flushAssistantContentProjection()
  assert.equal(
    (await readAssistantContentProjectionJob("run-content-projection-core-boundary"))?.attemptCount,
    2
  )
  assert.equal(
    (await readDiagnosticEventCodes()).filter(
      (eventCode) => eventCode === "assistant_content_projection.input_blocked"
    ).length,
    blockedEventCount + 1
  )

  await getPrismaClient().message.update({
    data: { content: JSON.stringify("Recovered assistant content") },
    where: {
      threadId_messageId: {
        messageId: "assistant-message-core-boundary-bad",
        threadId: "thread-content-projection-core-boundary"
      }
    }
  })
  await closeDatabase()
  await initializeDatabase()
  await startAssistantContentProjectionLifecycle()
  await flushAssistantContentProjection()
  assert.equal(
    (await readAssistantContentProjectionJob("run-content-projection-core-boundary"))?.status,
    "completed"
  )
  assert.ok(
    await readAssistantContentPartsProjection({
      messageId: "assistant-message-core-boundary-bad",
      threadId: "thread-content-projection-core-boundary"
    })
  )
})

test("malformed input stays hidden without replacing durable card or annotation identity", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  const threadId = "thread-content-projection-annotation-identity"
  const runId = "run-content-projection-annotation-identity"
  const messageId = "assistant-message-annotation-identity"
  const canonicalContent = JSON.stringify("Stable annotation content")
  await createThread(threadId)
  await createRun(runId, threadId, { status: "success" })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-annotation-identity",
    checkpointNs: "",
    messages: [
      {
        ...assistantItem("raw-annotation-identity", null),
        content: canonicalContent,
        messageId
      }
    ],
    runId,
    threadId,
    version: "1"
  })
  await enqueueAssistantContentProjection({ runId })
  await flushAssistantContentProjection()

  const initialProjection = await readAssistantContentPartsProjection({ messageId, threadId })
  assert.ok(initialProjection)
  const initialPart = initialProjection.parts[0]!
  assert.equal(initialPart.kind, "narrative")
  const source = {
    kind: initialPart.kind,
    slot: `part:${initialPart.id}`,
    sourceId: messageId,
    sourceType: "message" as const
  }
  const card = {
    ...source,
    cardId: createContentCardId(source),
    revision: initialPart.revision,
    threadId
  }
  const annotations = new ContentAnnotationsService()
  const annotation = await annotations.create({
    body: "Keep this anchor stable.",
    id: "annotation-content-projection-identity",
    intent: "comment",
    selection: {
      anchor: {
        blockId: card.slot,
        end: initialPart.payload.markdown.length,
        kind: "text-range",
        start: 0
      },
      anchorResolution: "resolved",
      card,
      contextHash: "sha256:annotation-identity",
      quote: initialPart.payload.markdown
    }
  })

  await getPrismaClient().message.update({
    data: { content: "{" },
    where: { threadId_messageId: { messageId, threadId } }
  })
  await enqueueAssistantContentProjection({ runId })
  await flushAssistantContentProjection()
  assert.equal((await readAssistantContentProjectionJob(runId))?.status, "blocked")
  assert.deepEqual(await new ContentCardsService().getAssistantParts({ messageId, threadId }), {
    status: "pending-stream"
  })
  assert.deepEqual(
    (await readAssistantContentPartsProjection({ messageId, threadId }))?.parts.map(
      (part) => part.id
    ),
    initialProjection.parts.map((part) => part.id)
  )

  await getPrismaClient().message.update({
    data: { content: canonicalContent },
    where: { threadId_messageId: { messageId, threadId } }
  })
  assert.equal(
    (await new ContentCardsService().getAssistantParts({ messageId, threadId })).status,
    "ready"
  )
  await flushAssistantContentProjection()

  const repairedProjection = await readAssistantContentPartsProjection({ messageId, threadId })
  assert.ok(repairedProjection)
  assert.deepEqual(
    repairedProjection.parts.map((part) => part.id),
    initialProjection.parts.map((part) => part.id)
  )
  const persistedAnnotation = await annotations.get(annotation.id)
  assert.equal(persistedAnnotation.cardId, annotation.cardId)
  assert.equal(persistedAnnotation.cardRevision, annotation.cardRevision)
  assert.equal(persistedAnnotation.anchorResolution, "resolved")
  assert.equal((await readAssistantContentProjectionJob(runId))?.status, "completed")
})

test("derived corruption rebuilds one part while preserving uncorrupted card identity", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  const threadId = "thread-content-projection-corrupt-part"
  const runId = "run-content-projection-corrupt-part"
  const messageId = "assistant-message-corrupt-part"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "success" })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-corrupt-part",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-corrupt-part", null), messageId }],
    runId,
    threadId,
    version: "1"
  })
  await enqueueAssistantContentProjection({ runId })
  await flushAssistantContentProjection()

  const initialProjection = await readAssistantContentPartsProjection({ messageId, threadId })
  assert.ok(initialProjection)
  const stablePart = initialProjection.parts.find((part) => part.kind === "narrative")
  const damagedPart = initialProjection.parts.find((part) => part.kind === "diff")
  assert.ok(stablePart)
  assert.ok(damagedPart)
  await getPrismaClient().assistantContentPart.update({
    data: { payloadJson: "{" },
    where: { partId: damagedPart.id }
  })

  assert.deepEqual(await new ContentCardsService().getAssistantParts({ messageId, threadId }), {
    status: "pending-stream"
  })
  await flushAssistantContentProjection()

  const firstRepair = await readAssistantContentPartsProjection({ messageId, threadId })
  assert.ok(firstRepair)
  assert.equal(firstRepair.parts.find((part) => part.kind === "narrative")?.id, stablePart.id)
  const repairedDiff = firstRepair.parts.find((part) => part.kind === "diff")
  assert.ok(repairedDiff)
  assert.notEqual(repairedDiff.id, damagedPart.id)

  await getPrismaClient().assistantContentPart.update({
    data: { payloadJson: "{" },
    where: { partId: repairedDiff.id }
  })
  assert.deepEqual(await new ContentCardsService().getAssistantParts({ messageId, threadId }), {
    status: "pending-stream"
  })
  await flushAssistantContentProjection()

  const hydrateRepair = await readAssistantContentPartsProjection({ messageId, threadId })
  assert.ok(hydrateRepair)
  assert.equal(hydrateRepair.parts.find((part) => part.kind === "narrative")?.id, stablePart.id)
  assert.ok(
    (await readDiagnosticEventCodes()).includes(
      "assistant_content_projection.derived_corruption_repaired"
    )
  )
})

test("derived corruption preserves the untouched ordinal across identical duplicate cards", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  for (const damagedOrdinal of [0, 1]) {
    const suffix = damagedOrdinal === 0 ? "first" : "second"
    const threadId = `thread-content-projection-duplicate-${suffix}`
    const runId = `run-content-projection-duplicate-${suffix}`
    const messageId = `assistant-message-duplicate-${suffix}`
    await createThread(threadId)
    await createRun(runId, threadId, { status: "success" })
    await persistMessageStateVersion({
      checkpointId: `checkpoint-duplicate-${suffix}`,
      checkpointNs: "",
      messages: [
        {
          ...assistantItem(`raw-duplicate-${suffix}`, null),
          content: JSON.stringify("```ts\nsame\n```\n\n```ts\nsame\n```"),
          messageId
        }
      ],
      runId,
      threadId,
      version: "1"
    })
    await enqueueAssistantContentProjection({ runId })
    await flushAssistantContentProjection()

    const initial = await readAssistantContentPartsProjection({ messageId, threadId })
    assert.ok(initial)
    assert.deepEqual(
      initial.parts.map((part) => part.kind),
      ["code", "code"]
    )
    const initialIds = initial.parts.map((part) => part.id)
    await getPrismaClient().assistantContentPart.update({
      data: { payloadJson: "{" },
      where: { partId: initial.parts[damagedOrdinal]!.id }
    })
    assert.deepEqual(await new ContentCardsService().getAssistantParts({ messageId, threadId }), {
      status: "pending-stream"
    })
    await flushAssistantContentProjection()

    const repaired = await readAssistantContentPartsProjection({ messageId, threadId })
    assert.ok(repaired)
    const untouchedOrdinal = damagedOrdinal === 0 ? 1 : 0
    assert.equal(repaired.parts[untouchedOrdinal]?.id, initialIds[untouchedOrdinal])
    assert.notEqual(repaired.parts[damagedOrdinal]?.id, initialIds[damagedOrdinal])
  }
})

test("content-card hydrate rejects a stale projection and schedules the canonical revision", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  const threadId = "thread-content-projection-stale-hydrate"
  const runId = "run-content-projection-stale-hydrate"
  const messageId = "assistant-message-stale-hydrate"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "success" })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-stale-hydrate",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-stale-hydrate", null), messageId }],
    runId,
    threadId,
    version: "1"
  })
  await enqueueAssistantContentProjection({ runId })
  await flushAssistantContentProjection()
  const initialProjection = await readAssistantContentPartsProjection({ messageId, threadId })
  assert.ok(initialProjection)

  await getPrismaClient().message.update({
    data: {
      content: JSON.stringify("Later canonical assistant content"),
      updatedAt: BigInt(Date.now())
    },
    where: { threadId_messageId: { messageId, threadId } }
  })
  const service = new ContentCardsService()
  assert.deepEqual(await service.getAssistantParts({ messageId, threadId }), {
    status: "pending-stream"
  })
  await flushAssistantContentProjection()

  const refreshed = await service.getAssistantParts({ messageId, threadId })
  assert.equal(refreshed.status, "ready")
  if (refreshed.status === "ready") {
    assert.notEqual(refreshed.projection.contentRevision, initialProjection.contentRevision)
  }
})

test("content-card hydrate schedules a missing terminal projection", async () => {
  const { createRun, createThread, persistMessageStateVersion } = await loadDb()
  await createThread("thread-content-projection-hydrate")
  await createRun("run-content-projection-hydrate", "thread-content-projection-hydrate", {
    status: "success"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-hydrate",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-hydrate", null), messageId: "assistant-message-hydrate" }],
    runId: "run-content-projection-hydrate",
    threadId: "thread-content-projection-hydrate",
    version: "1"
  })
  const service = new ContentCardsService()
  assert.deepEqual(
    await service.getAssistantParts({
      messageId: "assistant-message-hydrate",
      threadId: "thread-content-projection-hydrate"
    }),
    { status: "pending-stream" }
  )

  await flushAssistantContentProjection()

  const completedBeforeReadyRead = await readAssistantContentProjectionJob(
    "run-content-projection-hydrate"
  )
  assert.equal(
    (
      await service.getAssistantParts({
        messageId: "assistant-message-hydrate",
        threadId: "thread-content-projection-hydrate"
      })
    ).status,
    "ready"
  )
  await delay(20)
  const completedAfterReadyRead = await readAssistantContentProjectionJob(
    "run-content-projection-hydrate"
  )
  assert.deepEqual(
    completedAfterReadyRead && {
      attemptCount: completedAfterReadyRead.attemptCount,
      generation: completedAfterReadyRead.generation,
      status: completedAfterReadyRead.status,
      updatedAt: completedAfterReadyRead.updatedAt
    },
    completedBeforeReadyRead && {
      attemptCount: completedBeforeReadyRead.attemptCount,
      generation: completedBeforeReadyRead.generation,
      status: completedBeforeReadyRead.status,
      updatedAt: completedBeforeReadyRead.updatedAt
    }
  )
})
