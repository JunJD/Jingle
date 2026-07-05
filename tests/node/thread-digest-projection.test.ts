import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

async function loadDbModules() {
  const db = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  const messageSearch = await import("../../src/main/db/message-search")
  return { ...db, ...messageSearch, getPrismaClient }
}

async function resetDatabase(): Promise<void> {
  const {
    closeDatabase,
    flushAgentTraceProjection,
    getPrismaClient,
    initializeDatabase
  } = await loadDbModules()
  const { flushThreadDigestProjection } = await import(
    "../../src/main/projection/thread-digest-queue"
  )
  await flushAgentTraceProjection()
  await flushThreadDigestProjection()
  await closeDatabase()
  await initializeDatabase()
  await getPrismaClient().thread.deleteMany()
}

test.before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-thread-digest-"))
  process.env.JINGLE_HOME = jingleHome

  execFileSync("node", ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      JINGLE_HOME: jingleHome,
    }
  })
})

test.beforeEach(async () => {
  await resetDatabase()
})

test.after(async () => {
  const { closeDatabase, flushAgentTraceProjection } = await loadDbModules()
  const { flushThreadDigestProjection } = await import(
    "../../src/main/projection/thread-digest-queue"
  )
  await flushAgentTraceProjection()
  await flushThreadDigestProjection()
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

test("thread digest projection writes a ready rebuildable digest and searchable FTS rows", async () => {
  const {
    createThread,
    getThreadDigest,
    searchThreadDigests,
    syncMessageSearchIndexFromSnapshot
  } = await loadDbModules()
  const { projectThreadDigest, setThreadDigestGeneratorForTests } = await import(
    "../../src/main/projection/thread-digest-projection"
  )
  const threadId = "thread-digest-ready"

  await createThread(threadId, { title: "Digest Ready Thread" })
  await syncMessageSearchIndexFromSnapshot(threadId, [
    {
      content: JSON.stringify("We decided that ThreadDigest routes session search."),
      message_id: "message-user-digest",
      role: "user"
    },
    {
      content: JSON.stringify("Use messages FTS for concrete evidence after digest routing."),
      message_id: "message-assistant-digest",
      role: "assistant"
    }
  ])

  const restoreGenerator = setThreadDigestGeneratorForTests(async ({ prompt }) => {
    assert.match(prompt, /ThreadDigest routes session search/)
    return {
      decisions: ["Use messages FTS for concrete evidence."],
      openQuestions: ["How should external IM bindings attach?"],
      summary: "ThreadDigest routes session-level history search before message evidence lookup.",
      topics: ["ThreadDigest", "history retrieval"]
    }
  })
  try {
    await projectThreadDigest(threadId)
  } finally {
    restoreGenerator()
  }

  const digest = await getThreadDigest(threadId)
  assert.equal(digest?.status, "ready")
  assert.equal(
    digest?.summary,
    "ThreadDigest routes session-level history search before message evidence lookup."
  )
  assert.deepEqual(digest?.topics, ["ThreadDigest", "history retrieval"])
  assert.equal(digest?.messageCount, 2)
  assert.equal(digest?.projectedThroughSeq, 2)
  assert.ok(digest?.sourceHash)

  const matches = await searchThreadDigests({
    limit: 5,
    query: "session history"
  })
  assert.equal(matches[0]?.threadId, threadId)
  assert.equal(matches[0]?.threadTitle, "Digest Ready Thread")
})

test("run finished schedules a coalesced thread digest projection", async () => {
  const { createRun, createThread, getThreadDigest, syncMessageSearchIndexFromSnapshot } =
    await loadDbModules()
  const { recordRunFinished } = await import("../../src/main/agent/event-recorder")
  const { flushThreadDigestProjection, setThreadDigestGeneratorForTests } = await import(
    "../../src/main/projection/thread-digest-queue"
  )
  const threadId = "thread-digest-run-finished"

  await createThread(threadId)
  await createRun("run-digest-one", threadId)
  await createRun("run-digest-two", threadId)
  await syncMessageSearchIndexFromSnapshot(threadId, [
    {
      content: JSON.stringify("Terminal runs should enqueue one coalesced digest job."),
      message_id: "message-digest-coalesced",
      role: "user"
    }
  ])

  let calls = 0
  const restoreGenerator = setThreadDigestGeneratorForTests(async () => {
    calls += 1
    return {
      decisions: [],
      openQuestions: [],
      summary: "Run finished enqueues a coalesced thread digest projection.",
      topics: ["projection queue"]
    }
  })
  try {
    await recordRunFinished({
      completionReason: "done",
      runId: "run-digest-one",
      status: "success",
      threadId
    })
    await recordRunFinished({
      completionReason: "done",
      runId: "run-digest-two",
      status: "success",
      threadId
    })
    await flushThreadDigestProjection()
  } finally {
    restoreGenerator()
  }

  assert.equal(calls, 1)
  assert.equal((await getThreadDigest(threadId))?.status, "ready")
})

test("thread digest projection failure writes diagnostics without a fake searchable digest", async () => {
  const {
    createThread,
    getThreadDigest,
    searchThreadDigests,
    syncMessageSearchIndexFromSnapshot
  } = await loadDbModules()
  const {
    enqueueThreadDigestProjection,
    flushThreadDigestProjection,
    setThreadDigestGeneratorForTests
  } = await import(
    "../../src/main/projection/thread-digest-queue"
  )
  const threadId = "thread-digest-failure"

  await createThread(threadId)
  await syncMessageSearchIndexFromSnapshot(threadId, [
    {
      content: JSON.stringify("Failure diagnostics should stay visible."),
      message_id: "message-digest-failure",
      role: "user"
    }
  ])

  const restoreGenerator = setThreadDigestGeneratorForTests(async () => {
    throw new Error("digest model unavailable")
  })
  try {
    enqueueThreadDigestProjection(threadId)
    await flushThreadDigestProjection()
  } finally {
    restoreGenerator()
  }

  const digest = await getThreadDigest(threadId)
  assert.equal(digest?.status, "failed")
  assert.equal(digest?.summary, null)
  assert.match(digest?.projectionError ?? "", /digest model unavailable/)
  assert.deepEqual(await searchThreadDigests({ limit: 5, query: "diagnostics" }), [])
})

test("thread digest projection stops retrying provider access failures", async () => {
  const { createThread, getThreadDigest, syncMessageSearchIndexFromSnapshot } = await loadDbModules()
  const {
    enqueueThreadDigestProjection,
    flushThreadDigestProjection,
    setThreadDigestGeneratorForTests
  } = await import(
    "../../src/main/projection/thread-digest-queue"
  )
  const threadId = "thread-digest-access-failure"

  await createThread(threadId)
  await syncMessageSearchIndexFromSnapshot(threadId, [
    {
      content: JSON.stringify("Provider access failures should not be retried forever."),
      message_id: "message-digest-access-failure",
      role: "user"
    }
  ])

  let calls = 0
  const accessError = new Error("Access denied, please make sure your account is in good standing.")
  Object.assign(accessError, { code: "Arrearage", status: 400, type: "Arrearage" })
  const restoreGenerator = setThreadDigestGeneratorForTests(async () => {
    calls += 1
    throw accessError
  })
  try {
    enqueueThreadDigestProjection(threadId)
    await flushThreadDigestProjection()
    enqueueThreadDigestProjection(threadId)
    await flushThreadDigestProjection()
  } finally {
    restoreGenerator()
  }

  const digest = await getThreadDigest(threadId)
  assert.equal(calls, 1)
  assert.equal(digest?.status, "failed")
  assert.match(digest?.projectionError ?? "", /Access denied/)
})

test("thread digest projection failure clears stale ready digest content", async () => {
  const {
    createThread,
    getThreadDigest,
    searchThreadDigests,
    syncMessageSearchIndexFromSnapshot,
    upsertReadyThreadDigest
  } = await loadDbModules()
  const {
    enqueueThreadDigestProjection,
    flushThreadDigestProjection,
    setThreadDigestGeneratorForTests
  } = await import(
    "../../src/main/projection/thread-digest-queue"
  )
  const threadId = "thread-digest-failure-clears-stale"

  await createThread(threadId)
  await syncMessageSearchIndexFromSnapshot(threadId, [
    {
      content: JSON.stringify("Failure should remove old digest content."),
      message_id: "message-digest-clear-stale",
      role: "user"
    }
  ])
  await upsertReadyThreadDigest({
    decisions: ["Old decision"],
    messageCount: 1,
    openQuestions: ["Old question"],
    projectedThroughSeq: 1,
    sourceHash: "old-hash",
    summary: "Old searchable digest content.",
    threadId,
    topics: ["Old topic"]
  })

  const restoreGenerator = setThreadDigestGeneratorForTests(async () => {
    throw new Error("digest model unavailable")
  })
  try {
    enqueueThreadDigestProjection(threadId)
    await flushThreadDigestProjection()
  } finally {
    restoreGenerator()
  }

  const digest = await getThreadDigest(threadId)
  assert.equal(digest?.status, "failed")
  assert.equal(digest?.summary, null)
  assert.deepEqual(digest?.topics, [])
  assert.deepEqual(digest?.decisions, [])
  assert.deepEqual(digest?.openQuestions, [])
  assert.equal(digest?.messageCount, 0)
  assert.equal(digest?.projectedThroughSeq, 0)
  assert.equal(digest?.sourceHash, null)
  assert.deepEqual(await searchThreadDigests({ limit: 5, query: "searchable" }), [])
})

test("thread digest projection without source messages stays pending without fake search rows", async () => {
  const { createThread, getThreadDigest, searchThreadDigests } = await loadDbModules()
  const { projectThreadDigest } = await import(
    "../../src/main/projection/thread-digest-projection"
  )
  const threadId = "thread-digest-empty"

  await createThread(threadId)
  await projectThreadDigest(threadId)

  const digest = await getThreadDigest(threadId)
  assert.equal(digest?.status, "pending")
  assert.equal(digest?.summary, null)
  assert.equal(digest?.projectionError, null)
  assert.deepEqual(await searchThreadDigests({ limit: 5, query: "empty" }), [])
})

test("closeRuntimeCheckpointers flushes queued thread digest projection", async () => {
  const { createThread, getThreadDigest, syncMessageSearchIndexFromSnapshot } = await loadDbModules()
  const { enqueueThreadDigestProjection, setThreadDigestGeneratorForTests } = await import(
    "../../src/main/projection/thread-digest-queue"
  )
  const { closeRuntimeCheckpointers } = await import(
    "../../src/main/checkpointer/runtime-checkpointer-manager"
  )
  const threadId = "thread-digest-close-runtime"

  await createThread(threadId)
  await syncMessageSearchIndexFromSnapshot(threadId, [
    {
      content: JSON.stringify("closeRuntimeCheckpointers should flush queued digest work."),
      message_id: "message-close-runtime",
      role: "user"
    }
  ])

  const restoreGenerator = setThreadDigestGeneratorForTests(async () => ({
    decisions: [],
    openQuestions: [],
    summary: "closeRuntimeCheckpointers flushes queued digest work.",
    topics: ["closeRuntimeCheckpointers"]
  }))
  try {
    enqueueThreadDigestProjection(threadId)
    await closeRuntimeCheckpointers()
  } finally {
    restoreGenerator()
  }

  assert.equal((await getThreadDigest(threadId))?.status, "ready")
})

test("closeDatabase flushes queued thread digest projection", async () => {
  const { closeDatabase, createThread, getPrismaClient, initializeDatabase } = await loadDbModules()
  const { syncMessageSearchIndexFromSnapshot } = await import("../../src/main/db/message-search")
  const { enqueueThreadDigestProjection, setThreadDigestGeneratorForTests } = await import(
    "../../src/main/projection/thread-digest-queue"
  )
  const threadId = "thread-digest-close-database"

  await createThread(threadId)
  await syncMessageSearchIndexFromSnapshot(threadId, [
    {
      content: JSON.stringify("closeDatabase should flush queued digest work."),
      message_id: "message-close-database",
      role: "user"
    }
  ])

  const restoreGenerator = setThreadDigestGeneratorForTests(async () => ({
    decisions: [],
    openQuestions: [],
    summary: "closeDatabase flushes queued digest work.",
    topics: ["closeDatabase"]
  }))
  try {
    enqueueThreadDigestProjection(threadId)
    await closeDatabase()
  } finally {
    restoreGenerator()
  }

  await initializeDatabase()
  const digest = await getPrismaClient().threadDigest.findUnique({
    where: { threadId }
  })
  assert.equal(digest?.status, "ready")
})
