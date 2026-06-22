import assert from "node:assert/strict"
import test from "node:test"
import { ToolMessage } from "@langchain/core/messages"
import { GraphInterrupt } from "@langchain/langgraph"
import { createAgentContextInclusionMiddleware } from "../../src/main/agent/agent-context-inclusion-middleware"
import { agentContextInclusionMiddlewareInternals } from "../../src/main/agent/agent-context-inclusion-middleware"
import type { AgentTraceBlobRow, AgentTraceStepRow, AgentTraceSummaryRow } from "../../src/main/db"
import type { MessageProjectionRow } from "../../src/main/db/message-state"
import type { ArtifactRecord } from "../../src/shared/artifacts"
import type { ThreadDigestSearchMatch } from "../../src/shared/thread-digest"
import { parseContextRetrievalToolResult } from "../../src/shared/context-retrieval-results"

function createContextMiddleware() {
  return createAgentContextInclusionMiddleware({
    runId: "run-1",
    threadId: "thread-1"
  })
}

function createToolCallRequest(input: {
  args?: Record<string, unknown>
  id?: string
  name?: string
}) {
  return {
    toolCall: {
      args: input.args ?? {},
      id: input.id ?? "tool-call-1",
      name: input.name ?? "search_history",
      type: "tool_call"
    }
  }
}

test("context inclusion middleware exposes only history and evidence retrieval tools", () => {
  const middleware = createContextMiddleware()

  assert.deepEqual(
    (middleware.tools ?? []).map((tool) => tool.name).sort(),
    ["get_message_context", "get_trace_evidence", "search_history"]
  )
})

test("search_history tool content includes retrieved message bodies for the model", () => {
  const message: MessageProjectionRow = {
    content: JSON.stringify("History says context evidence belongs to runtime state."),
    created_at: 1,
    kind: "message",
    message_id: "message-1",
    metadata: null,
    name: null,
    raw_message: "{}",
    role: "assistant",
    run_id: null,
    seq: 1,
    thread_id: "thread-1",
    tool_call_id: null,
    tool_calls: null
  }
  const content = agentContextInclusionMiddlewareInternals.formatRetrievedHistoryToolContent({
    digests: [],
    messages: [
      {
        message,
        text: "History says context evidence belongs to runtime state."
      }
    ],
    query: "context evidence"
  })

  const result = parseContextRetrievalToolResult(content)
  assert.equal(result?.kind, "history_search")
  assert.equal(result.status, "ok")
  assert.deepEqual(result.diagnostics, ["No thread digest matches; searched message FTS directly."])
  assert.equal(result.items[0]?.type, "history_message")
  assert.match(content, /History says context evidence belongs to runtime state/)
  assert.equal(result.nextActions[0]?.tool, "get_message_context")
})

test("context retrieval result parser rejects incomplete tool result payloads", () => {
  assert.equal(
    parseContextRetrievalToolResult(
      JSON.stringify({
        kind: "history_search",
        status: "ok"
      })
    ),
    null
  )
})

test("search_history tool content includes thread digest routing context for the model", () => {
  const digest: ThreadDigestSearchMatch = {
    decisions: ["Keep evidence in schema state."],
    generatedAt: 1,
    messageCount: 2,
    openQuestions: [],
    projectedThroughSeq: 2,
    projectionError: null,
    rank: 0,
    searchText: "runtime evidence",
    sourceHash: "hash",
    status: "ready",
    summary: "Runtime evidence must come from contextInclusions.",
    threadId: "thread-1",
    threadTitle: "Runtime Evidence",
    threadUpdatedAt: 1,
    topics: ["runtime state"],
    updatedAt: 1
  }
  const content = agentContextInclusionMiddlewareInternals.formatRetrievedHistoryToolContent({
    digests: [digest],
    messages: [],
    query: "runtime evidence"
  })

  const result = parseContextRetrievalToolResult(content)
  assert.equal(result?.kind, "history_search")
  assert.equal(result.items[0]?.type, "thread_digest")
  assert.equal(result.items[0]?.threadId, "thread-1")
  assert.match(content, /Runtime evidence must come from contextInclusions/)
  assert.equal(result.nextActions.length, 0)
})

test("search_history schema accepts the documented maximum limit", () => {
  const parsed = agentContextInclusionMiddlewareInternals.searchHistorySchema.parse({
    limit: 20,
    query: "生成",
    threadId: "thread-1"
  })

  assert.equal(parsed.limit, 20)
})

test("context retrieval tool schema errors are returned as error tool messages", async () => {
  const middleware = createContextMiddleware()

  const result = (await middleware.wrapToolCall!(
    createToolCallRequest({
      args: {
        limit: 25,
        query: "生成图片 图片生成 图像 editImage generateImage"
      },
      id: "tool-call-search-history"
    }) as never,
    async () => {
      throw new Error("Received tool input did not match expected schema\n\n✖ Invalid input\n  → at limit")
    }
  )) as ToolMessage

  assert.equal(result.name, "search_history")
  assert.equal(result.tool_call_id, "tool-call-search-history")
  assert.equal(result.status, "error")
  assert.match(String(result.content), /Context retrieval tool 'search_history' failed/)
  assert.match(String(result.content), /at limit/)
})

test("context retrieval tool error middleware preserves graph interrupts", async () => {
  const middleware = createContextMiddleware()
  const interrupt = new GraphInterrupt([])

  await assert.rejects(
    async () =>
      middleware.wrapToolCall!(createToolCallRequest({ name: "search_history" }) as never, async () => {
        throw interrupt
      }),
    (error) => error === interrupt
  )
})

test("get_message_context tool content includes a bounded transcript window", () => {
  const createRow = (messageId: string, role: string, content: string): MessageProjectionRow => ({
    content: JSON.stringify(content),
    created_at: 1,
    kind: "message",
    message_id: messageId,
    metadata: null,
    name: null,
    raw_message: "{}",
    role,
    run_id: messageId === "message-2" ? "run-message-context" : null,
    seq: Number(messageId.replace("message-", "")),
    thread_id: "thread-1",
    tool_call_id: null,
    tool_calls: null
  })
  const content = agentContextInclusionMiddlewareInternals.formatRetrievedMessageToolContent({
    after: 1,
    before: 1,
    focusMessageId: "message-2",
    messages: [
      {
        message: createRow("message-1", "user", "Before context"),
        text: "Before context"
      },
      {
        message: createRow("message-2", "assistant", "Focus context"),
        text: "Focus context"
      },
      {
        message: createRow("message-3", "user", "After context"),
        text: "After context"
      }
    ],
    threadId: "thread-1"
  })

  const result = parseContextRetrievalToolResult(content)
  assert.equal(result?.kind, "message_context")
  assert.equal(result.focus.messageId, "message-2")
  assert.equal(result.focus.runId, "run-message-context")
  assert.deepEqual(result.window, { after: 1, before: 1 })
  assert.deepEqual(
    result.items.map((item) => [item.role, item.messageId]),
    [
      ["user", "message-1"],
      ["assistant", "message-2"],
      ["user", "message-3"]
    ]
  )
  assert.match(content, /After context/)
})

test("getProjectedMessageWindow returns the focus message with requested neighbors", () => {
  const rows = Array.from({ length: 5 }, (_, index): MessageProjectionRow => {
    const id = `message-${index + 1}`
    return {
      content: JSON.stringify(id),
      created_at: index,
      kind: "message",
      message_id: id,
      metadata: null,
      name: null,
      raw_message: "{}",
      role: index % 2 === 0 ? "user" : "assistant",
      run_id: null,
      seq: index + 1,
      thread_id: "thread-1",
      tool_call_id: null,
      tool_calls: null
    }
  })

  assert.deepEqual(
    agentContextInclusionMiddlewareInternals
      .getProjectedMessageWindow({
        after: 1,
        before: 2,
        focusMessageId: "message-3",
        messages: rows
      })
      .map((row) => row.message_id),
    ["message-1", "message-2", "message-3", "message-4"]
  )
  assert.deepEqual(
    agentContextInclusionMiddlewareInternals.getProjectedMessageWindow({
      after: 2,
      before: 2,
      focusMessageId: "missing-message",
      messages: rows
    }),
    []
  )
})

test("get_trace_evidence tool content includes bounded trace blobs", () => {
  const trace: AgentTraceSummaryRow = {
    completed_at: 3,
    completion_reason: null,
    error_message: null,
    error_type: null,
    has_gap: false,
    model: "gpt-test",
    projected_through_seq: 3,
    provider: "openai",
    run_id: "run-1",
    started_at: 1,
    status: "completed",
    thread_id: "thread-1",
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_steps: 1,
    total_tokens: 0,
    trace_id: "trace-1"
  }
  const step: AgentTraceStepRow = {
    completed_at: 3,
    duration_ms: 2,
    error_message: null,
    error_type: null,
    input_blob_id: "input-1",
    input_tokens: 0,
    model: null,
    output_blob_id: "output-1",
    output_tokens: 0,
    provider: null,
    started_at: 1,
    status: "completed",
    step_index: 0,
    step_type: "call_tool",
    tool_call_id: "tool-call-1",
    tool_name: "search_history",
    total_tokens: 0,
    trace_id: "trace-1"
  }
  const outputBlob: AgentTraceBlobRow = {
    blob_id: "output-1",
    kind: "tool_output",
    preview: "history result",
    size_bytes: 5_000,
    value: "history result ".repeat(400)
  }
  const artifact: ArtifactRecord = {
    artifactKey: "artifact-1",
    createdAt: new Date(1),
    id: "artifact-1",
    kind: "summary",
    messageId: null,
    mimeType: null,
    payload: {
      format: "plain",
      text: "Run summary"
    },
    previewText: "Run summary",
    runId: "run-1",
    sizeBytes: null,
    source: {
      type: "inline-text",
      uri: null
    },
    status: "ready",
    subtitle: null,
    threadId: "thread-1",
    title: "Run summary",
    toolCallId: "tool-call-1",
    updatedAt: new Date(1)
  }

  const content = agentContextInclusionMiddlewareInternals.formatRetrievedTraceEvidenceToolContent({
    artifactSummaries: [{ content: "Run summary", record: artifact }],
    inputBlob: null,
    outputBlob,
    step,
    trace
  })

  const result = parseContextRetrievalToolResult(content)
  assert.equal(result?.kind, "trace_evidence")
  assert.equal(result.trace.runId, "run-1")
  assert.equal(result.step?.traceStepId, "trace-1:0")
  assert.equal(result.step?.toolName, "search_history")
  assert.equal(result.blobs.output?.kind, "tool_output")
  assert.equal(result.blobs.output?.sizeBytes, 5_000)
  assert.match(result.blobs.output?.text ?? "", /\[truncated\]/)
  assert.equal(result.artifacts[0]?.title, "Run summary")
})
