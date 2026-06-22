import assert from "node:assert/strict"
import test from "node:test"
import type { AgentContextInclusion, OpenworkWorkspaceIdentity } from "../../src/shared/openwork-memory"
import {
  createOpenworkMemoryInclusionCollector,
  createOpenworkMemoryMiddleware
} from "../../src/main/openwork-memory/middleware"
import type { OpenworkMemoryService } from "../../src/main/openwork-memory/service"

const workspaceIdentity: OpenworkWorkspaceIdentity = {
  canonicalWorkspacePath: "/tmp/openwork-memory-test",
  displayName: "openwork-memory-test",
  workspaceKey: "/tmp/openwork-memory-test"
}

type InvokableTool = {
  invoke(input: unknown, config?: unknown): Promise<unknown>
  name: string
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

test("openwork memory middleware binds retrieved evidence refs to pending suggestions", async () => {
  const captured: unknown[] = []
  const service = {
    createSuggestion: async (...args: unknown[]) => {
      captured.push(args)
      return {}
    }
  } as unknown as OpenworkMemoryService
  const runtime = createOpenworkMemoryMiddleware({
    allowSuggestions: true,
    collector: createOpenworkMemoryInclusionCollector(),
    contextPack: null,
    mode: "root",
    runId: "fallback-run",
    service,
    temporaryMode: false,
    threadId: "thread-1",
    workspaceIdentity
  })
  const suggestTool = runtime.middleware.tools?.find(
    (tool): tool is InvokableTool =>
      typeof tool === "object" &&
      tool !== null &&
      "name" in tool &&
      tool.name === "suggest_personal_memory" &&
      "invoke" in tool &&
      typeof tool.invoke === "function"
  )
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

test("openwork memory middleware does not expose suggestion tool in temporary mode", () => {
  const runtime = createOpenworkMemoryMiddleware({
    allowSuggestions: true,
    collector: createOpenworkMemoryInclusionCollector(),
    contextPack: null,
    mode: "root",
    runId: "run-1",
    service: {} as OpenworkMemoryService,
    temporaryMode: true,
    threadId: "thread-1",
    workspaceIdentity
  })

  const tools = runtime.middleware.tools ?? []
  assert.equal(tools.some((tool) => tool.name === "suggest_personal_memory"), false)
})
