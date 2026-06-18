import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = process.cwd()
const originalOpenworkHome = process.env.OPENWORK_HOME
let openworkHome = ""

async function loadDbModules() {
  const db = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  return { ...db, getPrismaClient }
}

test.before(async () => {
  openworkHome = await mkdtemp(join(tmpdir(), "openwork-message-search-"))
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
  const { closeDatabase, getPrismaClient, initializeDatabase } = await loadDbModules()
  await closeDatabase()
  await initializeDatabase()
  await getPrismaClient().thread.deleteMany()
})

test.after(async () => {
  const { closeDatabase } = await loadDbModules()
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

test("message search indexes image names without storing image data URLs", async () => {
  const { createThread, getPrismaClient, syncMessageSearchIndexFromSnapshot } =
    await loadDbModules()
  const threadId = "thread-image-search"
  const imageUrl = `data:image/png;base64,${"a".repeat(16_384)}`

  await createThread(threadId)
  await syncMessageSearchIndexFromSnapshot(threadId, [
    {
      content: JSON.stringify([
        {
          image_url: {
            url: imageUrl
          },
          name: "Clipboard image",
          type: "image_url"
        }
      ]),
      message_id: "message-with-image",
      metadata: JSON.stringify({
        refs: [
          {
            name: "Clipboard image",
            type: "image",
            url: imageUrl
          }
        ]
      }),
      role: "user"
    }
  ])

  const prisma = getPrismaClient()
  const rows = await prisma.$queryRawUnsafe<Array<{ search_text: string }>>(
    `SELECT search_text FROM "messages_fts" WHERE thread_id = ?`,
    threadId
  )

  assert.equal(rows.length, 1)
  assert.match(rows[0]!.search_text, /Clipboard image|Attached image/)
  assert.doesNotMatch(rows[0]!.search_text, /data:image\/png;base64/)
  assert.ok(rows[0]!.search_text.length < 200)
})

test("message search indexes assistant selection reference text from metadata", async () => {
  const { createThread, getPrismaClient, syncMessageSearchIndexFromSnapshot } =
    await loadDbModules()
  const threadId = "thread-assistant-selection-search"

  await createThread(threadId)
  await syncMessageSearchIndexFromSnapshot(threadId, [
    {
      content: JSON.stringify("Is this still true?"),
      message_id: "message-with-selection-ref",
      metadata: JSON.stringify({
        refs: [
          {
            selectedText: "snapshot should not own runtime facts",
            sourceMessageId: "assistant-message-1",
            sourceThreadId: threadId,
            type: "assistant-message-selection"
          }
        ]
      }),
      role: "user"
    }
  ])

  const prisma = getPrismaClient()
  const rows = await prisma.$queryRawUnsafe<Array<{ search_text: string }>>(
    `SELECT search_text FROM "messages_fts" WHERE thread_id = ?`,
    threadId
  )

  assert.equal(rows.length, 1)
  assert.match(rows[0]!.search_text, /snapshot should not own runtime facts/)
})

test("message projection stores content separately from FTS and rebuilds search index", async () => {
  const {
    createThread,
    getPrismaClient,
    rebuildMessageSearchIndexFromMessages,
    syncMessageProjectionFromSnapshot
  } = await loadDbModules()
  const threadId = "thread-message-projection"

  await createThread(threadId)
  await syncMessageProjectionFromSnapshot(threadId, [
    {
      content: JSON.stringify("alpha searchable text"),
      created_at: 10,
      kind: "message",
      message_id: "message-alpha",
      role: "user"
    }
  ])

  const prisma = getPrismaClient()
  const messageRows = await prisma.message.findMany({ where: { threadId } })
  const ftsBefore = await prisma.$queryRawUnsafe<Array<{ search_text: string }>>(
    `SELECT search_text FROM "messages_fts" WHERE thread_id = ?`,
    threadId
  )

  assert.equal(messageRows.length, 1)
  assert.equal(messageRows[0]!.searchText, "alpha searchable text")
  assert.equal(ftsBefore.length, 0)

  await rebuildMessageSearchIndexFromMessages(threadId)

  const ftsAfter = await prisma.$queryRawUnsafe<Array<{ search_text: string }>>(
    `SELECT search_text FROM "messages_fts" WHERE thread_id = ?`,
    threadId
  )
  assert.deepEqual(
    ftsAfter.map((row) => row.search_text),
    ["alpha searchable text"]
  )
})

test("message search projection removes stale checkpoint messages", async () => {
  const { createThread, getPrismaClient, syncMessageSearchIndexFromSnapshot } = await loadDbModules()
  const threadId = "thread-stale-message-projection"

  await createThread(threadId)
  await syncMessageSearchIndexFromSnapshot(threadId, [
    { content: JSON.stringify("first"), message_id: "message-first", role: "user" },
    { content: JSON.stringify("second"), message_id: "message-second", role: "assistant" }
  ])
  await syncMessageSearchIndexFromSnapshot(threadId, [
    { content: JSON.stringify("second updated"), message_id: "message-second", role: "assistant" }
  ])

  const prisma = getPrismaClient()
  const messageRows = await prisma.message.findMany({
    orderBy: { messageId: "asc" },
    where: { threadId }
  })
  const ftsRows = await prisma.$queryRawUnsafe<Array<{ message_id: string; search_text: string }>>(
    `SELECT message_id, search_text FROM "messages_fts" WHERE thread_id = ? ORDER BY message_id`,
    threadId
  )

  assert.deepEqual(
    messageRows.map((row) => row.messageId),
    ["message-second"]
  )
  assert.deepEqual(
    ftsRows.map((row) => [row.message_id, row.search_text]),
    [["message-second", "second updated"]]
  )
})

test("thread search scope limits title and message matches by metadata source", async () => {
  const { createThread, searchThreadMatches, syncMessageSearchIndexFromSnapshot } =
    await loadDbModules()

  await createThread("launcher-ai-title-thread", {
    metadata: { source: "launcher-ai" },
    title: "scope shared title"
  })
  await createThread("history-title-thread", {
    metadata: { source: "history" },
    title: "scope shared title"
  })
  await createThread("launcher-ai-message-thread", {
    metadata: { source: "launcher-ai" },
    title: "launcher message"
  })
  await createThread("history-message-thread", {
    metadata: { source: "history" },
    title: "history message"
  })

  await syncMessageSearchIndexFromSnapshot("launcher-ai-message-thread", [
    { content: JSON.stringify("scope shared body"), message_id: "launcher-message", role: "user" }
  ])
  await syncMessageSearchIndexFromSnapshot("history-message-thread", [
    { content: JSON.stringify("scope shared body"), message_id: "history-message", role: "user" }
  ])

  const titleMatches = await searchThreadMatches({
    directLimit: 10,
    ftsQuery: null,
    messageLimit: 10,
    query: "scope shared title",
    scope: { metadataSource: "launcher-ai" },
    trigramQuery: null
  })
  const messageMatches = await searchThreadMatches({
    directLimit: 10,
    ftsQuery: '"scope"* "shared"* "body"*',
    messageLimit: 10,
    query: "scope shared body",
    scope: { metadataSource: "launcher-ai" },
    trigramQuery: null
  })

  assert.deepEqual(
    titleMatches.direct.map((row) => row.thread_id),
    ["launcher-ai-title-thread"]
  )
  assert.deepEqual(
    messageMatches.messages.map((row) => row.thread_id),
    ["launcher-ai-message-thread"]
  )
})
