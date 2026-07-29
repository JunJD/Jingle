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
import {
  assistantContentRevision,
  readAssistantContentPartsProjection
} from "../../src/main/db/assistant-content-parts"
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
  recoverAssistantContentProjectionJobs,
  resumeAssistantContentProjectionForRepairedMessage
} from "../../src/main/db/assistant-content-projection-jobs"
import { ContentCardsService } from "../../src/main/content-cards/service"
import {
  ASSISTANT_CONTENT_PROJECTION_ERROR_FALLBACK,
  ASSISTANT_CONTENT_PROJECTION_MAX_ATTEMPTS,
  AssistantContentProjectionFailureError
} from "../../src/main/content-cards/projection-error"
import { assistantContentProjectionEvents } from "../../src/main/content-cards/events"
import { createContentCardId } from "../../src/shared/content-card"
import {
  ASSISTANT_CONTENT_PROJECTION_ERROR_MAX_LENGTH,
  assistantContentProjectionFingerprint,
  assistantContentPartsResultSchema
} from "../../src/shared/assistant-content-part"

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

async function overwriteCanonicalMessageContent(input: {
  content: string
  messageId: string
  threadId: string
  updateDerivedProjection?: boolean
}): Promise<void> {
  const { getPrismaClient } = await loadDb()
  await getPrismaClient().$transaction(async (transaction) => {
    const event = await transaction.messageEvent.findFirstOrThrow({
      orderBy: { seq: "desc" },
      where: {
        messageId: input.messageId,
        threadId: input.threadId,
        type: "message.upsert"
      }
    })
    const payload = JSON.parse(event.payload) as Record<string, unknown>
    payload.content = input.content
    await transaction.messageEvent.update({
      data: { payload: JSON.stringify(payload) },
      where: { eventId: event.eventId }
    })
    if (input.updateDerivedProjection !== false) {
      await transaction.message.update({
        data: { content: input.content },
        where: {
          threadId_messageId: { messageId: input.messageId, threadId: input.threadId }
        }
      })
    }
  })
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
  const { diagnosticsGraph } = await import("../../src/main/diagnostics/instance")
  const { closeDatabase } = await loadDb()
  await diagnosticsGraph.flush()
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
  const issueStatesAtDelivery: Array<Promise<string | null>> = []
  const issueEvents: Array<{ revision: string; status: string }> = []
  const stopIssueEvents = assistantContentProjectionEvents.onChanged((event) => {
    if (event.kind !== "issue" || event.runId !== "run-content-projection-failure") return
    issueEvents.push({ revision: event.revision, status: event.status })
    issueStatesAtDelivery.push(
      readAssistantContentProjectionJob(event.runId).then((job) => job?.status ?? null)
    )
  })
  await startAssistantContentProjectionLifecycle()
  const failedJob = await waitFor(
    () => readAssistantContentProjectionJob("run-content-projection-failure"),
    (job) => job?.status === "failed"
  )
  assert.equal(failedJob?.status, "failed")
  assert.equal(failedJob?.attemptCount, 1)
  assert.ok((failedJob?.lastError ?? "").length > 0)
  assert.deepEqual(issueEvents, [{ revision: "job:1:1", status: "failed" }])
  assert.deepEqual(await Promise.all(issueStatesAtDelivery), ["failed"])
  assert.deepEqual(
    await new ContentCardsService().getAssistantParts({
      messageId: "assistant-message-failure",
      threadId: "thread-content-projection-failure"
    }),
    {
      issue: {
        code: "retryable-failure",
        detail: failedJob!.lastError!,
        reason: "persistence-unavailable"
      },
      status: "failed"
    }
  )
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
  stopIssueEvents()
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

test("a committed projection change is published when a newer generation wins completion", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  const runId = "run-content-projection-generation-change"
  const threadId = "thread-content-projection-generation-change"
  const messageId = "assistant-message-generation-change"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "success" })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-generation-change",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-generation-change", null), messageId }],
    runId,
    threadId,
    version: "1"
  })

  await getPrismaClient().$executeRawUnsafe(`
    CREATE TRIGGER advance_projection_generation_after_commit
    AFTER INSERT ON assistant_content_projections
    WHEN NEW.message_id = 'assistant-message-generation-change'
    BEGIN
      UPDATE assistant_content_projection_jobs
      SET generation = generation + 1, status = 'pending', updated_at = updated_at + 1
      WHERE run_id = 'run-content-projection-generation-change' AND status = 'running';
    END
  `)
  const changes: Array<{ contentRevision: string; projectionFingerprint: string }> = []
  const projectionsAtDelivery: Array<ReturnType<typeof readAssistantContentPartsProjection>> = []
  const stopChanges = assistantContentProjectionEvents.onChanged((event) => {
    if (event.kind === "ready" && event.messageId === messageId && event.threadId === threadId) {
      changes.push({
        contentRevision: event.revision,
        projectionFingerprint: event.projectionFingerprint
      })
      projectionsAtDelivery.push(readAssistantContentPartsProjection({ messageId, threadId }))
    }
  })

  try {
    await enqueueAssistantContentProjection({ runId })
    await flushAssistantContentProjection()
  } finally {
    stopChanges()
    await getPrismaClient().$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS advance_projection_generation_after_commit"
    )
  }

  const projection = await readAssistantContentPartsProjection({ messageId, threadId })
  assert.ok(projection)
  assert.equal(projectionsAtDelivery.length, 1)
  const projectionAtDelivery = await projectionsAtDelivery[0]
  assert.ok(projectionAtDelivery)
  assert.equal(projectionAtDelivery.contentRevision, projection.contentRevision)
  assert.equal(
    assistantContentProjectionFingerprint(projectionAtDelivery),
    assistantContentProjectionFingerprint(projection)
  )
  const job = await readAssistantContentProjectionJob(runId)
  assert.equal(job?.generation, 2)
  assert.equal(job?.status, "completed")
  assert.deepEqual(changes, [
    {
      contentRevision: projection.contentRevision,
      projectionFingerprint: assistantContentProjectionFingerprint(projection)
    }
  ])
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

  const interrupted = await readAssistantContentProjectionJob(staleClaim.runId)
  assert.equal(interrupted?.attemptCount, staleClaim.attemptCount)
  assert.equal(interrupted?.failureCode, "execution-interrupted")
  assert.equal(interrupted?.generation, staleClaim.generation + 1)
  assert.equal(interrupted?.status, "failed")
  const currentClaim = await claimAssistantContentProjection(staleClaim.runId)
  assert.ok(currentClaim)
  assert.equal(await completeAssistantContentProjection(currentClaim), true)
})

test("unknown projection failures park terminally with bounded redacted diagnostics", async () => {
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
  assert.equal(failed?.failureCode, "unexpected")
  assert.equal(failed?.nextAttemptAt, null)
  assert.equal(failed?.status, "parked")
  assert.ok(failureSummary.length <= ASSISTANT_CONTENT_PROJECTION_ERROR_MAX_LENGTH)
  assert.doesNotMatch(failureSummary, /very-secret|\/Users\/example/)
  assert.match(failureSummary, /REDACTED/)
  const serviceResult = assistantContentPartsResultSchema.parse(
    await new ContentCardsService().getAssistantParts({
      messageId: "assistant-message-redaction",
      threadId: "thread-content-projection-redaction"
    })
  )
  assert.equal(serviceResult.status, "parked")
  if (serviceResult.status === "parked") {
    assert.equal(serviceResult.issue.detail, failureSummary)
    assert.doesNotMatch(serviceResult.issue.detail, /very-secret|\/Users\/example/)
    assert.match(serviceResult.issue.detail, /REDACTED/)
  }
  await getPrismaClient().assistantContentProjectionJob.delete({
    where: { runId: "run-content-projection-redaction" }
  })
})

test("empty projection errors persist a typed non-empty service fallback", async () => {
  const { createRun, createThread, persistMessageStateVersion } = await loadDb()
  const threadId = "thread-content-projection-empty-error"
  const runId = "run-content-projection-empty-error"
  const messageId = "assistant-message-empty-error"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "success" })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-empty-error",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-empty-error", null), messageId }],
    runId,
    threadId,
    version: "1"
  })

  assert.equal(await markAssistantContentProjectionDirty(runId), true)
  const claim = await claimAssistantContentProjection(runId)
  assert.ok(claim)
  await failAssistantContentProjection(claim, new Error(""))
  assert.equal(
    (await readAssistantContentProjectionJob(runId))?.lastError,
    ASSISTANT_CONTENT_PROJECTION_ERROR_FALLBACK
  )
  assert.deepEqual(
    assistantContentPartsResultSchema.parse(
      await new ContentCardsService().getAssistantParts({ messageId, threadId })
    ),
    {
      issue: {
        code: "terminal-failure",
        detail: ASSISTANT_CONTENT_PROJECTION_ERROR_FALLBACK,
        reason: "unexpected"
      },
      status: "parked"
    }
  )
})

test("retryable projection failures exhaust the durable attempt budget without restart reset", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  const runId = "run-content-projection-retry-budget"
  const threadId = "thread-content-projection-retry-budget"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "success" })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-retry-budget",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-retry-budget", null), messageId: "assistant-retry-budget" }],
    runId,
    threadId,
    version: "1"
  })
  assert.equal(await markAssistantContentProjectionDirty(runId), true)

  for (let attempt = 1; attempt <= ASSISTANT_CONTENT_PROJECTION_MAX_ATTEMPTS; attempt += 1) {
    const claim = await claimAssistantContentProjection(runId)
    assert.ok(claim)
    assert.equal(claim.attemptCount, attempt)
    const settlement = await failAssistantContentProjection(
      claim,
      new AssistantContentProjectionFailureError(
        { code: "persistence-unavailable", kind: "retryable" },
        new Error("temporary projection store failure")
      )
    )
    assert.ok(settlement)
    assert.equal(
      settlement.status,
      attempt === ASSISTANT_CONTENT_PROJECTION_MAX_ATTEMPTS ? "exhausted" : "failed"
    )
    if (attempt < ASSISTANT_CONTENT_PROJECTION_MAX_ATTEMPTS) {
      assert.ok(settlement.nextAttemptAt)
      await getPrismaClient().assistantContentProjectionJob.update({
        data: { nextAttemptAt: 0n },
        where: { runId }
      })
    }
  }

  const exhausted = await readAssistantContentProjectionJob(runId)
  assert.equal(exhausted?.attemptCount, ASSISTANT_CONTENT_PROJECTION_MAX_ATTEMPTS)
  assert.equal(exhausted?.failureCode, "persistence-unavailable")
  assert.equal(exhausted?.nextAttemptAt, null)
  assert.equal(exhausted?.status, "exhausted")
  assert.deepEqual(
    await new ContentCardsService().getAssistantParts({
      messageId: "assistant-retry-budget",
      threadId
    }),
    {
      issue: {
        code: "retry-exhausted",
        detail: "temporary projection store failure",
        reason: "persistence-unavailable"
      },
      status: "exhausted"
    }
  )

  const recovered: string[] = []
  await recoverAssistantContentProjectionJobs({
    onBatch: (runIds) => {
      recovered.push(...runIds)
    }
  })
  assert.equal(recovered.includes(runId), false)
  assert.equal((await readAssistantContentProjectionJob(runId))?.status, "exhausted")
  assert.equal(
    (await readAssistantContentProjectionJob(runId))?.attemptCount,
    ASSISTANT_CONTENT_PROJECTION_MAX_ATTEMPTS
  )
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

  await createRuntimeRunLifecycleController({
    computerUseRuntime: { closeRun: async () => undefined } as never
  }).recordRunFinished({
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

  await createRuntimeRunLifecycleController({
    computerUseRuntime: { closeRun: async () => undefined } as never
  }).markRunFailed({
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
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
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
  await getPrismaClient().message.deleteMany({
    where: { threadId: "thread-content-projection-recovery" }
  })
  assert.equal(
    await getPrismaClient().message.count({
      where: { threadId: "thread-content-projection-recovery" }
    }),
    0
  )

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

test("dirty scheduling and finalization survive a missing message-search projection", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  const threadId = "thread-content-projection-canonical-dirty"
  const runId = "run-content-projection-canonical-dirty"
  const messageId = "assistant-message-canonical-dirty"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "success" })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-canonical-dirty",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-canonical-dirty", null), messageId }],
    runId,
    threadId,
    version: "1"
  })
  await getPrismaClient().message.deleteMany({ where: { threadId } })

  assert.equal(await markAssistantContentProjectionDirty(runId), true)
  void enqueueAssistantContentProjection({ runId })
  await flushAssistantContentProjection()

  assert.equal((await readAssistantContentProjectionJob(runId))?.status, "completed")
  assert.ok(await readAssistantContentPartsProjection({ messageId, threadId }))
  assert.equal(await getPrismaClient().message.count({ where: { threadId } }), 0)
})

test("canonical revisions settle while the message-search projection remains stale", async () => {
  const {
    closeDatabase,
    createRun,
    createThread,
    getPrismaClient,
    initializeDatabase,
    persistMessageStateVersion
  } = await loadDb()
  const threadId = "thread-content-projection-canonical-revision"
  const runId = "run-content-projection-canonical-revision"
  const messageId = "assistant-message-canonical-revision"
  const initialContent = JSON.stringify("Initial canonical assistant content")
  const updatedContent = JSON.stringify("Updated canonical assistant content")
  await createThread(threadId)
  await createRun(runId, threadId, { status: "success" })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-canonical-revision-initial",
    checkpointNs: "",
    messages: [
      {
        ...assistantItem("raw-canonical-revision-initial", null),
        content: initialContent,
        messageId
      }
    ],
    runId,
    threadId,
    version: "1"
  })
  void enqueueAssistantContentProjection({ runId })
  await flushAssistantContentProjection()

  await persistMessageStateVersion({
    checkpointId: "checkpoint-canonical-revision-updated",
    checkpointNs: "",
    messages: [
      {
        ...assistantItem("raw-canonical-revision-updated", null),
        content: updatedContent,
        messageId
      }
    ],
    runId,
    threadId,
    version: "2"
  })
  await getPrismaClient().message.update({
    data: { content: initialContent },
    where: { threadId_messageId: { messageId, threadId } }
  })

  assert.equal(await markAssistantContentProjectionDirty(runId), true)
  void enqueueAssistantContentProjection({ runId })
  await flushAssistantContentProjection()
  assert.equal(
    (await readAssistantContentPartsProjection({ messageId, threadId }))?.contentRevision,
    assistantContentRevision(updatedContent)
  )
  assert.equal(
    (
      await getPrismaClient().message.findUniqueOrThrow({
        where: { threadId_messageId: { messageId, threadId } }
      })
    ).content,
    initialContent
  )

  await closeDatabase()
  await initializeDatabase()
  const recoveredRunIds: string[] = []
  await recoverAssistantContentProjectionJobs({
    onBatch: (runIds) => {
      recoveredRunIds.push(...runIds)
    }
  })
  assert.equal(recoveredRunIds.includes(runId), false)
  assert.equal((await readAssistantContentProjectionJob(runId))?.status, "completed")
})

test("derived messages cannot reschedule a run after its canonical source is removed", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  const threadId = "thread-content-projection-canonical-removed"
  const runId = "run-content-projection-canonical-removed"
  const messageId = "assistant-message-canonical-removed"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "success" })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-canonical-removed-initial",
    checkpointNs: "",
    messages: [{ ...assistantItem("raw-canonical-removed", null), messageId }],
    runId,
    threadId,
    version: "1"
  })
  void enqueueAssistantContentProjection({ runId })
  await flushAssistantContentProjection()
  const derivedMessage = await getPrismaClient().message.findUniqueOrThrow({
    where: { threadId_messageId: { messageId, threadId } }
  })

  await persistMessageStateVersion({
    checkpointId: "checkpoint-canonical-removed-empty",
    checkpointNs: "",
    messages: [],
    runId,
    threadId,
    version: "2"
  })
  await getPrismaClient().message.create({ data: derivedMessage })

  assert.equal(
    await ensureAssistantContentProjectionPending(runId, { allowBlockedRetry: true }),
    false
  )
  assert.equal((await readAssistantContentProjectionJob(runId))?.status, "completed")
  assert.equal(await getPrismaClient().message.count({ where: { messageId, threadId } }), 1)
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
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "assistant_content_projection_jobs" RENAME TO "assistant_content_projection_jobs_recovery_test"'
  )
  try {
    await startAssistantContentProjectionLifecycle()
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "assistant_content_projection_jobs_recovery_test" RENAME TO "assistant_content_projection_jobs"'
    )
  }
  try {
    assert.ok(
      (await readDiagnosticEventCodes()).includes("assistant_content_projection.recovery_failed")
    )
    await waitFor(
      () => readAssistantContentPartsProjection({ messageId, threadId }),
      (projection) => projection !== null
    )
  } finally {
    await flushAssistantContentProjection()
  }
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

test("recovery aborts after the current bounded dispatch batch", async () => {
  const { createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
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
  const messages: PreparedMessageStateItem[] = []
  for (const [index, runId] of runIds.entries()) {
    messages.push({
      ...assistantItem(`raw-bounded-recovery-${index}`, null),
      content: JSON.stringify(`Bounded recovery ${index}`),
      messageId: `assistant-message-bounded-recovery-${String(index).padStart(3, "0")}`,
      order: index + 1
    })
    await persistMessageStateVersion({
      checkpointId: `checkpoint-bounded-recovery-${index}`,
      checkpointNs: "",
      messages,
      runId,
      threadId,
      version: String(index + 1)
    })
  }

  const recoveryAbortController = new AbortController()
  const dispatchedRunIds: string[] = []
  let dispatchBatchCount = 0
  await recoverAssistantContentProjectionJobs({
    onBatch: (batchRunIds) => {
      dispatchBatchCount += 1
      dispatchedRunIds.push(...batchRunIds)
      recoveryAbortController.abort()
    },
    signal: recoveryAbortController.signal
  })

  assert.equal(dispatchBatchCount, 1)
  assert.deepEqual(
    dispatchedRunIds,
    runIds.slice(0, ASSISTANT_CONTENT_PROJECTION_RECOVERY_BATCH_SIZE)
  )
  assert.equal(
    await prisma.assistantContentProjectionJob.count({
      where: { runId: { in: runIds }, status: "pending" }
    }),
    runIds.length
  )
  assert.equal(
    await prisma.assistantContentProjectionJob.count({
      where: { runId: { in: runIds }, status: "completed" }
    }),
    0
  )
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

test("recovery collapses ten thousand deferred jobs into one earliest retry deadline", async () => {
  const { createThread, getPrismaClient } = await loadDb()
  const prisma = getPrismaClient()
  const threadId = "thread-content-projection-deferred-recovery"
  const timestamp = BigInt(Date.now())
  const firstDeadline = timestamp + 60_000n
  await createThread(threadId)
  await prisma.$executeRaw`
    WITH RECURSIVE "sequence"("value") AS (
      SELECT 0
      UNION ALL
      SELECT "value" + 1 FROM "sequence" WHERE "value" < 9999
    )
    INSERT INTO "runs" ("run_id", "thread_id", "created_at", "updated_at", "status")
    SELECT printf('run-content-projection-deferred-%05d', "value"), ${threadId},
           ${timestamp}, ${timestamp}, 'success'
    FROM "sequence"
  `
  await prisma.$executeRaw`
    INSERT INTO "assistant_content_projection_jobs" (
      "run_id", "generation", "status", "attempt_count", "failure_code", "last_error",
      "next_attempt_at", "created_at", "updated_at"
    )
    SELECT "run_id", 1, 'failed', 1, 'execution-interrupted', 'interrupted',
           ${firstDeadline} + CAST(substr("run_id", -5) AS INTEGER), ${timestamp}, ${timestamp}
    FROM "runs"
    WHERE "thread_id" = ${threadId}
  `

  const deferredDeadlines: bigint[] = []
  let dueBatchCount = 0
  await recoverAssistantContentProjectionJobs({
    onBatch: () => {
      dueBatchCount += 1
    },
    onDeferred: (nextAttemptAt) => {
      deferredDeadlines.push(nextAttemptAt)
    }
  })

  assert.equal(dueBatchCount, 0)
  assert.deepEqual(deferredDeadlines, [firstDeadline])
  assert.equal(
    await prisma.assistantContentProjectionJob.count({ where: { run: { threadId } } }),
    10_000
  )
  await prisma.thread.delete({ where: { threadId } })
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
  await overwriteCanonicalMessageContent({
    content: "{",
    messageId: "assistant-message-core-boundary-bad",
    threadId: "thread-content-projection-core-boundary"
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

  await prisma.message.update({
    data: { content: JSON.stringify("Derived-only repair") },
    where: {
      threadId_messageId: {
        messageId: "assistant-message-core-boundary-bad",
        threadId: "thread-content-projection-core-boundary"
      }
    }
  })
  assert.equal(
    await resumeAssistantContentProjectionForRepairedMessage(
      "run-content-projection-core-boundary",
      "assistant-message-core-boundary-bad"
    ),
    false
  )
  assert.equal(
    await ensureAssistantContentProjectionPending("run-content-projection-core-boundary", {
      allowBlockedRetry: true
    }),
    false
  )
  assert.equal(
    (await readAssistantContentProjectionJob("run-content-projection-core-boundary"))?.status,
    "blocked"
  )
  await prisma.message.update({
    data: { content: "{" },
    where: {
      threadId_messageId: {
        messageId: "assistant-message-core-boundary-bad",
        threadId: "thread-content-projection-core-boundary"
      }
    }
  })

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
  assert.deepEqual(
    await new ContentCardsService().getAssistantParts({
      messageId: "assistant-message-core-boundary-good",
      threadId: "thread-content-projection-core-boundary"
    }),
    {
      issue: {
        code: "source-invalid",
        detail: "Assistant content projection rejected invalid-json persisted content.",
        reason: "invalid-json"
      },
      status: "blocked"
    }
  )
  assert.equal(
    (await readAssistantContentProjectionJob("run-content-projection-core-boundary"))?.attemptCount,
    1
  )
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

  await persistMessageStateVersion({
    checkpointId: "checkpoint-core-boundary-repaired",
    checkpointNs: "",
    messages: [
      {
        ...assistantItem("raw-core-boundary-bad-repaired", null),
        content: JSON.stringify("Recovered assistant content"),
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
    version: "3"
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
  const { createRun, createThread, persistMessageStateVersion } = await loadDb()
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

  await overwriteCanonicalMessageContent({ content: "{", messageId, threadId })
  const blockedStatesAtDelivery: Array<Promise<string | null>> = []
  const blockedEvents: Array<{ revision: string; status: string }> = []
  const stopBlockedEvents = assistantContentProjectionEvents.onChanged((event) => {
    if (event.kind !== "issue" || event.runId !== runId) return
    blockedEvents.push({ revision: event.revision, status: event.status })
    blockedStatesAtDelivery.push(
      readAssistantContentProjectionJob(event.runId).then((job) => job?.status ?? null)
    )
  })
  await enqueueAssistantContentProjection({ runId })
  await flushAssistantContentProjection()
  stopBlockedEvents()
  assert.equal((await readAssistantContentProjectionJob(runId))?.status, "blocked")
  assert.deepEqual(blockedEvents, [{ revision: "job:1:2", status: "blocked" }])
  assert.deepEqual(await Promise.all(blockedStatesAtDelivery), ["blocked"])
  assert.deepEqual(await new ContentCardsService().getAssistantParts({ messageId, threadId }), {
    issue: {
      code: "source-invalid",
      detail: "Assistant content projection rejected invalid-json persisted content.",
      reason: "invalid-json"
    },
    status: "blocked"
  })
  assert.equal((await readAssistantContentProjectionJob(runId))?.attemptCount, 2)
  assert.deepEqual(
    (await readAssistantContentPartsProjection({ messageId, threadId }))?.parts.map(
      (part) => part.id
    ),
    initialProjection.parts.map((part) => part.id)
  )

  await persistMessageStateVersion({
    checkpointId: "checkpoint-annotation-identity-repaired",
    checkpointNs: "",
    messages: [
      {
        ...assistantItem("raw-annotation-identity-repaired", null),
        content: canonicalContent,
        messageId
      }
    ],
    runId,
    threadId,
    version: "3"
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
  const { createRun, createThread, persistMessageStateVersion } = await loadDb()
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
  const service = new ContentCardsService()
  assert.deepEqual(await service.inspectAssistantParts({ messageIds: [messageId], threadId }), [
    {
      messageId,
      projectionFingerprint: assistantContentProjectionFingerprint(initialProjection),
      status: "ready"
    }
  ])
  const changedRevisions: string[] = []
  const changedFingerprints: string[] = []
  const stopChanges = assistantContentProjectionEvents.onChanged((event) => {
    if (event.kind === "ready" && event.messageId === messageId && event.threadId === threadId) {
      changedRevisions.push(event.revision)
      changedFingerprints.push(event.projectionFingerprint)
    }
  })

  await persistMessageStateVersion({
    checkpointId: "checkpoint-stale-hydrate-later",
    checkpointNs: "",
    messages: [
      {
        ...assistantItem("raw-stale-hydrate-later", null),
        content: JSON.stringify("Later canonical assistant content"),
        messageId
      }
    ],
    runId,
    threadId,
    version: "2"
  })
  assert.deepEqual(await service.inspectAssistantParts({ messageIds: [messageId], threadId }), [
    { messageId, status: "stale" }
  ])
  assert.deepEqual(await service.getAssistantParts({ messageId, threadId }), {
    status: "pending-stream"
  })
  await flushAssistantContentProjection()

  const refreshed = await service.getAssistantParts({ messageId, threadId })
  assert.equal(refreshed.status, "ready")
  if (refreshed.status === "ready") {
    assert.notEqual(refreshed.projection.contentRevision, initialProjection.contentRevision)
    assert.deepEqual(changedRevisions, [refreshed.projection.contentRevision])
    assert.deepEqual(changedFingerprints, [
      assistantContentProjectionFingerprint(refreshed.projection)
    ])
    assert.deepEqual(await service.inspectAssistantParts({ messageIds: [messageId], threadId }), [
      {
        messageId,
        projectionFingerprint: assistantContentProjectionFingerprint(refreshed.projection),
        status: "ready"
      }
    ])
  }
  stopChanges()
})

test("content-card hydrate uses canonical facts when the derived message is missing", async () => {
  const { createRun, createThread, getPrismaClient, persistMessageStateVersion } = await loadDb()
  const threadId = "thread-content-projection-canonical-hydrate"
  const runId = "run-content-projection-canonical-hydrate"
  const messageId = "assistant-message-canonical-hydrate"
  await createThread(threadId)
  await createRun(runId, threadId, { status: "success" })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-canonical-hydrate",
    checkpointNs: "",
    messages: [
      {
        ...assistantItem("raw-canonical-hydrate", null),
        content: JSON.stringify("Canonical content"),
        messageId
      }
    ],
    runId,
    threadId,
    version: "1"
  })
  await enqueueAssistantContentProjection({ runId })
  await flushAssistantContentProjection()
  await getPrismaClient().message.delete({
    where: { threadId_messageId: { messageId, threadId } }
  })

  const service = new ContentCardsService()
  assert.equal((await service.getAssistantParts({ messageId, threadId })).status, "ready")
  assert.equal(
    (await service.inspectAssistantParts({ messageIds: [messageId], threadId }))[0]?.status,
    "ready"
  )

  await overwriteCanonicalMessageContent({
    content: "{",
    messageId,
    threadId,
    updateDerivedProjection: false
  })
  await enqueueAssistantContentProjection({ runId })
  await flushAssistantContentProjection()
  assert.deepEqual(await service.inspectAssistantParts({ messageIds: [messageId], threadId }), [
    { messageId, status: "stale" }
  ])
  assert.deepEqual(await service.getAssistantParts({ messageId, threadId }), {
    issue: {
      code: "source-invalid",
      detail: "Assistant content projection rejected invalid-json persisted content.",
      reason: "invalid-json"
    },
    status: "blocked"
  })
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
