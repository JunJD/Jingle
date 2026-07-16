import assert from "node:assert/strict"
import test from "node:test"
import { createMemoryMiddleware } from "@jingle/langchain-agent-harness/transitional"
import type { AgentContextInclusion, JingleWorkspaceIdentity } from "../../src/shared/jingle-memory"
import {
  createJingleMemoryHarnessPortOptions,
  type CreateJingleMemoryHarnessPortOptions
} from "../../src/main/jingle-memory/harness-memory-port"
import type { JingleMemoryService } from "../../src/main/jingle-memory/service"

const workspaceIdentity: JingleWorkspaceIdentity = {
  canonicalWorkspacePath: "/tmp/jingle-memory-test",
  displayName: "jingle-memory-test",
  workspaceKey: "/tmp/jingle-memory-test"
}

type InvokableTool = {
  invoke(input: unknown, config?: unknown): Promise<unknown>
  name: string
}

function createMemoryMiddlewareForTest(options: CreateJingleMemoryHarnessPortOptions) {
  return createMemoryMiddleware<AgentContextInclusion>({
    ...createJingleMemoryHarnessPortOptions(options)
  })
}

function createContextInclusion(
  input: Partial<AgentContextInclusion> & Pick<AgentContextInclusion, "id" | "mode" | "sourceType">
): AgentContextInclusion {
  return {
    availability: "available",
    createdAt: 123,
    messageId: null,
    preview: "Evidence preview",
    runId: "run-1",
    sourceId: "source-1",
    target: {
      type: input.sourceType
    },
    threadId: "thread-1",
    title: "Evidence title",
    turnId: null,
    ...input
  }
}

test("jingle memory middleware binds retrieved evidence refs to pending suggestions", async () => {
  const captured: unknown[] = []
  const service = {
    createSuggestion: async (...args: unknown[]) => {
      captured.push(args)
      return {}
    }
  } as unknown as JingleMemoryService
  const middleware = createMemoryMiddlewareForTest({
    allowSuggestions: true,
    contextPack: null,
    service,
    temporaryMode: false,
    threadId: "thread-1",
    workspaceIdentity
  })
  const suggestTool = middleware.tools?.find(
    (tool) =>
      typeof tool === "object" &&
      tool !== null &&
      "name" in tool &&
      tool.name === "suggest_personal_memory" &&
      "invoke" in tool &&
      typeof tool.invoke === "function"
  ) as InvokableTool | undefined
  assert.ok(suggestTool)

  await suggestTool.invoke(
    {
      content: "User prefers concise implementation notes.",
      reason: "The user asked for developer-oriented documents.",
      scope: "global",
      type: "about_me"
    },
    {
      configurable: { run_id: "runtime-run" },
      state: {
        contextInclusions: [
          createContextInclusion({
            id: "ctx:provided",
            mode: "provided",
            sourceType: "memory"
          }),
          createContextInclusion({
            id: "ctx:retrieved",
            mode: "retrieved",
            preview: "Retrieved message evidence.",
            sourceId: "message-1",
            sourceType: "history_message",
            target: {
              messageId: "message-1",
              threadId: "source-thread",
              type: "history_message"
            },
            threadId: "thread-1",
            title: "user message"
          }),
          createContextInclusion({
            availability: "unavailable",
            id: "ctx:unavailable",
            mode: "retrieved",
            sourceType: "trace_step",
            unavailableReason: {
              code: "not_found",
              message: "Missing trace."
            }
          })
        ]
      }
    }
  )

  assert.equal(captured.length, 1)
  const [input, passedWorkspaceIdentity] = captured[0] as [Record<string, unknown>, unknown]
  assert.equal(passedWorkspaceIdentity, workspaceIdentity)
  assert.equal(input.sourceRunId, "runtime-run")
  assert.deepEqual(input.reviewPayload, {
    evidenceIds: ["ctx:retrieved"],
    evidenceRefs: [
      {
        id: "ctx:retrieved",
        mode: "retrieved",
        preview: "Retrieved message evidence.",
        sourceId: "message-1",
        sourceType: "history_message",
        target: {
          messageId: "message-1",
          threadId: "source-thread",
          type: "history_message"
        },
        threadId: "thread-1",
        title: "user message"
      }
    ]
  })
})

test("jingle memory suggestion requires the runtime run id", async () => {
  const middleware = createMemoryMiddlewareForTest({
    allowSuggestions: true,
    contextPack: null,
    service: {} as JingleMemoryService,
    temporaryMode: false,
    threadId: "thread-1",
    workspaceIdentity
  })
  const suggestTool = middleware.tools?.find(
    (tool) =>
      typeof tool === "object" &&
      tool !== null &&
      "name" in tool &&
      tool.name === "suggest_personal_memory" &&
      "invoke" in tool &&
      typeof tool.invoke === "function"
  ) as InvokableTool | undefined
  assert.ok(suggestTool)

  await assert.rejects(
    suggestTool.invoke(
      {
        content: "Remember this",
        scope: "global",
        type: "about_me"
      },
      {
        state: { contextInclusions: [] }
      }
    ),
    /Tool runtime config is missing run_id/
  )
})

test("jingle memory middleware does not expose suggestion tool in temporary mode", () => {
  const middleware = createMemoryMiddlewareForTest({
    allowSuggestions: true,
    contextPack: null,
    service: {} as JingleMemoryService,
    temporaryMode: true,
    threadId: "thread-1",
    workspaceIdentity
  })

  const tools = middleware.tools ?? []
  assert.equal(
    tools.some((tool) => tool.name === "suggest_personal_memory"),
    false
  )
})

test("jingle memory middleware only owns suggestion tools and model context", () => {
  const memoryMiddleware = createMemoryMiddleware<AgentContextInclusion>({
    ...createJingleMemoryHarnessPortOptions({
      allowSuggestions: true,
      contextPack: null,
      service: {} as JingleMemoryService,
      temporaryMode: false,
      threadId: "thread-1",
      workspaceIdentity
    })
  })
  assert.equal(memoryMiddleware.name, "jingleMemory")
  assert.ok(memoryMiddleware.stateSchema)
  assert.ok(memoryMiddleware.wrapModelCall)
})
