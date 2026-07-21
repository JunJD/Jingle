import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { PreparedMessageStateItem } from "../../src/main/db/message-state"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

function messageItem(input: {
  content: string
  messageId: string
  order: number
  role: "assistant" | "user"
}): PreparedMessageStateItem {
  return {
    content: JSON.stringify(input.content),
    kind: "message",
    messageId: input.messageId,
    metadata: null,
    name: null,
    order: input.order,
    rawHash: `hash-${input.messageId}-${input.content}`,
    rawMessageEncoding: "text",
    rawMessageType: "json",
    rawMessageValue: JSON.stringify({ content: input.content }),
    role: input.role,
    toolCallId: null,
    toolCalls: null
  }
}

test.before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-message-state-reader-"))
  process.env.JINGLE_HOME = jingleHome
  execFileSync("node", ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: { ...process.env, JINGLE_HOME: jingleHome }
  })
})

test.after(async () => {
  const { closeDatabase } = await import("../../src/main/db")
  await closeDatabase()
  if (originalJingleHome === undefined) delete process.env.JINGLE_HOME
  else process.env.JINGLE_HOME = originalJingleHome
  await rm(jingleHome, { force: true, recursive: true })
})

test("canonical main message reader folds latest events with run ownership inside a transaction", async () => {
  const { createRun, createThread, initializeDatabase } = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  const { listCanonicalMainThreadMessages, persistMessageStateVersion } =
    await import("../../src/main/db/message-state")
  await initializeDatabase()
  const prisma = getPrismaClient()
  const threadId = "thread-canonical-message-reader"
  await createThread(threadId)
  await createRun("run-canonical-reader-first", threadId)
  await createRun("run-canonical-reader-second", threadId)

  const first = messageItem({
    content: "first assistant before update",
    messageId: "message-canonical-reader-first",
    order: 1,
    role: "assistant"
  })
  const removed = messageItem({
    content: "removed user",
    messageId: "message-canonical-reader-removed",
    order: 2,
    role: "user"
  })
  const stable = messageItem({
    content: "stable assistant",
    messageId: "message-canonical-reader-stable",
    order: 3,
    role: "assistant"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-canonical-reader-first",
    checkpointNs: "",
    messages: [first, removed, stable],
    runId: "run-canonical-reader-first",
    threadId,
    version: "messages-canonical-reader-first"
  })

  const updatedFirst = messageItem({
    content: "first assistant after update",
    messageId: "message-canonical-reader-first",
    order: 1,
    role: "assistant"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-canonical-reader-second",
    checkpointNs: "",
    messages: [updatedFirst, stable],
    runId: "run-canonical-reader-second",
    threadId,
    version: "messages-canonical-reader-second"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-canonical-reader-nested",
    checkpointNs: "nested",
    messages: [
      messageItem({
        content: "nested only",
        messageId: "message-canonical-reader-nested",
        order: 1,
        role: "assistant"
      })
    ],
    runId: "run-canonical-reader-second",
    threadId,
    version: "messages-canonical-reader-nested"
  })

  await prisma.message.deleteMany({ where: { threadId } })
  const rows = await prisma.$transaction((tx) => listCanonicalMainThreadMessages(threadId, tx))
  assert.deepEqual(
    rows.map((row) => ({
      content: JSON.parse(row.content),
      messageId: row.message_id,
      role: row.role,
      runId: row.run_id,
      seq: row.seq
    })),
    [
      {
        content: "first assistant after update",
        messageId: "message-canonical-reader-first",
        role: "assistant",
        runId: "run-canonical-reader-second",
        seq: 1
      },
      {
        content: "stable assistant",
        messageId: "message-canonical-reader-stable",
        role: "assistant",
        runId: "run-canonical-reader-first",
        seq: 3
      }
    ]
  )
  assert.deepEqual(await prisma.message.findMany({ where: { threadId } }), [])
})

test("targeted canonical reader isolates requested latest message facts", async () => {
  const { createRun, createThread } = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  const {
    getCanonicalMainThreadMessage,
    listCanonicalMainThreadMessagesByIds,
    persistMessageStateVersion
  } = await import("../../src/main/db/message-state")
  const prisma = getPrismaClient()
  const threadId = "thread-targeted-canonical-message-reader"
  const runId = "run-targeted-canonical-message-reader"
  await createThread(threadId)
  await createRun(runId, threadId)

  const requested = messageItem({
    content: "requested",
    messageId: "message-targeted-requested",
    order: 1,
    role: "assistant"
  })
  const superseded = messageItem({
    content: "superseded-old",
    messageId: "message-targeted-superseded",
    order: 2,
    role: "assistant"
  })
  const unrelated = messageItem({
    content: "unrelated",
    messageId: "message-targeted-unrelated",
    order: 3,
    role: "assistant"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-targeted-reader-first",
    checkpointNs: "",
    messages: [requested, superseded, unrelated],
    runId,
    threadId,
    version: "messages-targeted-reader-first"
  })
  await persistMessageStateVersion({
    checkpointId: "checkpoint-targeted-reader-second",
    checkpointNs: "",
    messages: [
      requested,
      { ...superseded, content: JSON.stringify("superseded-latest"), rawHash: "latest-hash" },
      unrelated
    ],
    runId,
    threadId,
    version: "messages-targeted-reader-second"
  })

  const supersededEvents = await prisma.messageEvent.findMany({
    orderBy: { seq: "asc" },
    where: { messageId: superseded.messageId, threadId }
  })
  await prisma.messageEvent.update({
    data: { payload: "{" },
    where: { eventId: supersededEvents[0]!.eventId }
  })
  const unrelatedEvent = await prisma.messageEvent.findFirstOrThrow({
    orderBy: { seq: "desc" },
    where: { messageId: unrelated.messageId, threadId }
  })
  await prisma.messageEvent.update({
    data: { payload: "{" },
    where: { eventId: unrelatedEvent.eventId }
  })

  const rows = await prisma.$transaction((tx) =>
    listCanonicalMainThreadMessagesByIds(
      { messageIds: [superseded.messageId, requested.messageId], threadId },
      tx
    )
  )
  assert.deepEqual(
    rows.map((row) => ({ content: JSON.parse(row.content), messageId: row.message_id })),
    [
      { content: "requested", messageId: requested.messageId },
      { content: "superseded-latest", messageId: superseded.messageId }
    ]
  )
  assert.equal(
    await getCanonicalMainThreadMessage({ messageId: "message-targeted-missing", threadId }),
    null
  )
  await assert.rejects(
    listCanonicalMainThreadMessagesByIds({ messageIds: [unrelated.messageId], threadId }),
    SyntaxError
  )
})

test("canonical main message reader rejects malformed event and run ownership facts", async () => {
  const { createRun, createThread } = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  const { listCanonicalMainThreadMessages } = await import("../../src/main/db/message-state")
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const cases = [
    {
      event: { messageId: null, runId: null, type: "message.upsert" },
      expected: /no message identity/,
      suffix: "null-identity"
    },
    {
      event: { messageId: "message-unknown-type", runId: null, type: "message.unknown" },
      expected: /Unsupported message event type/,
      suffix: "unknown-type"
    },
    {
      event: {
        messageId: "message-cross-thread-run",
        runId: "run-canonical-reader-foreign",
        type: "message.upsert"
      },
      expected: /conflicting run ownership/,
      suffix: "cross-thread-run"
    }
  ] as const

  const foreignThreadId = "thread-canonical-reader-foreign"
  await createThread(foreignThreadId)
  await createRun("run-canonical-reader-foreign", foreignThreadId)

  for (const testCase of cases) {
    const threadId = `thread-canonical-reader-${testCase.suffix}`
    await createThread(threadId)
    const item = messageItem({
      content: testCase.suffix,
      messageId: testCase.event.messageId ?? `payload-${testCase.suffix}`,
      order: 1,
      role: "assistant"
    })
    await prisma.messageEvent.create({
      data: {
        checkpointId: `checkpoint-${testCase.suffix}`,
        checkpointNs: "",
        createdAt: now,
        eventId: `event-${testCase.suffix}`,
        messageId: testCase.event.messageId,
        payload: JSON.stringify(item),
        runId: testCase.event.runId,
        seq: 1,
        threadId,
        type: testCase.event.type
      }
    })
    await prisma.messageStateVersion.create({
      data: {
        checkpointNs: "",
        createdAt: now,
        stateHash: `state-${testCase.suffix}`,
        threadId,
        throughSeq: 1,
        version: `messages-${testCase.suffix}`
      }
    })
    await assert.rejects(listCanonicalMainThreadMessages(threadId), testCase.expected)
  }
})
