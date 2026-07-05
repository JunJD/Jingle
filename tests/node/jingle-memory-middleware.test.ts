import assert from "node:assert/strict"
import test from "node:test"
import { createJingleMemoryHook, createJingleMemoryRecordingRefsHook } from "@jingle/langchain-agent-harness/transitional"
import { compileRuntimeHookToMiddleware } from "../../packages/langchain-agent-harness/src/harness-runtime"
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

function compileJingleMemoryHookForTest(
  options: CreateJingleMemoryHarnessPortOptions,
  fallbackRunId = "fallback-run"
) {
  return compileRuntimeHookToMiddleware(
    createJingleMemoryHook<AgentContextInclusion>({
      ...createJingleMemoryHarnessPortOptions(options),
      fallbackRunId
    })
  )
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
  const middleware = compileJingleMemoryHookForTest({
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

test("jingle memory middleware does not expose suggestion tool in temporary mode", () => {
  const middleware = compileJingleMemoryHookForTest({
    allowSuggestions: true,
    contextPack: null,
    service: {} as JingleMemoryService,
    temporaryMode: true,
    threadId: "thread-1",
    workspaceIdentity
  })

  const tools = middleware.tools ?? []
  assert.equal(tools.some((tool) => tool.name === "suggest_personal_memory"), false)
})

test("jingle memory hook keeps suggestion tool and recording projection as separate contracts", () => {
  const memoryHook = createJingleMemoryHook<AgentContextInclusion>(
    {
      ...createJingleMemoryHarnessPortOptions({
        allowSuggestions: true,
        contextPack: null,
        service: {} as JingleMemoryService,
        temporaryMode: false,
        threadId: "thread-1",
        workspaceIdentity
      }),
      fallbackRunId: "run-1"
    }
  )
  const recordingHook = createJingleMemoryRecordingRefsHook()

  assert.deepEqual(memoryHook.reads, ["contextInclusions"])
  assert.deepEqual(memoryHook.writes, [])
  assert.equal(memoryHook.failureSemantics, "tool")
  assert.equal(memoryHook.writePolicy, "none")

  assert.deepEqual(recordingHook.reads, ["contextInclusions"])
  assert.deepEqual(recordingHook.writes, ["recordingRefs"])
  assert.equal(recordingHook.failureSemantics, "projection")
  assert.equal(recordingHook.writePolicy, "derived-projection")
})
