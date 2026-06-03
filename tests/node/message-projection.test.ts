import assert from "node:assert/strict"
import test from "node:test"
import {
  buildTurnAssistantEntries,
  getTurnPendingApproval,
  getTurnToolDisplayPolicy,
  projectMessages,
  shouldDefaultExpandToolEntries,
  type MessageTurn
} from "../../src/renderer/src/lib/message-projection"
import { stabilizeThreadMessages } from "../../src/renderer/src/lib/thread-message-stability"
import type { HITLRequest, Message, ToolCall } from "../../src/renderer/src/types"

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

function createUserMessage(id: string, content = "User message"): Message {
  return {
    content,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    id,
    role: "user"
  }
}

function createToolMessage(props: {
  content: Message["content"]
  id: string
  toolCallId: string
}): Message {
  return {
    content: props.content,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    id: props.id,
    role: "tool",
    tool_call_id: props.toolCallId
  }
}

function createTurn(assistants: Message[]): MessageTurn {
  return {
    assistants,
    branchMessageId: assistants.at(-1)?.id ?? null,
    key: "turn-1",
    toolResults: new Map(),
    user: null
  }
}

function cloneMessages(messages: Message[]): Message[] {
  return structuredClone(messages)
}

test("single tool call projects to one agent activity item for standalone rendering", () => {
  const entries = buildTurnAssistantEntries(
    createTurn([
      createAssistantMessage({
        id: "assistant-1",
        toolCalls: [createToolCall("tool-call-1")]
      })
    ])
  )

  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.kind, "agent-activity")
  assert.equal(entries[0]?.key, "activity:tool:tool-call-1")
  assert.equal(entries[0]?.items.length, 1)
  assert.equal(entries[0]?.items[0]?.kind, "tool")
})

test("thinking followed by a tool call projects to one grouped agent activity", () => {
  const entries = buildTurnAssistantEntries(
    createTurn([
      createAssistantMessage({
        id: "assistant-1",
        content: [
          {
            reasoning: "I should inspect the files first.",
            type: "reasoning"
          }
        ]
      }),
      createAssistantMessage({
        id: "assistant-2",
        toolCalls: [createToolCall("tool-call-1")]
      })
    ])
  )

  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.kind, "agent-activity")
  assert.equal(entries[0]?.key, "activity:thinking:assistant-1")
  assert.deepEqual(
    entries[0]?.items.map((item) => item.kind),
    ["thinking", "tool"]
  )
})

test("consecutive tool calls project to one grouped agent activity", () => {
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
  assert.equal(beforeGrowth[0]?.kind, "agent-activity")
  assert.equal(beforeGrowth[0]?.items.length, 1)
  assert.equal(afterGrowth.length, 1)
  assert.equal(afterGrowth[0]?.kind, "agent-activity")
  assert.equal(afterGrowth[0]?.key, "activity:tool:tool-call-1")
  assert.deepEqual(
    afterGrowth[0]?.items.map((item) => item.kind),
    ["tool", "tool"]
  )
})

test("assistant content breaks agent activity grouping between tools", () => {
  const entries = buildTurnAssistantEntries(
    createTurn([
      createAssistantMessage({
        id: "assistant-1",
        toolCalls: [createToolCall("tool-call-1")]
      }),
      createAssistantMessage({
        content: "I found the first result.",
        id: "assistant-2"
      }),
      createAssistantMessage({
        id: "assistant-3",
        toolCalls: [createToolCall("tool-call-2")]
      })
    ])
  )

  assert.equal(entries.length, 3)
  assert.equal(entries[0]?.kind, "agent-activity")
  assert.equal(entries[0]?.key, "activity:tool:tool-call-1")
  assert.equal(entries[1]?.kind, "assistant-content")
  assert.equal(entries[2]?.kind, "agent-activity")
  assert.equal(entries[2]?.key, "activity:tool:tool-call-2")
})

test("activity can merge across adjacent assistant messages in the same turn", () => {
  const entries = buildTurnAssistantEntries(
    createTurn([
      createAssistantMessage({
        id: "assistant-1",
        content: [
          {
            reasoning: "Need a directory listing first.",
            type: "reasoning"
          }
        ]
      }),
      createAssistantMessage({
        id: "assistant-2",
        content: [
          {
            reasoning: "Then read the target file.",
            type: "reasoning"
          }
        ]
      }),
      createAssistantMessage({
        id: "assistant-3",
        toolCalls: [createToolCall("tool-call-1")]
      })
    ])
  )

  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.kind, "agent-activity")
  assert.deepEqual(
    entries[0]?.items.map((item) => item.kind),
    ["thinking", "thinking", "tool"]
  )
})

test("reasoning-only assistant messages project as thinking activity", () => {
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
  assert.equal(entries[0]?.kind, "agent-activity")
  assert.equal(entries[0]?.items[0]?.kind, "thinking")
})

test("late tool result updates do not change the activity group key", () => {
  const toolCall = createToolCall("tool-call-1")
  const messages = [
    createUserMessage("user-1", "Run a command"),
    createAssistantMessage({
      id: "assistant-1",
      toolCalls: [toolCall]
    }),
    createToolMessage({
      content: "initial result",
      id: "tool-1",
      toolCallId: toolCall.id
    })
  ]
  const firstProjection = projectMessages(messages)
  const firstEntries = buildTurnAssistantEntries(firstProjection.turns[0]!)
  const nextMessages = cloneMessages(messages)
  nextMessages[2] = {
    ...nextMessages[2]!,
    content: "updated result"
  }
  const nextProjection = projectMessages(nextMessages, firstProjection)
  const nextEntries = buildTurnAssistantEntries(nextProjection.turns[0]!)

  assert.equal(firstEntries[0]?.kind, "agent-activity")
  assert.equal(nextEntries[0]?.kind, "agent-activity")
  assert.equal(nextEntries[0]?.key, firstEntries[0]?.key)
  assert.equal(nextEntries[0]?.key, "activity:tool:tool-call-1")
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
  assert.deepEqual(getTurnToolDisplayPolicy(toolThenAnswerTurn, { isStreaming: true }), {
    defaultExpanded: true,
    preferLatestSummary: true
  })
  assert.deepEqual(getTurnToolDisplayPolicy(toolThenAnswerTurn, { isStreaming: false }), {
    defaultExpanded: false,
    preferLatestSummary: false
  })
})

test("streaming assistant content updates keep historical message and turn references stable", () => {
  const messages = [
    createUserMessage("user-1", "First question"),
    createAssistantMessage({ content: "First answer", id: "assistant-1" }),
    createUserMessage("user-2", "Second question"),
    createAssistantMessage({ content: "Streaming", id: "assistant-2" })
  ]
  const firstProjection = projectMessages(messages)
  const nextSnapshot = cloneMessages(messages)
  nextSnapshot[3] = {
    ...nextSnapshot[3]!,
    content: "Streaming update"
  }

  const stableMessages = stabilizeThreadMessages(messages, nextSnapshot)
  const nextProjection = projectMessages(stableMessages, firstProjection)

  assert.equal(stableMessages[0], messages[0])
  assert.equal(stableMessages[1], messages[1])
  assert.equal(stableMessages[2], messages[2])
  assert.notEqual(stableMessages[3], messages[3])
  assert.equal(nextProjection.turns[0], firstProjection.turns[0])
  assert.notEqual(nextProjection.turns[1], firstProjection.turns[1])
  assert.equal(nextProjection.turns[1]?.user, firstProjection.turns[1]?.user)
  assert.equal(nextProjection.turns[1]?.assistants[0], stableMessages[3])
  assert.equal(nextProjection.displayRows[0], firstProjection.displayRows[0])
  assert.notEqual(nextProjection.displayRows[1], firstProjection.displayRows[1])
  assert.equal(nextProjection.displayRows.at(-1), firstProjection.displayRows.at(-1))
  assert.equal(nextProjection.lastAssistantId, "assistant-2")
})

test("unchanged snapshots reuse the previous projection object", () => {
  const messages = [
    createUserMessage("user-1", "Question"),
    createAssistantMessage({ content: "Answer", id: "assistant-1" })
  ]
  const firstProjection = projectMessages(messages)
  const stableMessages = stabilizeThreadMessages(messages, cloneMessages(messages))
  const nextProjection = projectMessages(stableMessages, firstProjection)

  assert.equal(stableMessages, messages)
  assert.equal(nextProjection, firstProjection)
})

test("runtime active turn overrides the historical last assistant turn", () => {
  const projection = projectMessages(
    [
      createUserMessage("user-1", "First question"),
      createAssistantMessage({ content: "First answer", id: "assistant-1" }),
      createUserMessage("user-2", "Second question")
    ],
    null,
    { activeTurnKey: "user-2" }
  )

  assert.equal(projection.lastAssistantId, "assistant-1")
  assert.equal(projection.activeTurnKey, "user-2")
})

test("runtime active turn is ignored when the referenced turn is not visible", () => {
  const projection = projectMessages(
    [
      createUserMessage("user-1", "First question"),
      createAssistantMessage({ content: "First answer", id: "assistant-1" })
    ],
    null,
    { activeTurnKey: "missing-user" }
  )

  assert.equal(projection.lastAssistantId, "assistant-1")
  assert.equal(projection.activeTurnKey, null)
})

test("display rows are projected with a stable footer row for virtual rendering", () => {
  const projection = projectMessages([
    createUserMessage("user-1", "Question"),
    createAssistantMessage({ content: "Answer", id: "assistant-1" })
  ])
  const emptyProjection = projectMessages([])

  assert.equal(projection.displayRows.length, projection.turns.length + 1)
  assert.deepEqual(
    projection.displayRows.map((row) => row.kind),
    ["turn", "footer"]
  )
  assert.equal(projection.displayRows[0]?.key, "user-1")
  assert.equal(projection.displayRows.at(-1)?.key, "__chat_footer__")
  assert.deepEqual(
    emptyProjection.displayRows.map((row) => row.kind),
    ["footer"]
  )
})

test("tool result and approval projection changes stay scoped to the matching turn", () => {
  const firstToolCall = createToolCall("tool-call-1")
  const secondToolCall = createToolCall("tool-call-2")
  const messages = [
    createUserMessage("user-1", "Run first tool"),
    createAssistantMessage({ id: "assistant-1", toolCalls: [firstToolCall] }),
    createToolMessage({
      content: "first result",
      id: "tool-1",
      toolCallId: firstToolCall.id
    }),
    createUserMessage("user-2", "Run second tool"),
    createAssistantMessage({ id: "assistant-2", toolCalls: [secondToolCall] }),
    createToolMessage({
      content: "second result",
      id: "tool-2",
      toolCallId: secondToolCall.id
    })
  ]
  const firstProjection = projectMessages(messages)
  const nextSnapshot = cloneMessages(messages)
  nextSnapshot[5] = {
    ...nextSnapshot[5]!,
    content: "second result updated"
  }

  const stableMessages = stabilizeThreadMessages(messages, nextSnapshot)
  const nextProjection = projectMessages(stableMessages, firstProjection)
  const pendingApproval: HITLRequest = {
    allowed_decisions: ["approve", "reject"],
    id: "approval-2",
    review: null,
    tool_call: secondToolCall
  }

  assert.equal(nextProjection.turns[0], firstProjection.turns[0])
  assert.equal(nextProjection.turns[0]?.toolResults, firstProjection.turns[0]?.toolResults)
  assert.equal(
    nextProjection.turns[0]?.toolResults.get(firstToolCall.id),
    firstProjection.turns[0]?.toolResults.get(firstToolCall.id)
  )
  assert.notEqual(nextProjection.turns[1], firstProjection.turns[1])
  assert.notEqual(nextProjection.turns[1]?.toolResults, firstProjection.turns[1]?.toolResults)
  assert.equal(
    nextProjection.turns[1]?.toolResults.get(secondToolCall.id)?.content,
    "second result updated"
  )
  assert.equal(getTurnPendingApproval(nextProjection.turns[0]!, pendingApproval), null)
  assert.equal(getTurnPendingApproval(nextProjection.turns[1]!, pendingApproval), pendingApproval)
})

test("prepend and append preserve unchanged turn references by message id", () => {
  const currentMessages = [
    createUserMessage("user-2", "Current question"),
    createAssistantMessage({ content: "Current answer", id: "assistant-2" })
  ]
  const firstProjection = projectMessages(currentMessages)
  const prependedSnapshot = [
    createUserMessage("user-1", "Older question"),
    createAssistantMessage({ content: "Older answer", id: "assistant-1" }),
    ...cloneMessages(currentMessages)
  ]

  const prependedMessages = stabilizeThreadMessages(currentMessages, prependedSnapshot)
  const prependedProjection = projectMessages(prependedMessages, firstProjection)

  assert.equal(prependedMessages[2], currentMessages[0])
  assert.equal(prependedMessages[3], currentMessages[1])
  assert.equal(prependedProjection.turns[1], firstProjection.turns[0])
  assert.equal(prependedProjection.displayRows[1], firstProjection.displayRows[0])
  assert.equal(prependedProjection.displayRows.at(-1), firstProjection.displayRows.at(-1))

  const appendedSnapshot = [
    ...cloneMessages(prependedMessages),
    createUserMessage("user-3", "New question"),
    createAssistantMessage({ content: "New answer", id: "assistant-3" })
  ]
  const appendedMessages = stabilizeThreadMessages(prependedMessages, appendedSnapshot)
  const appendedProjection = projectMessages(appendedMessages, prependedProjection)

  assert.equal(appendedProjection.turns[0], prependedProjection.turns[0])
  assert.equal(appendedProjection.turns[1], prependedProjection.turns[1])
  assert.equal(appendedProjection.turns[2]?.key, "user-3")
  assert.equal(appendedProjection.displayRows[0], prependedProjection.displayRows[0])
  assert.equal(appendedProjection.displayRows[1], prependedProjection.displayRows[1])
  assert.equal(appendedProjection.displayRows.at(-1), prependedProjection.displayRows.at(-1))
})
