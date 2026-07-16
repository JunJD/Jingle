import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Command } from "@langchain/langgraph"
import { createContextRetrievalToolsMiddleware } from "@jingle/langchain-agent-harness/transitional"
import { createAgentContextInclusionToolHandlers } from "../../src/main/agent/context-retrieval-tool-handlers"
import { parseContextRetrievalToolResult } from "../../src/shared/context-retrieval-results"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

async function loadDbModules() {
  const db = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  const messageSearch = await import("../../src/main/db/message-search")
  return { ...db, ...messageSearch, getPrismaClient }
}

function createContextRetrievalToolsMiddlewareForTest(options: {
  runId: string
  threadId: string
}) {
  return createContextRetrievalToolsMiddleware({
    runId: options.runId,
    ...createAgentContextInclusionToolHandlers({
      threadId: options.threadId
    })
  })
}

test.before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-message-search-"))
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

  if (jingleHome) {
    await rm(jingleHome, { force: true, recursive: true })
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
          name: "Clipboard image",
          source: {
            kind: "url",
            url: imageUrl
          },
          type: "image"
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

test("message search rejects corrupt persisted content without indexing raw text", async () => {
  const { createThread, getPrismaClient, syncMessageSearchIndexFromSnapshot } =
    await loadDbModules()
  const threadId = "thread-corrupt-content-search"
  const warningArgs: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => warningArgs.push(args)

  try {
    await createThread(threadId)
    await syncMessageSearchIndexFromSnapshot(threadId, [
      {
        content: "secret raw corrupt payload",
        message_id: "message-corrupt",
        role: "user"
      },
      {
        content: JSON.stringify([{ content: "legacy raw payload", type: "text" }]),
        message_id: "message-noncanonical",
        role: "user"
      }
    ])

    const prisma = getPrismaClient()
    const rows = await prisma.message.findMany({
      orderBy: { messageId: "asc" },
      select: { content: true, messageId: true, searchText: true },
      where: { threadId }
    })
    const unavailable = JSON.stringify([
      {
        reason: "malformed",
        sourceType: "persisted_message_content",
        type: "unrenderable"
      }
    ])
    assert.deepEqual(rows, [
      { content: unavailable, messageId: "message-corrupt", searchText: "" },
      { content: unavailable, messageId: "message-noncanonical", searchText: "" }
    ])
    assert.equal(warningArgs.length, 2)
    assert.equal(JSON.stringify(warningArgs).includes("secret raw corrupt payload"), false)
    assert.equal(JSON.stringify(warningArgs).includes("legacy raw payload"), false)
  } finally {
    console.warn = originalWarn
  }
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
  const { createThread, getPrismaClient, syncMessageSearchIndexFromSnapshot } =
    await loadDbModules()
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

test("searchProjectedThreadMessages returns concrete FTS-backed history messages", async () => {
  const { createThread, searchProjectedThreadMessages, syncMessageSearchIndexFromSnapshot } =
    await loadDbModules()

  await createThread("history-search-source", {
    title: "History Search Source"
  })
  await syncMessageSearchIndexFromSnapshot("history-search-source", [
    {
      content: JSON.stringify("Runtime context evidence must come from schema state."),
      message_id: "message-runtime-evidence",
      role: "assistant"
    },
    {
      content: JSON.stringify("Unrelated note"),
      message_id: "message-unrelated",
      role: "user"
    }
  ])

  const matches = await searchProjectedThreadMessages({
    limit: 5,
    query: "runtime evidence"
  })

  assert.equal(matches[0]?.thread_id, "history-search-source")
  assert.equal(matches[0]?.message_id, "message-runtime-evidence")
  assert.equal(matches[0]?.thread_title, "History Search Source")
  assert.match(matches[0]?.search_text ?? "", /Runtime context evidence/)
})

test("search_history tool routes through thread digests before writing history message inclusions", async () => {
  const { createThread, syncMessageSearchIndexFromSnapshot, upsertReadyThreadDigest } =
    await loadDbModules()

  await createThread("history-tool-source", {
    title: "History Tool Source"
  })
  await createThread("history-tool-unrouted", {
    title: "History Tool Unrouted"
  })
  await syncMessageSearchIndexFromSnapshot("history-tool-source", [
    {
      content: JSON.stringify("Concrete history evidence should enter schema state."),
      message_id: "message-history-tool",
      role: "assistant"
    }
  ])
  await syncMessageSearchIndexFromSnapshot("history-tool-unrouted", [
    {
      content: JSON.stringify("Concrete history evidence belongs to the wrong session."),
      message_id: "message-history-unrouted",
      role: "assistant"
    }
  ])
  await upsertReadyThreadDigest({
    decisions: ["Use history tool source as the routed session."],
    messageCount: 1,
    openQuestions: [],
    projectedThroughSeq: 1,
    sourceHash: "digest-source-hash",
    summary: "History routing session contains concrete history evidence.",
    threadId: "history-tool-source",
    topics: ["history routing"]
  })

  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "run-history-tool",
    threadId: "current-thread"
  })
  const tools = middleware.tools ?? []
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "get_message_context",
    "get_trace_evidence",
    "search_history"
  ])
  const searchHistoryTool = tools.find((tool) => tool.name === "search_history")
  assert.ok(searchHistoryTool)
  const invokeSearchHistoryTool = searchHistoryTool.invoke as (
    input: unknown,
    config: unknown
  ) => Promise<unknown>

  const output = await invokeSearchHistoryTool.bind(searchHistoryTool)(
    {
      query: "history evidence"
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-search-history",
        name: "search_history",
        type: "tool_call"
      },
      toolCallId: "tool-call-search-history",
      state: {
        contextInclusions: []
      }
    }
  )

  assert.ok(output instanceof Command)
  const update = output.update as {
    contextInclusions?: Array<{
      sourceId: string
      sourceType: string
      target: { threadId?: string }
    }>
    messages?: Array<{ content: unknown; name?: string }>
  }
  assert.deepEqual(
    update.contextInclusions?.map((inclusion) => inclusion.sourceType),
    ["thread_digest", "history_message"]
  )
  assert.equal(update.contextInclusions?.[0]?.sourceId, "history-tool-source")
  assert.equal(update.contextInclusions?.[1]?.sourceId, "message-history-tool")
  assert.equal(update.contextInclusions?.[1]?.target.threadId, "history-tool-source")
  assert.equal(update.messages?.[0]?.name, "search_history")
  const result = parseContextRetrievalToolResult(update.messages?.[0]?.content)
  assert.equal(result?.kind, "history_search")
  assert.deepEqual(
    result.items.map((item) => item.type),
    ["thread_digest", "history_message"]
  )
  assert.equal(result.nextActions[0]?.tool, "get_message_context")
  assert.match(
    String(update.messages?.[0]?.content ?? ""),
    /Concrete history evidence should enter schema state/
  )
  assert.doesNotMatch(String(update.messages?.[0]?.content ?? ""), /wrong session/)
})

test("search_history tool falls back to message FTS with diagnostic when digests are missing", async () => {
  const { createThread, syncMessageSearchIndexFromSnapshot } = await loadDbModules()

  await createThread("history-tool-no-digest", {
    title: "History Tool No Digest"
  })
  await syncMessageSearchIndexFromSnapshot("history-tool-no-digest", [
    {
      content: JSON.stringify("Missing digest message hit should still return concrete evidence."),
      message_id: "message-history-no-digest",
      role: "assistant"
    }
  ])

  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "run-history-tool-no-digest",
    threadId: "current-thread"
  })
  const searchHistoryTool = middleware.tools?.find((tool) => tool.name === "search_history")
  assert.ok(searchHistoryTool)
  const invokeSearchHistoryTool = searchHistoryTool.invoke as (
    input: unknown,
    config: unknown
  ) => Promise<unknown>

  const output = await invokeSearchHistoryTool.bind(searchHistoryTool)(
    {
      query: "missing digest concrete evidence"
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-search-history-no-digest",
        name: "search_history",
        type: "tool_call"
      },
      toolCallId: "tool-call-search-history-no-digest",
      state: {
        contextInclusions: []
      }
    }
  )

  assert.ok(output instanceof Command)
  const update = output.update as {
    contextInclusions?: Array<{ sourceId: string; sourceType: string }>
    messages?: Array<{ content: unknown; name?: string }>
  }
  assert.deepEqual(
    update.contextInclusions?.map((inclusion) => inclusion.sourceType),
    ["history_message"]
  )
  assert.equal(update.contextInclusions?.[0]?.sourceId, "message-history-no-digest")
  const result = parseContextRetrievalToolResult(update.messages?.[0]?.content)
  assert.equal(result?.kind, "history_search")
  assert.deepEqual(result.diagnostics, ["No thread digest matches; searched message FTS directly."])
})

test("search_history tool respects explicit thread scope for digest and message matches", async () => {
  const { createThread, syncMessageSearchIndexFromSnapshot, upsertReadyThreadDigest } =
    await loadDbModules()

  await createThread("history-tool-scoped", {
    title: "History Tool Scoped"
  })
  await createThread("history-tool-other-scope", {
    title: "History Tool Other Scope"
  })
  await syncMessageSearchIndexFromSnapshot("history-tool-scoped", [
    {
      content: JSON.stringify("Scoped history evidence should be returned."),
      message_id: "message-history-scoped",
      role: "assistant"
    }
  ])
  await syncMessageSearchIndexFromSnapshot("history-tool-other-scope", [
    {
      content: JSON.stringify("Scoped history evidence belongs to the other thread."),
      message_id: "message-history-other-scope",
      role: "assistant"
    }
  ])
  await upsertReadyThreadDigest({
    decisions: [],
    messageCount: 1,
    openQuestions: [],
    projectedThroughSeq: 1,
    sourceHash: "scoped-digest-hash",
    summary: "Scoped history evidence appears in this selected thread.",
    threadId: "history-tool-scoped",
    topics: []
  })
  await upsertReadyThreadDigest({
    decisions: [],
    messageCount: 1,
    openQuestions: [],
    projectedThroughSeq: 1,
    sourceHash: "other-scope-digest-hash",
    summary: "Scoped history evidence appears in a different thread.",
    threadId: "history-tool-other-scope",
    topics: []
  })

  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "run-history-tool-scoped",
    threadId: "current-thread"
  })
  const searchHistoryTool = middleware.tools?.find((tool) => tool.name === "search_history")
  assert.ok(searchHistoryTool)
  const invokeSearchHistoryTool = searchHistoryTool.invoke as (
    input: unknown,
    config: unknown
  ) => Promise<unknown>

  const output = await invokeSearchHistoryTool.bind(searchHistoryTool)(
    {
      query: "scoped history evidence",
      threadId: "history-tool-scoped"
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-search-history-scoped",
        name: "search_history",
        type: "tool_call"
      },
      toolCallId: "tool-call-search-history-scoped",
      state: {
        contextInclusions: []
      }
    }
  )

  assert.ok(output instanceof Command)
  const update = output.update as {
    contextInclusions?: Array<{
      sourceId: string
      sourceType: string
      target: { threadId?: string }
    }>
    messages?: Array<{ content: unknown; name?: string }>
  }
  assert.deepEqual(
    update.contextInclusions?.map((inclusion) => inclusion.sourceId),
    ["history-tool-scoped", "message-history-scoped"]
  )
  assert.equal(update.contextInclusions?.[1]?.target.threadId, "history-tool-scoped")
  const result = parseContextRetrievalToolResult(update.messages?.[0]?.content)
  assert.equal(result?.kind, "history_search")
  assert.equal(result.items[0]?.type, "thread_digest")
  assert.equal(result.items[1]?.type, "history_message")
  assert.doesNotMatch(String(update.messages?.[0]?.content ?? ""), /other thread/)
})

test("search_history tool returns no inclusion when digest and message search are empty", async () => {
  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "run-history-tool-empty",
    threadId: "current-thread"
  })
  const searchHistoryTool = middleware.tools?.find((tool) => tool.name === "search_history")
  assert.ok(searchHistoryTool)
  const invokeSearchHistoryTool = searchHistoryTool.invoke as (
    input: unknown,
    config: unknown
  ) => Promise<unknown>

  const output = await invokeSearchHistoryTool.bind(searchHistoryTool)(
    {
      query: "nothing should match this phase five query"
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-search-history-empty",
        name: "search_history",
        type: "tool_call"
      },
      toolCallId: "tool-call-search-history-empty",
      state: {
        contextInclusions: []
      }
    }
  )

  assert.ok(!(output instanceof Command))
  const result = parseContextRetrievalToolResult((output as { content?: unknown }).content)
  assert.equal(result?.kind, "history_search")
  assert.equal(result.status, "empty")
  assert.equal(result.items.length, 0)
})

test("get_message_context tool expands a bounded window across projected thread messages", async () => {
  const { createThread, syncMessageSearchIndexFromSnapshot } = await loadDbModules()

  await createThread("message-context-source", {
    title: "Message Context Source"
  })
  await createThread("message-context-other", {
    title: "Message Context Other"
  })
  await syncMessageSearchIndexFromSnapshot("message-context-source", [
    {
      content: JSON.stringify("Earlier source context"),
      message_id: "message-context-before",
      role: "user"
    },
    {
      content: JSON.stringify("Focused source context"),
      message_id: "message-context-focus",
      role: "assistant"
    },
    {
      content: JSON.stringify("Later source context"),
      message_id: "message-context-after",
      role: "user"
    }
  ])
  await syncMessageSearchIndexFromSnapshot("message-context-other", [
    {
      content: JSON.stringify("Wrong thread context"),
      message_id: "message-context-focus",
      role: "assistant"
    }
  ])

  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "run-message-context",
    threadId: "current-thread"
  })
  const messageContextTool = middleware.tools?.find((tool) => tool.name === "get_message_context")
  assert.ok(messageContextTool)
  const invokeMessageContextTool = messageContextTool.invoke as (
    input: unknown,
    config: unknown
  ) => Promise<unknown>

  const output = await invokeMessageContextTool.bind(messageContextTool)(
    {
      after: 1,
      before: 1,
      messageId: "message-context-focus",
      threadId: "message-context-source"
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-message-context",
        name: "get_message_context",
        type: "tool_call"
      },
      toolCallId: "tool-call-message-context",
      state: {
        contextInclusions: []
      }
    }
  )

  assert.ok(output instanceof Command)
  const update = output.update as {
    contextInclusions?: Array<{
      preview: string
      sourceId: string
      sourceType: string
      target: { messageId?: string; threadId?: string }
    }>
    messages?: Array<{ content: unknown; name?: string }>
  }
  assert.deepEqual(
    update.contextInclusions?.map((inclusion) => inclusion.sourceType),
    ["history_message"]
  )
  assert.equal(update.contextInclusions?.[0]?.sourceId, "message-context-focus")
  assert.equal(update.contextInclusions?.[0]?.target.threadId, "message-context-source")
  assert.equal(update.contextInclusions?.[0]?.target.messageId, "message-context-focus")
  assert.equal(update.contextInclusions?.[0]?.preview, "Focused source context")
  assert.equal(update.messages?.[0]?.name, "get_message_context")
  const result = parseContextRetrievalToolResult(update.messages?.[0]?.content)
  assert.equal(result?.kind, "message_context")
  assert.deepEqual(
    result.items.map((item) => item.messageId),
    ["message-context-before", "message-context-focus", "message-context-after"]
  )
  assert.match(String(update.messages?.[0]?.content ?? ""), /Earlier source context/)
  assert.match(String(update.messages?.[0]?.content ?? ""), /Focused source context/)
  assert.match(String(update.messages?.[0]?.content ?? ""), /Later source context/)
  assert.doesNotMatch(String(update.messages?.[0]?.content ?? ""), /Wrong thread context/)
})

test("get_message_context tool returns no inclusion when the projected message is missing", async () => {
  const { createThread, syncMessageSearchIndexFromSnapshot } = await loadDbModules()

  await createThread("message-context-missing", {
    title: "Message Context Missing"
  })
  await syncMessageSearchIndexFromSnapshot("message-context-missing", [
    {
      content: JSON.stringify("Existing context"),
      message_id: "message-context-existing",
      role: "assistant"
    }
  ])

  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "run-message-context-missing",
    threadId: "current-thread"
  })
  const messageContextTool = middleware.tools?.find((tool) => tool.name === "get_message_context")
  assert.ok(messageContextTool)
  const invokeMessageContextTool = messageContextTool.invoke as (
    input: unknown,
    config: unknown
  ) => Promise<unknown>

  const output = await invokeMessageContextTool.bind(messageContextTool)(
    {
      messageId: "missing-message",
      threadId: "message-context-missing"
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-message-context-missing",
        name: "get_message_context",
        type: "tool_call"
      },
      toolCallId: "tool-call-message-context-missing",
      state: {
        contextInclusions: []
      }
    }
  )

  assert.ok(!(output instanceof Command))
  const result = parseContextRetrievalToolResult((output as { content?: unknown }).content)
  assert.equal(result?.kind, "message_context")
  assert.equal(result.status, "empty")
  assert.equal(result.focus.messageId, "missing-message")
})

test("get_message_context never exposes corrupt persisted message content", async () => {
  const { createThread, getPrismaClient, syncMessageSearchIndexFromSnapshot } =
    await loadDbModules()
  const threadId = "message-context-corrupt"
  await createThread(threadId)
  await syncMessageSearchIndexFromSnapshot(threadId, [
    {
      content: JSON.stringify("initial safe content"),
      message_id: "message-context-corrupt-focus",
      role: "assistant"
    }
  ])
  await getPrismaClient().message.update({
    data: { content: "secret raw corrupt payload" },
    where: {
      threadId_messageId: {
        messageId: "message-context-corrupt-focus",
        threadId
      }
    }
  })

  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "run-message-context-corrupt",
    threadId: "current-thread"
  })
  const tool = middleware.tools?.find((candidate) => candidate.name === "get_message_context")
  assert.ok(tool)
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args)
  try {
    const output = await (
      tool.invoke as (input: unknown, config: unknown) => Promise<unknown>
    ).call(
      tool,
      { messageId: "message-context-corrupt-focus", threadId },
      {
        toolCall: {
          args: {},
          id: "tool-call-message-context-corrupt",
          name: "get_message_context",
          type: "tool_call"
        },
        toolCallId: "tool-call-message-context-corrupt",
        state: { contextInclusions: [] }
      }
    )
    assert.ok(output instanceof Command)
    const serialized = JSON.stringify(output.update)
    assert.match(serialized, /Message content unavailable/)
    assert.doesNotMatch(serialized, /secret raw corrupt payload/)
    assert.equal(warnings.length >= 1, true)
    assert.doesNotMatch(JSON.stringify(warnings), /secret raw corrupt payload/)
  } finally {
    console.warn = originalWarn
  }
})

test("get_trace_evidence tool retrieves a trace step by traceStepId", async () => {
  const {
    appendAgentEvent,
    createRun,
    createThread,
    flushAgentTraceProjection,
    formatAgentTraceStepId,
    getAgentTraceSteps
  } = await loadDbModules()
  const threadId = "trace-evidence-step-thread"
  const runId = "trace-evidence-step-run"

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: {
      model: "gpt-test",
      permissionMode: "default",
      source: "invoke",
      userMessageId: "user-message-1"
    },
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    payload: {
      args: { query: "history evidence" },
      messageId: "assistant-trace",
      toolCallId: "tool-call-trace-step",
      toolName: "search_history"
    },
    runId,
    threadId,
    type: "tool.call.started"
  })
  await appendAgentEvent({
    payload: {
      messageId: "tool-message-trace",
      output: "Trace step output should be provided to the model.",
      status: "completed",
      toolCallId: "tool-call-trace-step",
      toolName: "search_history"
    },
    runId,
    threadId,
    type: "tool.call.completed"
  })
  await flushAgentTraceProjection()
  const step = (await getAgentTraceSteps(runId))[0]
  assert.ok(step)

  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "current-run-trace-step",
    threadId: "current-thread"
  })
  const traceEvidenceTool = middleware.tools?.find((tool) => tool.name === "get_trace_evidence")
  assert.ok(traceEvidenceTool)
  const invokeTraceEvidenceTool = traceEvidenceTool.invoke as (
    input: unknown,
    config: unknown
  ) => Promise<unknown>

  const output = await invokeTraceEvidenceTool.bind(traceEvidenceTool)(
    {
      traceStepId: formatAgentTraceStepId(runId, step.step_index)
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-get-trace-step",
        name: "get_trace_evidence",
        type: "tool_call"
      },
      toolCallId: "tool-call-get-trace-step",
      state: {
        contextInclusions: []
      }
    }
  )

  assert.ok(output instanceof Command)
  const update = output.update as {
    contextInclusions?: Array<{
      runId: string
      sourceId: string
      sourceType: string
      target: { runId?: string; threadId?: string; traceStepId?: string }
    }>
    messages?: Array<{ content: unknown; name?: string }>
  }
  assert.deepEqual(
    update.contextInclusions?.map((inclusion) => inclusion.sourceType),
    ["trace_step"]
  )
  assert.equal(update.contextInclusions?.[0]?.runId, "current-run-trace-step")
  assert.equal(update.contextInclusions?.[0]?.sourceId, `${runId}:${step.step_index}`)
  assert.equal(update.contextInclusions?.[0]?.target.runId, runId)
  assert.equal(update.contextInclusions?.[0]?.target.threadId, threadId)
  const result = parseContextRetrievalToolResult(update.messages?.[0]?.content)
  assert.equal(result?.kind, "trace_evidence")
  assert.equal(result.step?.toolName, "search_history")
  assert.equal(result.trace.runId, runId)
  assert.match(String(update.messages?.[0]?.content ?? ""), /Trace step output should be provided/)
})

test("get_trace_evidence tool retrieves a trace step by toolCallId and links artifacts", async () => {
  const { appendAgentEvent, createRun, createThread, flushAgentTraceProjection } =
    await loadDbModules()
  const { presentArtifacts } = await import("../../src/main/artifacts/service")
  const threadId = "trace-evidence-tool-thread"
  const runId = "trace-evidence-tool-run"

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: {
      model: "gpt-test",
      permissionMode: "default",
      source: "invoke",
      userMessageId: "user-message-1"
    },
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    payload: {
      args: { path: "README.md" },
      messageId: "assistant-artifact",
      toolCallId: "tool-call-artifact",
      toolName: "present_artifacts"
    },
    runId,
    threadId,
    type: "tool.call.started"
  })
  await appendAgentEvent({
    payload: {
      messageId: "tool-message-artifact",
      output: "Presented artifact output",
      status: "completed",
      toolCallId: "tool-call-artifact",
      toolName: "present_artifacts"
    },
    runId,
    threadId,
    type: "tool.call.completed"
  })
  const artifactResult = await presentArtifacts({
    artifacts: [
      {
        artifactKey: "tool-call-artifact:0",
        format: "plain",
        kind: "summary",
        text: "Artifact body should remain owned by artifact storage.",
        title: "Trace linked summary"
      }
    ],
    idempotencyKey: "tool-call-artifact",
    runId,
    threadId,
    toolCallId: "tool-call-artifact"
  })
  assert.equal(artifactResult.type, "stored")
  await flushAgentTraceProjection()

  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "current-run-trace-tool",
    threadId: "current-thread"
  })
  const traceEvidenceTool = middleware.tools?.find((tool) => tool.name === "get_trace_evidence")
  assert.ok(traceEvidenceTool)
  const invokeTraceEvidenceTool = traceEvidenceTool.invoke as (
    input: unknown,
    config: unknown
  ) => Promise<unknown>

  const output = await invokeTraceEvidenceTool.bind(traceEvidenceTool)(
    {
      runId,
      toolCallId: "tool-call-artifact"
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-get-trace-tool",
        name: "get_trace_evidence",
        type: "tool_call"
      },
      toolCallId: "tool-call-get-trace-tool",
      state: {
        contextInclusions: []
      }
    }
  )

  assert.ok(output instanceof Command)
  const update = output.update as {
    contextInclusions?: Array<{
      sourceId: string
      sourceType: string
      target: { artifactId?: string }
    }>
    messages?: Array<{ content: unknown; name?: string }>
  }
  assert.deepEqual(
    update.contextInclusions?.map((inclusion) => inclusion.sourceType),
    ["trace_step", "artifact"]
  )
  assert.equal(update.contextInclusions?.[1]?.sourceId, artifactResult.artifacts[0]?.id)
  assert.equal(update.contextInclusions?.[1]?.target.artifactId, artifactResult.artifacts[0]?.id)
  const result = parseContextRetrievalToolResult(update.messages?.[0]?.content)
  assert.equal(result?.kind, "trace_evidence")
  assert.equal(result.artifacts[0]?.artifactId, artifactResult.artifacts[0]?.id)
  assert.match(String(update.messages?.[0]?.content ?? ""), /Trace linked summary/)
  assert.match(String(update.messages?.[0]?.content ?? ""), /Artifact body should remain owned/)
})

test("get_trace_evidence tool does not link an explicit artifact from another source run", async () => {
  const { appendAgentEvent, createRun, createThread, flushAgentTraceProjection } =
    await loadDbModules()
  const { presentArtifacts } = await import("../../src/main/artifacts/service")
  const threadId = "trace-evidence-cross-artifact-thread"
  const runId = "trace-evidence-cross-artifact-run"
  const otherThreadId = "trace-evidence-cross-artifact-other-thread"
  const otherRunId = "trace-evidence-cross-artifact-other-run"

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: {
      model: "gpt-test",
      permissionMode: "default",
      source: "invoke",
      userMessageId: "user-message-1"
    },
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    payload: {
      args: { cmd: "pwd" },
      messageId: "assistant-cross-artifact",
      toolCallId: "tool-call-cross-artifact",
      toolName: "execute"
    },
    runId,
    threadId,
    type: "tool.call.started"
  })
  await appendAgentEvent({
    payload: {
      messageId: "tool-message-cross-artifact",
      output: "Trace output belongs to the selected source run.",
      status: "completed",
      toolCallId: "tool-call-cross-artifact",
      toolName: "execute"
    },
    runId,
    threadId,
    type: "tool.call.completed"
  })
  await createThread(otherThreadId)
  await createRun(otherRunId, otherThreadId)
  const otherArtifactResult = await presentArtifacts({
    artifacts: [
      {
        artifactKey: "cross-artifact:0",
        format: "plain",
        kind: "summary",
        text: "This artifact belongs to another run and must not be linked.",
        title: "Cross-run artifact"
      }
    ],
    idempotencyKey: "cross-artifact",
    runId: otherRunId,
    threadId: otherThreadId,
    toolCallId: "tool-call-cross-artifact"
  })
  assert.equal(otherArtifactResult.type, "stored")
  await flushAgentTraceProjection()

  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "current-run-cross-artifact",
    threadId: "current-thread"
  })
  const traceEvidenceTool = middleware.tools?.find((tool) => tool.name === "get_trace_evidence")
  assert.ok(traceEvidenceTool)
  const invokeTraceEvidenceTool = traceEvidenceTool.invoke as (
    input: unknown,
    config: unknown
  ) => Promise<unknown>

  const output = await invokeTraceEvidenceTool.bind(traceEvidenceTool)(
    {
      artifactId: otherArtifactResult.artifacts[0]?.id,
      runId,
      toolCallId: "tool-call-cross-artifact"
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-get-cross-artifact",
        name: "get_trace_evidence",
        type: "tool_call"
      },
      toolCallId: "tool-call-get-cross-artifact",
      state: {
        contextInclusions: []
      }
    }
  )

  assert.ok(output instanceof Command)
  const update = output.update as {
    contextInclusions?: Array<{ sourceId: string; sourceType: string }>
    messages?: Array<{ content: unknown; name?: string }>
  }
  assert.deepEqual(
    update.contextInclusions?.map((inclusion) => inclusion.sourceType),
    ["trace_step"]
  )
  const result = parseContextRetrievalToolResult(update.messages?.[0]?.content)
  assert.equal(result?.kind, "trace_evidence")
  assert.equal(result.artifacts.length, 0)
  assert.doesNotMatch(String(update.messages?.[0]?.content ?? ""), /Cross-run artifact/)
  assert.doesNotMatch(
    String(update.messages?.[0]?.content ?? ""),
    /another run and must not be linked/
  )
})

test("get_trace_evidence tool returns no inclusion when trace output blob is missing", async () => {
  const {
    appendAgentEvent,
    createRun,
    createThread,
    flushAgentTraceProjection,
    getAgentTraceSteps,
    getPrismaClient
  } = await loadDbModules()
  const threadId = "trace-evidence-missing-blob-thread"
  const runId = "trace-evidence-missing-blob-run"

  await createThread(threadId)
  await createRun(runId, threadId)
  await appendAgentEvent({
    payload: {
      model: "gpt-test",
      permissionMode: "default",
      source: "invoke",
      userMessageId: "user-message-1"
    },
    runId,
    threadId,
    type: "run.started"
  })
  await appendAgentEvent({
    payload: {
      args: { cmd: "pwd" },
      messageId: "assistant-missing-blob",
      toolCallId: "tool-call-missing-blob",
      toolName: "execute"
    },
    runId,
    threadId,
    type: "tool.call.started"
  })
  await appendAgentEvent({
    payload: {
      messageId: "tool-message-missing-blob",
      output: "output that will be deleted",
      status: "completed",
      toolCallId: "tool-call-missing-blob",
      toolName: "execute"
    },
    runId,
    threadId,
    type: "tool.call.completed"
  })
  await flushAgentTraceProjection()
  const step = (await getAgentTraceSteps(runId))[0]
  assert.ok(step?.output_blob_id)
  await getPrismaClient().agentTraceBlob.delete({
    where: {
      blobId: step.output_blob_id
    }
  })

  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "current-run-missing-blob",
    threadId: "current-thread"
  })
  const traceEvidenceTool = middleware.tools?.find((tool) => tool.name === "get_trace_evidence")
  assert.ok(traceEvidenceTool)
  const invokeTraceEvidenceTool = traceEvidenceTool.invoke as (
    input: unknown,
    config: unknown
  ) => Promise<unknown>

  const output = await invokeTraceEvidenceTool.bind(traceEvidenceTool)(
    {
      runId,
      toolCallId: "tool-call-missing-blob"
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-get-trace-missing-blob",
        name: "get_trace_evidence",
        type: "tool_call"
      },
      toolCallId: "tool-call-get-trace-missing-blob",
      state: {
        contextInclusions: []
      }
    }
  )

  assert.ok(!(output instanceof Command))
  const result = parseContextRetrievalToolResult((output as { content?: unknown }).content)
  assert.equal(result?.kind, "trace_evidence")
  assert.equal(result.status, "unavailable")
  assert.match(result.summary, new RegExp(`Trace output blob not found: ${step.output_blob_id}`))
})

test("get_trace_evidence tool retrieves artifact-only evidence without a trace step", async () => {
  const { createRun, createThread } = await loadDbModules()
  const { presentArtifacts } = await import("../../src/main/artifacts/service")
  const threadId = "trace-evidence-artifact-only-thread"
  const runId = "trace-evidence-artifact-only-run"

  await createThread(threadId)
  await createRun(runId, threadId)
  const artifactResult = await presentArtifacts({
    artifacts: [
      {
        artifactKey: "artifact-only:0",
        format: "plain",
        kind: "summary",
        text: "Artifact-only body",
        title: "Artifact-only summary"
      }
    ],
    idempotencyKey: "artifact-only",
    runId,
    threadId,
    toolCallId: "tool-call-artifact-only"
  })
  assert.equal(artifactResult.type, "stored")
  const artifact = artifactResult.artifacts[0]!

  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "current-run-artifact-only",
    threadId: "current-thread"
  })
  const traceEvidenceTool = middleware.tools?.find((tool) => tool.name === "get_trace_evidence")
  assert.ok(traceEvidenceTool)
  const invokeTraceEvidenceTool = traceEvidenceTool.invoke as (
    input: unknown,
    config: unknown
  ) => Promise<unknown>

  const output = await invokeTraceEvidenceTool.bind(traceEvidenceTool)(
    {
      artifactId: artifact.id
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-get-artifact-only",
        name: "get_trace_evidence",
        type: "tool_call"
      },
      toolCallId: "tool-call-get-artifact-only",
      state: {
        contextInclusions: []
      }
    }
  )

  assert.ok(output instanceof Command)
  const update = output.update as {
    contextInclusions?: Array<{
      sourceId: string
      sourceType: string
      target: { artifactId?: string }
    }>
    messages?: Array<{ content: unknown; name?: string }>
  }
  assert.deepEqual(
    update.contextInclusions?.map((inclusion) => inclusion.sourceType),
    ["artifact"]
  )
  assert.equal(update.contextInclusions?.[0]?.sourceId, artifact.id)
  assert.equal(update.contextInclusions?.[0]?.target.artifactId, artifact.id)
  const result = parseContextRetrievalToolResult(update.messages?.[0]?.content)
  assert.equal(result?.kind, "trace_evidence")
  assert.equal(result.step, null)
  assert.equal(result.artifacts[0]?.artifactId, artifact.id)
  assert.match(String(update.messages?.[0]?.content ?? ""), /Artifact-only body/)
})

test("get_trace_evidence tool does not expose an explicit artifact when the trace selector is missing", async () => {
  const { createRun, createThread } = await loadDbModules()
  const { presentArtifacts } = await import("../../src/main/artifacts/service")
  const threadId = "trace-evidence-missing-trace-artifact-thread"
  const runId = "trace-evidence-missing-trace-artifact-run"

  await createThread(threadId)
  await createRun(runId, threadId)
  const artifactResult = await presentArtifacts({
    artifacts: [
      {
        artifactKey: "missing-trace-artifact:0",
        format: "plain",
        kind: "summary",
        text: "This artifact must not appear when trace selection fails.",
        title: "Missing trace artifact"
      }
    ],
    idempotencyKey: "missing-trace-artifact",
    runId,
    threadId,
    toolCallId: "tool-call-missing-trace-artifact"
  })
  assert.equal(artifactResult.type, "stored")
  const artifact = artifactResult.artifacts[0]!

  const middleware = createContextRetrievalToolsMiddlewareForTest({
    runId: "current-run-missing-trace-artifact",
    threadId: "current-thread"
  })
  const traceEvidenceTool = middleware.tools?.find((tool) => tool.name === "get_trace_evidence")
  assert.ok(traceEvidenceTool)
  const invokeTraceEvidenceTool = traceEvidenceTool.invoke as (
    input: unknown,
    config: unknown
  ) => Promise<unknown>

  const output = await invokeTraceEvidenceTool.bind(traceEvidenceTool)(
    {
      artifactId: artifact.id,
      runId: "missing-run",
      toolCallId: "missing-tool-call"
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-get-missing-trace-artifact",
        name: "get_trace_evidence",
        type: "tool_call"
      },
      toolCallId: "tool-call-get-missing-trace-artifact",
      state: {
        contextInclusions: []
      }
    }
  )

  assert.ok(!(output instanceof Command))
  const result = parseContextRetrievalToolResult((output as { content?: unknown }).content)
  assert.equal(result?.kind, "trace_evidence")
  assert.equal(result.status, "unavailable")
  assert.equal(result.artifacts.length, 0)
  assert.doesNotMatch(String((output as { content?: unknown }).content ?? ""), /must not appear/)
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
