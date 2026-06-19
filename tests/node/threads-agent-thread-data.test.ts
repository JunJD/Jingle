import assert from "node:assert/strict"
import test from "node:test"
import type { Message, Todo } from "../../src/shared/app-types"
import { ThreadsService } from "../../src/main/threads/service"

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

  const service = {
    getPersistedAgentThreadData: ThreadsService.prototype.getPersistedAgentThreadData,
    getLatestRunSummary: async () => ({
      error: "boom",
      runId: "run-1"
    }),
    threadWorkspaceService: {
      getThreadWorkspacePath: async () => "/tmp/demo-workspace"
    },
    loadThreadRuntimeFacts: async () => ({
      artifacts: [],
      checkpoint: undefined,
      forkState: { canFork: true },
      messages,
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
      todos
    })
  } as unknown as Pick<
    ThreadsService,
    "getPersistedAgentThreadData" | "getLatestRunSummary"
  >

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
})
