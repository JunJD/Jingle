import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { MessageProjectionRow } from "../../src/main/db/message-state"

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
  const { closeDatabase, flushAgentTraceProjection, getPrismaClient, initializeDatabase } =
    await loadDbModules()
  await flushAgentTraceProjection()
  await closeDatabase()
  await initializeDatabase()
  await getPrismaClient().thread.deleteMany()
}

async function seedThread(threadId: string, text: string): Promise<void> {
  const { createThread, syncMessageSearchIndexFromSnapshot } = await loadDbModules()
  await createThread(threadId, { title: `Title for ${threadId}` })
  await syncMessageSearchIndexFromSnapshot(threadId, [
    {
      content: JSON.stringify(text),
      message_id: `message-${threadId}`,
      role: "user"
    }
  ])
}

async function createThreadsServiceForDigestTest(
  threadDigestService: unknown,
  threadLifecycleGate?: unknown
) {
  const { ThreadLifecycleGate } = await import("../../src/main/agent/thread-lifecycle-gate")
  const { ThreadsService } = await import("../../src/main/threads/service")
  return new ThreadsService(
    { deleteManagedFilesForThread: async () => undefined } as unknown as ConstructorParameters<
      typeof ThreadsService
    >[0],
    {} as ConstructorParameters<typeof ThreadsService>[1],
    {} as ConstructorParameters<typeof ThreadsService>[2],
    {} as ConstructorParameters<typeof ThreadsService>[3],
    {} as ConstructorParameters<typeof ThreadsService>[4],
    threadDigestService as ConstructorParameters<typeof ThreadsService>[5],
    (threadLifecycleGate ?? new ThreadLifecycleGate()) as ConstructorParameters<
      typeof ThreadsService
    >[6]
  )
}

async function assertDigestSearchRowsDeleted(threadId: string): Promise<void> {
  const { getPrismaClient } = await loadDbModules()
  const prisma = getPrismaClient()
  const [unicodeRows, trigramRows] = await Promise.all([
    prisma.$queryRaw<Array<{ thread_id: string }>>`
      SELECT thread_id FROM "thread_digests_fts" WHERE thread_id = ${threadId}
    `,
    prisma.$queryRaw<Array<{ thread_id: string }>>`
      SELECT thread_id FROM "thread_digests_fts_trigram" WHERE thread_id = ${threadId}
    `
  ])
  assert.deepEqual(unicodeRows, [])
  assert.deepEqual(trigramRows, [])
}

test.before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-thread-digest-"))
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
  await resetDatabase()
})

test.after(async () => {
  const { closeDatabase, flushAgentTraceProjection } = await loadDbModules()
  await flushAgentTraceProjection()
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

test("manual thread digest generation writes a ready searchable digest", async () => {
  const { getThreadDigest, searchThreadDigests } = await loadDbModules()
  const { projectThreadDigest, setThreadDigestGeneratorForTests } =
    await import("../../src/main/projection/thread-digest-projection")
  const threadId = "thread-digest-ready"
  await seedThread(threadId, "ThreadDigest routes session search.")

  const restoreGenerator = setThreadDigestGeneratorForTests(async ({ prompt }) => {
    assert.match(prompt, /ThreadDigest routes session search/)
    return {
      decisions: ["Use message search for evidence."],
      openQuestions: [],
      summary: "ThreadDigest routes history search before message evidence lookup.",
      topics: ["history retrieval"]
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
    "ThreadDigest routes history search before message evidence lookup."
  )
  assert.equal(
    (await searchThreadDigests({ limit: 5, query: "history search" }))[0]?.threadId,
    threadId
  )
})

test("run completion does not generate a thread digest automatically", async () => {
  const { createRun, getThreadDigest } = await loadDbModules()
  const { recordRunFinished } = await import("../../src/main/agent/event-recorder")
  const { setThreadDigestGeneratorForTests } =
    await import("../../src/main/projection/thread-digest-projection")
  const threadId = "thread-digest-manual-only"
  await seedThread(threadId, "Digest generation must remain user initiated.")
  await createRun("run-digest-manual-only", threadId)

  let calls = 0
  const restoreGenerator = setThreadDigestGeneratorForTests(async () => {
    calls += 1
    return { decisions: [], openQuestions: [], summary: "Unexpected", topics: [] }
  })
  try {
    await recordRunFinished({
      completionReason: "done",
      runId: "run-digest-manual-only",
      status: "success",
      threadId
    })
  } finally {
    restoreGenerator()
  }

  assert.equal(calls, 0)
  assert.equal(await getThreadDigest(threadId), null)
})

test("failed regeneration preserves the last successful digest", async () => {
  const { getThreadDigest, searchThreadDigests, upsertReadyThreadDigest } = await loadDbModules()
  const { setThreadDigestGeneratorForTests } =
    await import("../../src/main/projection/thread-digest-projection")
  const { ThreadDigestService } = await import("../../src/main/thread-digest/service")
  const threadId = "thread-digest-preserve-ready"
  await seedThread(threadId, "A failed retry must preserve the old summary.")
  await upsertReadyThreadDigest({
    decisions: ["Keep the old digest."],
    messageCount: 1,
    openQuestions: [],
    projectedThroughSeq: 1,
    sourceHash: "old-hash",
    summary: "Existing searchable summary.",
    threadId,
    topics: ["preservation"]
  })

  const restoreGenerator = setThreadDigestGeneratorForTests(async () => {
    throw new Error("digest model unavailable")
  })
  try {
    await assert.rejects(new ThreadDigestService().generate(threadId), /digest model unavailable/)
  } finally {
    restoreGenerator()
  }

  const digest = await getThreadDigest(threadId)
  assert.equal(digest?.status, "ready")
  assert.equal(digest?.summary, "Existing searchable summary.")
  assert.equal(
    (await searchThreadDigests({ limit: 5, query: "searchable" }))[0]?.threadId,
    threadId
  )
})

test("digest and search index updates roll back together", async () => {
  const { getPrismaClient, getThreadDigest, searchThreadDigests, upsertReadyThreadDigest } =
    await loadDbModules()
  const threadId = "thread-digest-atomic"
  await seedThread(threadId, "Digest persistence must remain atomic.")
  await upsertReadyThreadDigest({
    decisions: [],
    messageCount: 1,
    openQuestions: [],
    projectedThroughSeq: 1,
    sourceHash: "old-hash",
    summary: "Existing atomic summary.",
    threadId,
    topics: ["atomic"]
  })

  const prisma = getPrismaClient()
  await prisma.$executeRawUnsafe('DROP TABLE "thread_digests_fts_trigram"')
  try {
    await assert.rejects(
      upsertReadyThreadDigest({
        decisions: [],
        messageCount: 2,
        openQuestions: [],
        projectedThroughSeq: 2,
        sourceHash: "new-hash",
        summary: "Replacement summary.",
        threadId,
        topics: ["replacement"]
      })
    )
    assert.equal((await getThreadDigest(threadId))?.summary, "Existing atomic summary.")
  } finally {
    await prisma.$executeRawUnsafe(
      'CREATE VIRTUAL TABLE "thread_digests_fts_trigram" USING fts5("thread_id" UNINDEXED, "search_text", tokenize = \'trigram\')'
    )
  }

  assert.equal(
    (await searchThreadDigests({ limit: 5, query: "atomic summary" }))[0]?.threadId,
    threadId
  )
})

test("manual generation can retry provider failures", async () => {
  const { setThreadDigestGeneratorForTests } =
    await import("../../src/main/projection/thread-digest-projection")
  const { ThreadDigestService } = await import("../../src/main/thread-digest/service")
  const threadId = "thread-digest-retry"
  await seedThread(threadId, "Manual retry should call the provider again.")

  let calls = 0
  const restoreGenerator = setThreadDigestGeneratorForTests(async () => {
    calls += 1
    throw new Error("provider access denied")
  })
  const service = new ThreadDigestService()
  try {
    await assert.rejects(service.generate(threadId), /access denied/)
    await assert.rejects(service.generate(threadId), /access denied/)
  } finally {
    restoreGenerator()
  }

  assert.equal(calls, 2)
})

test("manual generation rejects threads without messages", async () => {
  const { createThread, getThreadDigest } = await loadDbModules()
  const { ThreadDigestService } = await import("../../src/main/thread-digest/service")
  const threadId = "thread-digest-empty"
  await createThread(threadId)

  await assert.rejects(
    new ThreadDigestService().generate(threadId),
    /no user or assistant messages/
  )
  assert.equal(await getThreadDigest(threadId), null)
})

test("concurrent requests for one thread share one generation", async () => {
  const { setThreadDigestGeneratorForTests } =
    await import("../../src/main/projection/thread-digest-projection")
  const { ThreadDigestService } = await import("../../src/main/thread-digest/service")
  const threadId = "thread-digest-coalesced"
  await seedThread(threadId, "Concurrent requests should share one model call.")

  let calls = 0
  let release: () => void = () => {
    throw new Error("Digest generation gate was not initialized.")
  }
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const restoreGenerator = setThreadDigestGeneratorForTests(async () => {
    calls += 1
    await gate
    return { decisions: [], openQuestions: [], summary: "One shared result.", topics: [] }
  })
  const service = new ThreadDigestService()
  const changed: string[] = []
  const unsubscribe = service.onChanged((digest) => {
    changed.push(digest.summary ?? "")
  })
  try {
    const first = service.generate(threadId)
    const second = service.generate(threadId)
    release()
    const [firstDigest, secondDigest] = await Promise.all([first, second])
    assert.equal(firstDigest.summary, "One shared result.")
    assert.equal(secondDigest.summary, "One shared result.")
  } finally {
    unsubscribe()
    restoreGenerator()
  }

  assert.equal(calls, 1)
  assert.deepEqual(changed, ["One shared result."])
})

test("shutdown cancels active generation without writing a partial digest", async () => {
  const { getThreadDigest } = await loadDbModules()
  const { setThreadDigestGeneratorForTests } =
    await import("../../src/main/projection/thread-digest-projection")
  const { ThreadDigestService } = await import("../../src/main/thread-digest/service")
  const threadId = "thread-digest-cancel"
  await seedThread(threadId, "Application shutdown should cancel this summary.")

  const restoreGenerator = setThreadDigestGeneratorForTests(
    ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
  )
  const service = new ThreadDigestService()
  try {
    const generation = service.generate(threadId)
    const rejected = assert.rejects(generation, { name: "AbortError" })
    await service.shutdown()
    await rejected
    assert.throws(
      () => service.withThreadDeletion(threadId, async () => undefined),
      /application is shutting down/
    )
  } finally {
    restoreGenerator()
  }

  assert.equal(await getThreadDigest(threadId), null)
})

test("shutdown waits for an admitted digest commit without publishing a change", async () => {
  const { getThreadDigest } = await loadDbModules()
  const {
    commitThreadDigestProjection,
    prepareThreadDigestProjection,
    setThreadDigestGeneratorForTests
  } = await import("../../src/main/projection/thread-digest-projection")
  const { ThreadDigestService } = await import("../../src/main/thread-digest/service")
  const threadId = "thread-digest-shutdown-commit"
  await seedThread(threadId, "An admitted digest commit must finish during shutdown.")

  let releaseCommit: () => void = () => {
    throw new Error("Digest commit gate was not initialized.")
  }
  let markCommitStarted: () => void = () => {
    throw new Error("Digest commit start gate was not initialized.")
  }
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve
  })
  const commitStarted = new Promise<void>((resolve) => {
    markCommitStarted = resolve
  })
  const restoreGenerator = setThreadDigestGeneratorForTests(async () => ({
    decisions: [],
    openQuestions: [],
    summary: "Committed during shutdown.",
    topics: []
  }))
  const service = new ThreadDigestService(undefined, {
    commit: async (input) => {
      markCommitStarted()
      await commitGate
      await commitThreadDigestProjection(input)
    },
    prepare: prepareThreadDigestProjection
  })
  let changedCount = 0
  const unsubscribe = service.onChanged(() => {
    changedCount += 1
  })

  try {
    const generation = service.generate(threadId)
    await commitStarted
    const shutdown = service.shutdown()
    let shutdownSettled = false
    void shutdown.then(() => {
      shutdownSettled = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(shutdownSettled, false)

    releaseCommit()
    assert.equal((await generation).summary, "Committed during shutdown.")
    await shutdown
  } finally {
    unsubscribe()
    restoreGenerator()
  }

  assert.equal(changedCount, 0)
  assert.equal((await getThreadDigest(threadId))?.summary, "Committed during shutdown.")
})

test("thread deletion aborts digest preparation, rejects new admission, and clears digest search rows", async () => {
  const { getThread, getThreadDigest, upsertReadyThreadDigest } = await loadDbModules()
  const { ThreadDigestService } = await import("../../src/main/thread-digest/service")
  const threadId = "thread-digest-delete-prepare"
  await seedThread(threadId, "Deletion must cancel digest preparation.")
  await upsertReadyThreadDigest({
    decisions: [],
    messageCount: 1,
    openQuestions: [],
    projectedThroughSeq: 1,
    sourceHash: "existing-hash",
    summary: "Existing digest to delete.",
    threadId,
    topics: []
  })

  let markPrepareStarted: () => void = () => {
    throw new Error("Digest prepare start gate was not initialized.")
  }
  const prepareStarted = new Promise<void>((resolve) => {
    markPrepareStarted = resolve
  })
  const digestService = new ThreadDigestService(undefined, {
    commit: async () => {
      assert.fail("Canceled digest preparation must not commit.")
    },
    prepare: (_requestedThreadId, signal) =>
      new Promise((_resolve, reject) => {
        markPrepareStarted()
        const rejectAbort = (): void => reject(signal.reason)
        signal.addEventListener("abort", rejectAbort, { once: true })
        if (signal.aborted) {
          rejectAbort()
        }
      })
  })
  const threadsService = await createThreadsServiceForDigestTest(digestService)
  const generation = digestService.generate(threadId)
  const generationRejected = assert.rejects(generation, { name: "AbortError" })
  await prepareStarted

  const deletion = threadsService.delete(threadId)
  assert.throws(() => digestService.generate(threadId), /being deleted/)
  await Promise.all([deletion, generationRejected])

  assert.equal(await getThread(threadId), null)
  assert.equal(await getThreadDigest(threadId), null)
  assert.throws(() => digestService.generate(threadId), /no longer exists/)
  await assertDigestSearchRowsDeleted(threadId)
})

test("thread deletion waits for an admitted digest commit before removing the thread", async () => {
  const { getThread, getThreadDigest } = await loadDbModules()
  const { ThreadLifecycleGate } = await import("../../src/main/agent/thread-lifecycle-gate")
  const { commitThreadDigestProjection } =
    await import("../../src/main/projection/thread-digest-projection")
  const { ThreadDigestService } = await import("../../src/main/thread-digest/service")
  const threadId = "thread-digest-delete-commit"
  await seedThread(threadId, "Deletion must wait for an admitted digest commit.")

  let markCommitStarted: () => void = () => {
    throw new Error("Digest commit start gate was not initialized.")
  }
  let releaseCommit: () => void = () => {
    throw new Error("Digest commit gate was not initialized.")
  }
  const commitStarted = new Promise<void>((resolve) => {
    markCommitStarted = resolve
  })
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve
  })
  const digestService = new ThreadDigestService(undefined, {
    commit: async (input) => {
      markCommitStarted()
      await commitGate
      await commitThreadDigestProjection(input)
    },
    prepare: async () => ({
      decisions: [],
      messageCount: 1,
      openQuestions: [],
      projectedThroughSeq: 1,
      sourceHash: "committing-hash",
      summary: "Digest committed before deletion.",
      threadId,
      topics: []
    })
  })
  let changedCount = 0
  const unsubscribe = digestService.onChanged(() => {
    changedCount += 1
  })
  const threadLifecycleGate = new ThreadLifecycleGate()
  const threadsService = await createThreadsServiceForDigestTest(digestService, threadLifecycleGate)
  const generation = digestService.generate(threadId)
  await commitStarted

  let deletionSettled = false
  const deletion = threadsService.delete(threadId).then(() => {
    deletionSettled = true
  })
  assert.throws(() => digestService.generate(threadId), /being deleted/)
  assert.equal((await threadLifecycleGate.claimRun(threadId)).status, "deleting")
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(deletionSettled, false)

  releaseCommit()
  assert.equal((await generation).summary, "Digest committed before deletion.")
  await deletion

  assert.equal(await getThread(threadId), null)
  assert.equal(await getThreadDigest(threadId), null)
  assert.equal(changedCount, 0)
  await assertDigestSearchRowsDeleted(threadId)
  unsubscribe()
})

test("digest prompt keeps the newest messages when the character budget is exhausted", async () => {
  const { threadDigestProjectionInternals } =
    await import("../../src/main/projection/thread-digest-projection")
  const messages = Array.from({ length: 30 }, (_, index): MessageProjectionRow => {
    const seq = index + 1
    const marker = seq === 1 ? "OLDEST_MARKER" : seq === 30 ? "NEWEST_MARKER" : `message-${seq}`
    return {
      content: JSON.stringify(`${marker} ${"x".repeat(1_100)}`),
      created_at: seq,
      kind: "message",
      message_id: `message-${seq}`,
      metadata: null,
      name: null,
      raw_message: "",
      role: seq % 2 === 0 ? "assistant" : "user",
      run_id: null,
      seq,
      thread_id: "thread-digest-budget",
      tool_call_id: null,
      tool_calls: null
    }
  })

  const prompt = threadDigestProjectionInternals.buildDigestPrompt(messages)

  assert.match(prompt, /NEWEST_MARKER/)
  assert.doesNotMatch(prompt, /OLDEST_MARKER/)
})

test("digest prompt skips corrupt and noncanonical persisted message content", async () => {
  const { threadDigestProjectionInternals } =
    await import("../../src/main/projection/thread-digest-projection")
  const createRow = (content: string, messageId: string, seq: number): MessageProjectionRow => ({
    content,
    created_at: seq,
    kind: "message",
    message_id: messageId,
    metadata: null,
    name: null,
    raw_message: "",
    role: "user",
    run_id: null,
    seq,
    thread_id: "thread-digest-corrupt",
    tool_call_id: null,
    tool_calls: null
  })
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args)
  try {
    const prompt = threadDigestProjectionInternals.buildDigestPrompt([
      createRow(JSON.stringify("safe digest content"), "message-safe", 1),
      createRow("secret raw corrupt payload", "message-corrupt", 2),
      createRow(
        JSON.stringify([{ content: "legacy raw payload", type: "text" }]),
        "message-noncanonical",
        3
      )
    ])
    assert.match(prompt, /safe digest content/)
    assert.doesNotMatch(prompt, /secret raw corrupt payload|legacy raw payload/)
    assert.equal(warnings.length, 2)
    assert.doesNotMatch(JSON.stringify(warnings), /secret raw corrupt payload|legacy raw payload/)
  } finally {
    console.warn = originalWarn
  }
})
