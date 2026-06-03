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
