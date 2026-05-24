import assert from "node:assert/strict"
import test from "node:test"
import {
  buildTurnAssistantEntries,
  countToolCalls,
  shouldDefaultExpandToolEntries,
  type MessageTurn
} from "../../src/renderer/src/components/chat/message-projection"
import type { Message, ToolCall } from "../../src/renderer/src/types"

function createToolCall(id: string): ToolCall {
  return {
    args: {},
    id,
    name: "execute",
    type: "tool_call"
  }
}

function createAssistantMessage(props: {
  id: string
  content?: Message["content"]
  toolCalls?: ToolCall[]
}): Message {
  return {
    content: props.content ?? "",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    id: props.id,
    role: "assistant",
    tool_calls: props.toolCalls
  }
}

function createTurn(assistants: Message[]): MessageTurn {
  return {
    assistants,
    branchMessageId: assistants.at(-1)?.id ?? null,
    key: "turn-1",
    user: null
  }
}

test("distinct assistant tool responses stay in separate clusters", () => {
  const firstToolMessage = createAssistantMessage({
    id: "assistant-1",
    toolCalls: [createToolCall("tool-call-1")]
  })
  const secondToolMessage = createAssistantMessage({
    id: "assistant-2",
    toolCalls: [createToolCall("tool-call-2")]
  })

  const beforeGrowth = buildTurnAssistantEntries(createTurn([firstToolMessage]))
  const afterGrowth = buildTurnAssistantEntries(createTurn([firstToolMessage, secondToolMessage]))

  assert.equal(beforeGrowth.length, 1)
  assert.equal(beforeGrowth[0]?.kind, "tool-cluster")
  assert.equal(afterGrowth.length, 2)
  assert.equal(afterGrowth[0]?.kind, "tool-cluster")
  assert.equal(afterGrowth[1]?.kind, "tool-cluster")
  assert.notEqual(afterGrowth[0]?.key, afterGrowth[1]?.key)
})

test("tool cluster key remains stable when first tool message later gains renderable content", () => {
  const toolOnlyMessage = createAssistantMessage({
    id: "assistant-1",
    toolCalls: [createToolCall("tool-call-1")]
  })
  const toolAndContentMessage = createAssistantMessage({
    id: "assistant-1",
    content: "Running plan...",
    toolCalls: [createToolCall("tool-call-1")]
  })

  const initialEntries = buildTurnAssistantEntries(createTurn([toolOnlyMessage]))
  const updatedEntries = buildTurnAssistantEntries(createTurn([toolAndContentMessage]))
  const initialCluster = initialEntries.find((entry) => entry.kind === "tool-cluster")
  const updatedCluster = updatedEntries.find((entry) => entry.kind === "tool-cluster")

  assert.ok(initialCluster)
  assert.ok(updatedCluster)
  assert.equal(updatedCluster.key, initialCluster.key)
})

test("reasoning-only assistant messages render as assistant content", () => {
  const reasoningMessage = createAssistantMessage({
    id: "assistant-1",
    content: [
      {
        reasoning: "I should inspect the available files first.",
        type: "reasoning"
      }
    ]
  })

  const entries = buildTurnAssistantEntries(createTurn([reasoningMessage]))

  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.kind, "assistant-content")
})

test("single tool call stays standalone while multiple tool calls switch to grouped presentation", () => {
  const singleToolMessages = [
    createAssistantMessage({
      id: "assistant-1",
      toolCalls: [createToolCall("tool-call-1")]
    })
  ]
  const multiToolMessages = [
    createAssistantMessage({
      id: "assistant-1",
      toolCalls: [createToolCall("tool-call-1")]
    }),
    createAssistantMessage({
      id: "assistant-2",
      toolCalls: [createToolCall("tool-call-2")]
    })
  ]

  assert.equal(countToolCalls(singleToolMessages), 1)
  assert.equal(countToolCalls(multiToolMessages), 2)
})

test("tool entries collapse by default only after a non-streaming turn ends with assistant content", () => {
  const toolOnlyTurn = createTurn([
    createAssistantMessage({
      id: "assistant-1",
      toolCalls: [createToolCall("tool-call-1")]
    })
  ])
  const toolThenAnswerTurn = createTurn([
    createAssistantMessage({
      id: "assistant-1",
      toolCalls: [createToolCall("tool-call-1")]
    }),
    createAssistantMessage({
      id: "assistant-2",
      content: "Done."
    })
  ])
  const toolAndAnswerSameMessageTurn = createTurn([
    createAssistantMessage({
      id: "assistant-1",
      content: "Done.",
      toolCalls: [createToolCall("tool-call-1")]
    })
  ])

  assert.equal(shouldDefaultExpandToolEntries(toolOnlyTurn, { isStreaming: false }), true)
  assert.equal(shouldDefaultExpandToolEntries(toolThenAnswerTurn, { isStreaming: false }), false)
  assert.equal(
    shouldDefaultExpandToolEntries(toolAndAnswerSameMessageTurn, { isStreaming: false }),
    false
  )
  assert.equal(shouldDefaultExpandToolEntries(toolThenAnswerTurn, { isStreaming: true }), true)
})
