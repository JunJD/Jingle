import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { PreparedMessageStateItem } from "../../src/main/db/message-state"
import { readAssistantContentPartsProjection } from "../../src/main/db/assistant-content-parts"
import {
  enqueueAssistantContentProjection,
  flushAssistantContentProjection
} from "../../src/main/content-cards/projection-queue"

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
  enqueueAssistantContentProjection({
    runId: "run-content-parts",
    threadId: "thread-content-parts"
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
  enqueueAssistantContentProjection({
    runId: "run-content-parts",
    threadId: "thread-content-parts"
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
