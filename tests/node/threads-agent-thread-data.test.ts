import assert from "node:assert/strict"
import test from "node:test"
import type { Message, Todo } from "../../src/shared/app-types"
import { ThreadsService } from "../../src/main/threads/service"
import {
  OPENWORK_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY,
  type AgentContextInclusion,
  type OpenworkMemoryContextSnapshot
} from "../../src/shared/openwork-memory"

function createService(input: {
  contextInclusions?: AgentContextInclusion[]
  latestRunMetadata?: Record<string, unknown> | null
  messages: Message[]
  todos: Todo[]
}): Pick<ThreadsService, "getPersistedAgentThreadData" | "getLatestRunSummary"> {
  return {
    getPersistedAgentThreadData: ThreadsService.prototype.getPersistedAgentThreadData,
    getLatestRunSummary: async () => ({
      error: "boom",
      metadata: input.latestRunMetadata ?? null,
      runId: "run-1"
    }),
    threadWorkspaceService: {
      getThreadWorkspacePath: async () => "/tmp/demo-workspace"
    },
    loadThreadRuntimeFacts: async () => ({
      artifacts: [],
      checkpoint: undefined,
      contextInclusions: input.contextInclusions ?? [],
      forkState: { canFork: true },
      messages: input.messages,
      pendingApproval: null,
      thread: {
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        metadata: {
          model: "openai:gpt-4o"
        },
        status: "idle" as const,
        thread_id: "thread-1",
        title: "Demo Thread",
        updated_at: new Date("2026-01-01T00:00:00.000Z")
      },
      todos: input.todos
    })
  } as unknown as Pick<ThreadsService, "getPersistedAgentThreadData" | "getLatestRunSummary">
}

function createMemoryContextSnapshot(): OpenworkMemoryContextSnapshot {
  const workspaceIdentity = {
    canonicalWorkspacePath: "/tmp/demo-workspace",
    displayName: "demo-workspace",
    workspaceKey: "/tmp/demo-workspace"
  }

  return {
    canonicalWorkspacePath: workspaceIdentity.canonicalWorkspacePath,
    generatedAt: 123,
    items: [
      {
        content: "Remember to keep projection failures visible.",
        id: "memory:memory-1",
        kind: "about_me",
        scope: "global",
        sourceLabel: "Global personal memory",
        sourceType: "structured",
        structuredMemoryId: "memory-1"
      }
    ],
    workspaceIdentity,
    workspaceKey: workspaceIdentity.workspaceKey
  }
}

test("threads service splits persisted agent thread data into messages and runState snapshots", async () => {
  const messages: Message[] = [
    {
      content: "hello",
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      id: "message-1",
      role: "user"
    }
  ]
  const todos: Todo[] = [
    {
      content: "Ship it",
      id: "todo-1",
      status: "pending"
    }
  ]

  const service = createService({ messages, todos })

  const snapshot = await service.getPersistedAgentThreadData("thread-1")

  assert.equal(snapshot.thread.thread_id, "thread-1")
  assert.equal(snapshot.thread.status, "idle")
  assert.equal(snapshot.thread.title, "Demo Thread")
  assert.deepEqual(snapshot.thread.metadata, {
    model: "openai:gpt-4o"
  })
  assert.deepEqual(snapshot.messages.artifacts, [])
  assert.deepEqual(snapshot.messages.messages.map((message) => message.id), ["message-1"])
  assert.deepEqual(snapshot.runState.forkState, { canFork: true })
  assert.equal(snapshot.runState.pendingApproval, null)
  assert.equal(snapshot.runState.runId, "run-1")
  assert.equal(snapshot.runState.workspacePath, "/tmp/demo-workspace")
  assert.equal(snapshot.runState.error, "boom")
  assert.deepEqual(snapshot.runState.todos.map((todo) => todo.id), ["todo-1"])
  assert.deepEqual(snapshot.runState.contextInclusions, [])
})

test("threads service restores context inclusions from persisted runtime facts", async () => {
  const inclusion: AgentContextInclusion = {
    availability: "available",
    createdAt: 456,
    id: "ctx:run-1:retrieved:history_message:thread-2:message-2",
    messageId: null,
    mode: "retrieved",
    preview: "Earlier answer",
    runId: "run-1",
    sourceId: "message-2",
    sourceType: "history_message",
    target: {
      messageId: "message-2",
      threadId: "thread-2",
      type: "history_message"
    },
    threadId: "thread-1",
    title: "assistant message",
    turnId: null
  }
  const service = createService({
    contextInclusions: [inclusion],
    messages: [],
    todos: []
  })

  const snapshot = await service.getPersistedAgentThreadData("thread-1")

  assert.deepEqual(snapshot.runState.contextInclusions, [inclusion])
})

test("threads service restores provided context inclusions from frozen run metadata when checkpoint has no context state", async () => {
  const memoryContextSnapshot = createMemoryContextSnapshot()
  const service = createService({
    latestRunMetadata: {
      [OPENWORK_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY]: memoryContextSnapshot
    },
    messages: [],
    todos: []
  })

  const snapshot = await service.getPersistedAgentThreadData("thread-1")

  assert.equal(snapshot.runState.contextInclusions.length, 1)
  assert.equal(
    snapshot.runState.contextInclusions[0]?.id,
    "ctx:run-1:provided:memory:memory-1"
  )
  assert.equal(snapshot.runState.contextInclusions[0]?.mode, "provided")
  assert.equal(snapshot.runState.contextInclusions[0]?.sourceType, "memory")
})
