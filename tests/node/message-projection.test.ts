import assert from "node:assert/strict"
import test from "node:test"
import {
  buildTurnAssistantEntries,
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
    key: "turn-1",
    user: null
  }
}

test("tool cluster key stays stable when multi-call tool activity grows", () => {
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
  assert.equal(afterGrowth[0]?.kind, "tool-cluster")
  assert.equal(afterGrowth[0]?.key, beforeGrowth[0]?.key)
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
