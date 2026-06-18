import assert from "node:assert/strict"
import test from "node:test"
import { AGENT_TOOL_EXECUTION_METADATA_KEY } from "../../src/shared/agent-thread-runtime"
import { FILE_MUTATION_RESULT_METADATA_KEY } from "../../src/shared/file-mutation-result"
import {
  buildTurnAssistantEntries,
  getTurnPendingApproval,
  projectAgentActivitySummary,
  projectActiveTurnStatus,
  projectMessages,
  projectTurnPendingApproval,
  projectTurnElapsedDivider,
  projectTurnToolExecutionsView,
  shouldDefaultExpandToolEntries,
  updateProjectedMessage,
  type MessageTurn
} from "../../src/renderer/src/lib/message-projection"
import { stabilizeThreadMessages } from "../../src/renderer/src/lib/thread-message-stability"
import type { HITLRequest, Message, ToolCall } from "../../src/renderer/src/types"

function createToolCall(
  id: string,
  name = "execute",
  args: Record<string, unknown> = {}
): ToolCall {
  return {
    args,
    id,
    name,
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
  metadata?: Message["metadata"]
  toolCallId: string
}): Message {
  return {
    content: props.content,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    id: props.id,
    ...(props.metadata ? { metadata: props.metadata } : {}),
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

function createLongConversationMessages(turnCount: number): Message[] {
  const messages: Message[] = []
  for (let index = 0; index < turnCount; index += 1) {
    messages.push(
      createUserMessage(`user-${index}`, `Question ${index}`),
      createAssistantMessage({
        content: `Answer ${index}`,
        id: `assistant-${index}`
      })
    )
  }

  return messages
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

test("extension orchestration tool calls do not expose wrapper names in activity display", () => {
  const entries = buildTurnAssistantEntries(
    createTurn([
      createAssistantMessage({
        id: "assistant-1",
        toolCalls: [
          {
            args: {
              extensionName: "image-generation"
            },
            id: "tool-call-load-extension",
            name: "loadExtension",
            type: "tool_call"
          },
          {
            args: {
              args: {
                prompt: "cat"
              },
              extensionName: "image-generation",
              toolName: "generateImage"
            },
            display: {
              description: "Create an image from a prompt.",
              title: "Generate Image"
            },
            id: "tool-call-call-extension",
            name: "callExtension",
            presentation: {
              access: "external" as const,
              capabilityDisplayName: "Image Generation",
              capabilityTitle: "Image Generation",
              kind: "extension" as const
            },
            type: "tool_call"
          }
        ]
      })
    ])
  )

  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.kind, "agent-activity")
  assert.equal(entries[0]?.items.length, 1)
  const item = entries[0]?.items[0]
  assert.equal(item?.kind, "tool")
  assert.equal(item?.toolCall.name, "callExtension")
  assert.equal(item?.toolCall.display?.title, "Generate Image")
})

test("bare callExtension wrapper does not enter chat tool activity projection", () => {
  const entries = buildTurnAssistantEntries(
    createTurn([
      createAssistantMessage({
        id: "assistant-1",
        toolCalls: [
          {
            args: {
              args: {
                prompt: "cat"
              },
              extensionName: "image-generation",
              toolName: "generateImage"
            },
            id: "tool-call-call-extension",
            name: "callExtension",
            type: "tool_call"
          }
        ]
      })
    ])
  )

  assert.equal(entries.length, 0)
})

test("streaming orchestration tool calls do not enter temporary activity projection", () => {
  const entries = buildTurnAssistantEntries(createTurn([]), {
    activeToolCalls: [
      {
        argsText: '{"extensionName":"image-generation"}',
        id: "tool-call-load-extension",
        index: 0,
        messageId: "assistant-1",
        name: "loadExtension",
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:01.000Z"),
        status: "arguments_streaming"
      },
      {
        argsText:
          '{"extensionName":"image-generation","toolName":"generateImage","args":{"prompt":"cat"}}',
        id: "tool-call-call-extension",
        index: 1,
        messageId: "assistant-1",
        name: "callExtension",
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:02.000Z"),
        status: "arguments_streaming"
      }
    ]
  })

  assert.equal(entries.length, 0)
})

test("thinking followed by a tool call projects to separate reasoning and tool entries", () => {
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

  assert.equal(entries.length, 2)
  assert.equal(entries[0]?.kind, "thinking")
  assert.equal(entries[0]?.key, "thinking:assistant-1")
  assert.equal(entries[1]?.kind, "agent-activity")
  assert.equal(entries[1]?.key, "activity:tool:tool-call-1")
  assert.deepEqual(
    entries[1]?.items.map((item) => item.kind),
    ["tool"]
  )
})

test("streaming active tool calls project to temporary agent activity entries", () => {
  const entries = buildTurnAssistantEntries(
    createTurn([
      createAssistantMessage({
        content: "I will edit that file.",
        id: "assistant-1"
      })
    ]),
    {
      activeToolCalls: [
        {
          argsText: '{"path":"src/',
          id: "tool-call-1",
          index: 0,
          messageId: "assistant-1",
          name: "edit_file",
          runId: "run-1",
          startedAt: new Date("2026-01-01T00:00:01.000Z"),
          status: "arguments_streaming"
        }
      ]
    }
  )

  assert.equal(entries.length, 2)
  assert.equal(entries[0]?.kind, "assistant-content")
  assert.equal(entries[1]?.kind, "agent-activity")
  assert.equal(entries[1]?.key, "activity:tool:tool-call-1")
  assert.deepEqual(entries[1]?.kind === "agent-activity" ? entries[1].items[0]?.toolCall : null, {
    args: {},
    id: "tool-call-1",
    name: "edit_file",
    type: "tool_call"
  })
})

test("streaming active tool calls use complete args only when available", () => {
  const entries = buildTurnAssistantEntries(createTurn([]), {
    activeToolCalls: [
      {
        argsText: '{"path":"src/renderer.tsx"}',
        id: "tool-call-1",
        index: 0,
        messageId: null,
        name: "edit_file",
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:01.000Z"),
        status: "arguments_streaming"
      }
    ]
  })

  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.kind, "agent-activity")
  assert.deepEqual(entries[0]?.kind === "agent-activity" ? entries[0].items[0]?.toolCall : null, {
    args: {
      path: "src/renderer.tsx"
    },
    id: "tool-call-1",
    name: "edit_file",
    type: "tool_call"
  })
  assert.equal(
    entries[0]?.kind === "agent-activity" ? entries[0].items[0]?.messageId : null,
    "active:tool-call-1"
  )
})

test("updating one active tool keeps other activity group keys stable", () => {
  const firstToolCall = createToolCall("tool-call-history", "read_file", {
    path: "src/index.ts"
  })
  const turn = createTurn([
    createAssistantMessage({
      id: "assistant-history",
      toolCalls: [firstToolCall]
    }),
    createAssistantMessage({
      content: "Now I will edit another file.",
      id: "assistant-narrative"
    })
  ])

  const firstEntries = buildTurnAssistantEntries(turn, {
    activeToolCalls: [
      {
        argsText: '{"path":"src/',
        id: "tool-call-active",
        index: 0,
        messageId: "assistant-active",
        name: "write_file",
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:01.000Z"),
        status: "arguments_streaming"
      }
    ]
  })
  const nextEntries = buildTurnAssistantEntries(turn, {
    activeToolCalls: [
      {
        argsText: '{"path":"src/notes.md","content":"hello"}',
        id: "tool-call-active",
        index: 0,
        messageId: "assistant-active",
        name: "write_file",
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:01.000Z"),
        status: "arguments_streaming"
      }
    ]
  })

  assert.equal(firstEntries[0]?.kind, "agent-activity")
  assert.equal(nextEntries[0]?.kind, "agent-activity")
  assert.equal(firstEntries[0]?.key, "activity:tool:tool-call-history")
  assert.equal(nextEntries[0]?.key, "activity:tool:tool-call-history")
  assert.equal(firstEntries.at(-1)?.kind, "agent-activity")
  assert.equal(nextEntries.at(-1)?.kind, "agent-activity")
  assert.equal(firstEntries.at(-1)?.key, nextEntries.at(-1)?.key)
  const latestNextEntry = nextEntries.at(-1)
  assert.deepEqual(
    latestNextEntry?.kind === "agent-activity" ? latestNextEntry.items[0]?.toolCall.args : null,
    {
      content: "hello",
      path: "src/notes.md"
    }
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

test("active turn status is derived from current runtime facts", () => {
  assert.equal(
    projectActiveTurnStatus({
      assistantEntries: [],
      isStreaming: true
    }),
    null
  )

  const blankStatus = projectActiveTurnStatus({
    activeRunPhase: "thinking",
    assistantEntries: [],
    isStreaming: true
  })
  assert.deepEqual(blankStatus, {
    coachTip: { id: "start_with_outcome" },
    kind: "thinking",
    placement: "before_entries",
    toolCallId: null
  })

  assert.deepEqual(
    projectActiveTurnStatus({
      activeRunPhase: "streaming",
      assistantEntries: [],
      isStreaming: true
    }),
    {
      coachTip: { id: "start_with_outcome" },
      kind: "thinking",
      placement: "before_entries",
      toolCallId: null
    }
  )

  const reasoningTurn = createTurn([
    createAssistantMessage({
      content: [
        {
          reasoning: "I need to inspect the workspace first.",
          type: "reasoning"
        }
      ],
      id: "assistant-thinking"
    })
  ])
  assert.equal(
    projectActiveTurnStatus({
      activeRunPhase: "thinking",
      assistantEntries: buildTurnAssistantEntries(reasoningTurn, {
        streamingAssistantId: "assistant-thinking"
      }),
      isStreaming: true
    }),
    null
  )

  assert.equal(
    projectActiveTurnStatus({
      activeRunPhase: "tool_running",
      assistantEntries: [],
      isStreaming: true
    }),
    null
  )

  const runningToolCall = createToolCall("tool-call-running", "read_file")
  const toolTurn = createTurn([
    createAssistantMessage({
      id: "assistant-tool",
      toolCalls: [runningToolCall]
    })
  ])
  const toolEntries = buildTurnAssistantEntries(toolTurn)
  assert.deepEqual(
    projectActiveTurnStatus({
      activeRunPhase: "thinking",
      assistantEntries: toolEntries,
      isStreaming: true
    }),
    {
      coachTip: { id: "keep_followups_in_thread" },
      kind: "thinking",
      placement: "inside_latest_agent_activity",
      toolCallId: null
    }
  )

  assert.deepEqual(
    projectActiveTurnStatus({
      activeRunPhase: "tool_running",
      assistantEntries: toolEntries,
      isStreaming: true
    }),
    {
      coachTip: { id: "keep_followups_in_thread" },
      kind: "thinking",
      placement: "inside_latest_agent_activity",
      toolCallId: null
    }
  )

  const approval: HITLRequest = {
    allowed_decisions: ["approve", "reject"],
    id: "approval-running",
    review: null,
    tool_call: runningToolCall
  }
  assert.equal(
    projectActiveTurnStatus({
      activeRunPhase: "waiting_tool_result",
      assistantEntries: toolEntries,
      isStreaming: true,
      pendingApproval: approval
    }),
    null
  )

  assert.deepEqual(
    projectActiveTurnStatus({
      activeRunPhase: "waiting_tool_result",
      assistantEntries: [],
      isStreaming: true,
      pendingApproval: approval
    }),
    {
      coachTip: null,
      kind: "waiting_approval",
      placement: "before_entries",
      toolCallId: runningToolCall.id
    }
  )

  const answerTurn = createTurn([
    createAssistantMessage({
      content: "Here is the answer.",
      id: "assistant-answer"
    })
  ])
  assert.deepEqual(
    projectActiveTurnStatus({
      activeRunPhase: "thinking",
      assistantEntries: buildTurnAssistantEntries(answerTurn),
      isStreaming: true
    }),
    {
      coachTip: { id: "iterate_after_first_draft" },
      kind: "thinking",
      placement: "after_entries",
      toolCallId: null
    }
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

test("reasoning entries do not merge into adjacent tool activity groups", () => {
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

  assert.equal(entries.length, 3)
  assert.equal(entries[0]?.kind, "thinking")
  assert.equal(entries[0]?.key, "thinking:assistant-1")
  assert.equal(entries[1]?.kind, "thinking")
  assert.equal(entries[1]?.key, "thinking:assistant-2")
  assert.equal(entries[2]?.kind, "agent-activity")
  assert.equal(entries[2]?.key, "activity:tool:tool-call-1")
  assert.deepEqual(
    entries[2]?.items.map((item) => item.kind),
    ["tool"]
  )
})

test("reasoning-only assistant messages project as thinking entries", () => {
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
  assert.equal(entries[0]?.kind, "thinking")
  assert.equal(entries[0]?.key, "thinking:assistant-1")
  assert.equal(entries[0]?.text, "I should inspect the available files first.")
  assert.equal(entries[0]?.isActive, false)
})

test("only latest streaming reasoning entry is active", () => {
  const reasoningMessage = createAssistantMessage({
    id: "assistant-reasoning",
    content: [
      {
        reasoning: "I should inspect the available files first.",
        type: "reasoning"
      }
    ]
  })

  const activeEntries = buildTurnAssistantEntries(createTurn([reasoningMessage]), {
    streamingAssistantId: "assistant-reasoning"
  })
  assert.equal(activeEntries[0]?.kind, "thinking")
  assert.equal(activeEntries[0]?.isActive, true)
  assert.deepEqual(activeEntries[0]?.kind === "thinking" ? activeEntries[0].coachTip : null, {
    id: "start_with_outcome"
  })
  assert.equal(
    projectActiveTurnStatus({
      activeRunPhase: "thinking",
      assistantEntries: activeEntries,
      isStreaming: true
    }),
    null
  )

  const inactiveLatestReasoning = buildTurnAssistantEntries(createTurn([reasoningMessage]))
  assert.equal(inactiveLatestReasoning[0]?.kind, "thinking")
  assert.equal(inactiveLatestReasoning[0]?.isActive, false)
  assert.equal(
    inactiveLatestReasoning[0]?.kind === "thinking" ? inactiveLatestReasoning[0].coachTip : null,
    null
  )
  assert.equal(
    projectActiveTurnStatus({
      activeRunPhase: "thinking",
      assistantEntries: inactiveLatestReasoning,
      isStreaming: true
    }),
    null
  )

  const followedByAssistantContent = buildTurnAssistantEntries(
    createTurn([
      reasoningMessage,
      createAssistantMessage({
        content: "I found the relevant files.",
        id: "assistant-answer"
      })
    ]),
    { streamingAssistantId: "assistant-reasoning" }
  )
  assert.equal(followedByAssistantContent[0]?.kind, "thinking")
  assert.equal(followedByAssistantContent[0]?.isActive, false)
  assert.equal(
    followedByAssistantContent[0]?.kind === "thinking"
      ? followedByAssistantContent[0].coachTip
      : null,
    null
  )
  assert.deepEqual(
    projectActiveTurnStatus({
      activeRunPhase: "thinking",
      assistantEntries: followedByAssistantContent,
      isStreaming: true
    }),
    {
      coachTip: { id: "iterate_after_first_draft" },
      kind: "thinking",
      placement: "after_entries",
      toolCallId: null
    }
  )

  const followedByToolActivity = buildTurnAssistantEntries(
    createTurn([
      reasoningMessage,
      createAssistantMessage({
        id: "assistant-tool",
        toolCalls: [createToolCall("tool-call-1")]
      })
    ]),
    { streamingAssistantId: "assistant-reasoning" }
  )
  assert.equal(followedByToolActivity[0]?.kind, "thinking")
  assert.equal(followedByToolActivity[0]?.isActive, false)
  assert.equal(
    followedByToolActivity[0]?.kind === "thinking" ? followedByToolActivity[0].coachTip : null,
    null
  )
  assert.deepEqual(
    projectActiveTurnStatus({
      activeRunPhase: "thinking",
      assistantEntries: followedByToolActivity,
      isStreaming: true
    }),
    {
      coachTip: { id: "keep_followups_in_thread" },
      kind: "thinking",
      placement: "inside_latest_agent_activity",
      toolCallId: null
    }
  )

  const answerThenActiveReasoning = buildTurnAssistantEntries(
    createTurn([
      createAssistantMessage({
        content: "I found the relevant files.",
        id: "assistant-answer"
      }),
      reasoningMessage
    ]),
    { streamingAssistantId: "assistant-reasoning" }
  )
  const activeReasoningAfterContent = answerThenActiveReasoning.at(-1)
  assert.equal(activeReasoningAfterContent?.kind, "thinking")
  assert.equal(
    activeReasoningAfterContent?.kind === "thinking" ? activeReasoningAfterContent.isActive : null,
    true
  )
  assert.deepEqual(
    activeReasoningAfterContent?.kind === "thinking" ? activeReasoningAfterContent.coachTip : null,
    {
      id: "iterate_after_first_draft"
    }
  )
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

test("tool result projection preserves completed file mutation metadata", () => {
  const toolCall = createToolCall("tool-call-1", "edit_file", {
    file_path: "src/app.ts",
    new_string: "next",
    old_string: "current"
  })
  const projection = projectMessages([
    createUserMessage("user-1", "Edit file"),
    createAssistantMessage({
      id: "assistant-1",
      toolCalls: [toolCall]
    }),
    createToolMessage({
      content: "Successfully replaced 1 occurrence(s) in 'src/app.ts'",
      id: "tool-1",
      metadata: {
        [FILE_MUTATION_RESULT_METADATA_KEY]: {
          files: [
            {
              after: "next",
              before: "current",
              changeType: "modify",
              path: "src/app.ts"
            }
          ],
          status: "completed",
          toolCallId: "tool-call-1",
          toolName: "edit_file"
        }
      },
      toolCallId: toolCall.id
    })
  ])

  assert.deepEqual(projection.turns[0]?.toolResults.get(toolCall.id)?.fileMutation, {
    files: [
      {
        after: "next",
        before: "current",
        changeType: "modify",
        path: "src/app.ts"
      }
    ],
    status: "completed",
    toolCallId: "tool-call-1",
    toolName: "edit_file"
  })
})

test("write_todos stays out of message tool activity after the todo state update is visible", () => {
  const todosToolCall = createToolCall("todo-call-1", "write_todos")
  const readToolCall = createToolCall("read-call-1", "read_file")
  const projection = projectMessages([
    createUserMessage("user-1", "Plan the work"),
    createAssistantMessage({
      id: "assistant-1",
      toolCalls: [todosToolCall, readToolCall]
    })
  ])
  const turn = projection.turns[0]!
  const entries = buildTurnAssistantEntries(turn)

  assert.equal(turn.toolResults.has(todosToolCall.id), false)
  assert.equal(turn.toolResults.has(readToolCall.id), false)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.kind, "agent-activity")
  assert.deepEqual(
    entries[0]?.kind === "agent-activity"
      ? entries[0].items.map((item) => (item.kind === "tool" ? item.toolCall.id : item.kind))
      : [],
    [readToolCall.id]
  )
})

test("task stays out of message tool activity after the subagent state update is visible", () => {
  const taskToolCall = createToolCall("task-call-1", "task", {
    description: "Review the staged diff",
    subagent_type: "code-reviewer"
  })
  const readToolCall = createToolCall("read-call-1", "read_file")
  const projection = projectMessages([
    createUserMessage("user-1", "Review this"),
    createAssistantMessage({
      id: "assistant-1",
      toolCalls: [taskToolCall, readToolCall]
    })
  ])
  const entries = buildTurnAssistantEntries(projection.turns[0]!)

  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.kind, "agent-activity")
  assert.deepEqual(
    entries[0]?.kind === "agent-activity"
      ? entries[0].items.map((item) => (item.kind === "tool" ? item.toolCall.id : item.kind))
      : [],
    [readToolCall.id]
  )
})

test("tool execution view derives from messages and runtime facts", () => {
  const runningToolCall = createToolCall("tool-call-1")
  const completedToolCall = createToolCall("tool-call-2")
  const failedToolCall = createToolCall("tool-call-3")
  const projection = projectMessages([
    createUserMessage("user-1", "Run tools"),
    createAssistantMessage({
      id: "assistant-1",
      toolCalls: [runningToolCall, completedToolCall, failedToolCall]
    }),
    createToolMessage({
      content: "done",
      id: "tool-result-2",
      toolCallId: completedToolCall.id
    }),
    createToolMessage({
      content: "failed",
      id: "tool-result-3",
      metadata: {
        [AGENT_TOOL_EXECUTION_METADATA_KEY]: {
          completedAt: "2026-01-01T00:00:02.500Z",
          durationMs: 1_500,
          error: { message: "Tool failed" },
          messageId: "tool-result-3",
          runId: "run-1",
          startedAt: "2026-01-01T00:00:01.000Z",
          status: "failed",
          toolCallId: failedToolCall.id,
          toolName: failedToolCall.name
        }
      },
      toolCallId: failedToolCall.id
    })
  ])
  const turn = projection.turns[0]!

  const runningView = projectTurnToolExecutionsView({
    activeToolCallId: null,
    activeToolCalls: [],
    pendingApproval: null,
    turn
  })

  assert.equal(runningView[runningToolCall.id], undefined)
  assert.deepEqual(runningView[completedToolCall.id], {
    status: "complete",
    toolCallId: completedToolCall.id
  })
  assert.equal(runningView[failedToolCall.id]?.status, "failed")
  assert.equal(runningView[failedToolCall.id]?.execution?.durationMs, 1_500)
  assert.equal(runningView[failedToolCall.id]?.execution?.error?.message, "Tool failed")

  const activeToolView = projectTurnToolExecutionsView({
    activeToolCallId: runningToolCall.id,
    activeToolCalls: [
      {
        argsText: "{}",
        id: runningToolCall.id,
        index: 0,
        messageId: "assistant-1",
        name: runningToolCall.name,
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "arguments_streaming"
      }
    ],
    pendingApproval: null,
    turn
  })

  assert.deepEqual(activeToolView[runningToolCall.id], {
    activeToolCall: {
      argsText: "{}",
      id: runningToolCall.id,
      index: 0,
      messageId: "assistant-1",
      name: runningToolCall.name,
      runId: "run-1",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "arguments_streaming"
    },
    status: "arguments_streaming",
    toolCallId: runningToolCall.id
  })
  assert.deepEqual(activeToolView[completedToolCall.id], {
    status: "complete",
    toolCallId: completedToolCall.id
  })
  assert.equal(activeToolView[failedToolCall.id]?.status, "failed")

  const queuedToolCall = createToolCall("tool-call-queued")
  const activeTurnProjection = projectMessages([
    createUserMessage("user-active", "Run two unresolved tools"),
    createAssistantMessage({
      id: "assistant-active",
      toolCalls: [runningToolCall, queuedToolCall]
    })
  ])
  const activeTurnView = projectTurnToolExecutionsView({
    activeToolCallId: runningToolCall.id,
    activeToolCalls: [
      {
        argsText: "{}",
        id: runningToolCall.id,
        index: 0,
        messageId: "assistant-active",
        name: runningToolCall.name,
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "arguments_streaming"
      }
    ],
    pendingApproval: null,
    turn: activeTurnProjection.turns[0]!
  })

  assert.equal(activeTurnView[queuedToolCall.id], undefined)

  const approval: HITLRequest = {
    allowed_decisions: ["approve", "reject"],
    id: "approval-1",
    review: null,
    tool_call: runningToolCall
  }
  const approvalView = projectTurnToolExecutionsView({
    activeToolCallId: runningToolCall.id,
    activeToolCalls: [],
    pendingApproval: approval,
    turn
  })

  assert.deepEqual(approvalView[runningToolCall.id], {
    status: "approval",
    toolCallId: runningToolCall.id
  })
  assert.deepEqual(approvalView[completedToolCall.id], runningView[completedToolCall.id])

  const finishedView = projectTurnToolExecutionsView({
    activeToolCallId: null,
    activeToolCalls: [],
    pendingApproval: null,
    turn
  })
  assert.equal(finishedView[runningToolCall.id], undefined)
  assert.deepEqual(finishedView[completedToolCall.id], {
    status: "complete",
    toolCallId: completedToolCall.id
  })
  assert.equal(finishedView[failedToolCall.id]?.status, "failed")
})

test("completed tool execution projection reads durable metadata only from tool result messages", () => {
  const toolCall = createToolCall("tool-call-1")
  const projection = projectMessages([
    createUserMessage("user-1", "Run tool"),
    createAssistantMessage({
      id: "assistant-1",
      toolCalls: [toolCall]
    }),
    createToolMessage({
      content: "done",
      id: "tool-result-1",
      toolCallId: toolCall.id
    })
  ])
  const turn = projection.turns[0]!

  const view = projectTurnToolExecutionsView({
    activeToolCallId: null,
    activeToolCalls: [],
    pendingApproval: null,
    turn
  })

  assert.deepEqual(view[toolCall.id], {
    status: "complete",
    toolCallId: toolCall.id
  })
})

test("turn elapsed divider derives running and completed timing from runtime facts", () => {
  const runningTurn = createTurn([createAssistantMessage({ id: "assistant-running" })])
  const runningProjection = projectTurnElapsedDivider({
    activeRunStartedAt: new Date("2026-01-01T00:00:01.000Z"),
    isStreaming: true,
    turn: runningTurn
  })

  assert.deepEqual(runningProjection, {
    completedAt: null,
    durationMs: null,
    startedAt: new Date("2026-01-01T00:00:01.000Z"),
    status: "working"
  })
  assert.equal(
    projectTurnElapsedDivider({
      activeRunStartedAt: null,
      isStreaming: true,
      turn: runningTurn
    }),
    null
  )

  const firstToolCall = createToolCall("tool-call-1", "read_file", {
    file_path: "/repo/src/index.ts"
  })
  const secondToolCall = createToolCall("tool-call-2", "grep", { pattern: "runtime" })
  const projection = projectMessages([
    createUserMessage("user-1", "Inspect files"),
    createAssistantMessage({
      id: "assistant-1",
      toolCalls: [firstToolCall, secondToolCall]
    }),
    createToolMessage({
      content: "done",
      id: "tool-result-1",
      metadata: {
        [AGENT_TOOL_EXECUTION_METADATA_KEY]: {
          completedAt: "2026-01-01T00:00:03.000Z",
          durationMs: 2_000,
          messageId: "tool-result-1",
          runId: "run-1",
          startedAt: "2026-01-01T00:00:01.000Z",
          status: "completed",
          toolCallId: firstToolCall.id,
          toolName: firstToolCall.name
        }
      },
      toolCallId: firstToolCall.id
    }),
    createToolMessage({
      content: "done",
      id: "tool-result-2",
      metadata: {
        [AGENT_TOOL_EXECUTION_METADATA_KEY]: {
          completedAt: "2026-01-01T00:00:06.000Z",
          durationMs: 2_000,
          messageId: "tool-result-2",
          runId: "run-1",
          startedAt: "2026-01-01T00:00:04.000Z",
          status: "completed",
          toolCallId: secondToolCall.id,
          toolName: secondToolCall.name
        }
      },
      toolCallId: secondToolCall.id
    })
  ])

  assert.deepEqual(
    projectTurnElapsedDivider({
      isStreaming: false,
      turn: projection.turns[0]!
    }),
    {
      completedAt: new Date("2026-01-01T00:00:06.000Z"),
      durationMs: 5_000,
      startedAt: new Date("2026-01-01T00:00:01.000Z"),
      status: "worked"
    }
  )
  assert.equal(
    projectTurnElapsedDivider({
      isStreaming: false,
      turn: runningTurn
    }),
    null
  )
})

test("agent activity summary groups known tool categories without using tool names", () => {
  assert.deepEqual(
    projectAgentActivitySummary([
      {
        status: "complete",
        toolCall: createToolCall("tool-read-1", "read_file", {
          file_path: "/repo/src/index.ts"
        })
      },
      {
        status: "complete",
        toolCall: createToolCall("tool-read-2", "read_file", {
          file_path: "/repo/src/main.tsx"
        })
      },
      {
        status: "complete",
        toolCall: createToolCall("tool-list", "ls", { path: "/repo/src" })
      },
      {
        status: "complete",
        toolCall: createToolCall("tool-edit", "edit_file", { path: "/repo/src/index.ts" })
      },
      {
        status: "complete",
        toolCall: createToolCall("tool-search", "grep", { pattern: "runtime" })
      },
      {
        status: "complete",
        toolCall: createToolCall("tool-command", "execute", { command: "npm test" })
      }
    ]),
    {
      activeCategory: null,
      counts: {
        command: 1,
        file_mutation: 1,
        file: 2,
        list: 1,
        search: 1
      },
      status: "complete"
    }
  )

  assert.deepEqual(
    projectAgentActivitySummary([
      {
        status: "complete",
        toolCall: createToolCall("tool-search", "grep", { pattern: "runtime" })
      },
      {
        status: "running",
        toolCall: createToolCall("tool-web", "web_search", { query: "Openwork runtime" })
      }
    ]),
    {
      activeCategory: "web_search",
      counts: {
        search: 1
      },
      status: "running"
    }
  )

  assert.equal(
    projectAgentActivitySummary([
      {
        status: "complete",
        toolCall: createToolCall("tool-read-missing-path", "read_file")
      }
    ]),
    null
  )
  assert.deepEqual(
    projectAgentActivitySummary([
      {
        status: "arguments_streaming",
        toolCall: createToolCall("tool-edit-partial", "edit_file")
      }
    ]),
    {
      activeCategory: "file_mutation",
      counts: {},
      status: "running"
    }
  )
  assert.equal(
    projectAgentActivitySummary([
      {
        status: "failed",
        toolCall: createToolCall("tool-read-failed", "read_file", {
          file_path: "/repo/src/index.ts"
        })
      }
    ]),
    null
  )
})

test("turn tool execution view only applies approval to the owning turn", () => {
  const firstToolCall = createToolCall("tool-call-1")
  const secondToolCall = createToolCall("tool-call-2")
  const projection = projectMessages([
    createUserMessage("user-1", "First tool"),
    createAssistantMessage({
      id: "assistant-1",
      toolCalls: [firstToolCall]
    }),
    createUserMessage("user-2", "Second tool"),
    createAssistantMessage({
      id: "assistant-2",
      toolCalls: [secondToolCall]
    })
  ])
  const approval: HITLRequest = {
    allowed_decisions: ["approve", "reject"],
    id: "approval-2",
    review: null,
    tool_call: secondToolCall
  }

  const firstTurnView = projectTurnToolExecutionsView({
    activeToolCallId: secondToolCall.id,
    activeToolCalls: [],
    pendingApproval: approval,
    turn: projection.turns[0]!
  })
  const secondTurnView = projectTurnToolExecutionsView({
    activeToolCallId: secondToolCall.id,
    activeToolCalls: [],
    pendingApproval: approval,
    turn: projection.turns[1]!
  })

  assert.equal(firstTurnView[firstToolCall.id], undefined)
  assert.deepEqual(secondTurnView[secondToolCall.id], {
    status: "approval",
    toolCallId: secondToolCall.id
  })
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
  assert.equal(nextProjection.displayRows[1], firstProjection.displayRows[1])
  assert.equal(nextProjection.displayRows.at(-1), firstProjection.displayRows.at(-1))
  assert.equal(nextProjection.activeAssistantId, "assistant-2")
})

test("streaming assistant fast path updates one turn without rebuilding display rows", () => {
  const messages = [
    createUserMessage("user-1", "First question"),
    createAssistantMessage({ content: "First answer", id: "assistant-1" }),
    createUserMessage("user-2", "Second question"),
    createAssistantMessage({ content: "Streaming", id: "assistant-2" })
  ]
  const firstProjection = projectMessages(messages)
  const result = updateProjectedMessage(
    firstProjection,
    createAssistantMessage({ content: "Streaming update", id: "assistant-2" }),
    {
      activeAssistantId: "assistant-2",
      activeTurnKey: "user-2"
    }
  )

  assert.equal(result.type, "hit")
  if (result.type !== "hit") {
    return
  }

  assert.equal(result.projection.displayRows, firstProjection.displayRows)
  assert.equal(result.projection.turns[0], firstProjection.turns[0])
  assert.notEqual(result.projection.turns[1], firstProjection.turns[1])
  assert.equal(result.projection.turns[1]?.user, firstProjection.turns[1]?.user)
  assert.equal(result.projection.turns[1]?.assistants[0]?.content, "Streaming update")
  assert.equal(result.projection.activeAssistantId, "assistant-2")
  assert.equal(result.projection.activeTurnKey, "user-2")
})

test("streaming assistant fast path keeps long history rows and inactive turns stable", () => {
  const messages = createLongConversationMessages(200)
  const firstProjection = projectMessages(messages)
  const activeTurnIndex = 199
  const activeAssistantId = `assistant-${activeTurnIndex}`
  const activeTurnKey = `user-${activeTurnIndex}`
  const result = updateProjectedMessage(
    firstProjection,
    createAssistantMessage({
      content: "Answer 199 plus streamed token",
      id: activeAssistantId
    }),
    {
      activeAssistantId,
      activeTurnKey
    }
  )

  assert.equal(result.type, "hit")
  if (result.type !== "hit") {
    return
  }

  assert.equal(result.projection.displayRows, firstProjection.displayRows)
  for (let index = 0; index < activeTurnIndex; index += 1) {
    assert.equal(result.projection.turns[index], firstProjection.turns[index])
    assert.equal(result.projection.displayRows[index], firstProjection.displayRows[index])
  }
  assert.notEqual(result.projection.turns[activeTurnIndex], firstProjection.turns[activeTurnIndex])
  assert.equal(
    result.projection.turns[activeTurnIndex]?.user,
    firstProjection.turns[activeTurnIndex]?.user
  )
  assert.equal(result.projection.activeAssistantId, activeAssistantId)
  assert.equal(result.projection.activeTurnKey, activeTurnKey)
})

test("streaming assistant fast path returns explicit miss reasons", () => {
  const projection = projectMessages([
    createUserMessage("user-1", "Question"),
    createAssistantMessage({ content: "Answer", id: "assistant-1" })
  ])
  const toolMiss = updateProjectedMessage(
    projection,
    createToolMessage({
      content: "tool result",
      id: "tool-1",
      toolCallId: "tool-call-1"
    })
  )
  const missingTurnMiss = updateProjectedMessage(
    projection,
    createAssistantMessage({ content: "Missing answer", id: "assistant-missing" })
  )

  assert.deepEqual(toolMiss, {
    reason: "message_role_not_assistant",
    type: "miss"
  })
  assert.deepEqual(missingTurnMiss, {
    reason: "turn_not_found",
    type: "miss"
  })
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

  assert.equal(projection.activeTurnKey, "user-2")
  assert.equal(projection.activeAssistantId, null)
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

  assert.equal(projection.activeTurnKey, null)
  assert.equal(projection.activeAssistantId, null)
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

test("active tool pending approval turn ownership is projected outside React components", () => {
  const toolCall = createToolCall("tool-call-streaming")
  const pendingApproval: HITLRequest = {
    allowed_decisions: ["approve", "reject"],
    id: "approval-streaming",
    review: null,
    tool_call: toolCall
  }
  const turn = createTurn([])

  assert.equal(
    getTurnPendingApproval(turn, pendingApproval),
    null,
    "no persisted assistant tool call should match the pending approval yet"
  )
  assert.equal(
    projectTurnPendingApproval({
      activeToolCalls: [
        {
          argsText: '{"path":"src/app.ts"}',
          id: toolCall.id,
          index: null,
          messageId: null,
          name: toolCall.name,
          runId: "run-1",
          startedAt: new Date("2026-01-01T00:00:00.000Z"),
          status: "waiting_result"
        }
      ],
      isActiveTurn: true,
      pendingApproval,
      turn
    }),
    pendingApproval
  )
  assert.equal(
    projectTurnPendingApproval({
      activeToolCalls: [
        {
          argsText: '{"path":"src/app.ts"}',
          id: toolCall.id,
          index: null,
          messageId: null,
          name: toolCall.name,
          runId: "run-1",
          startedAt: new Date("2026-01-01T00:00:00.000Z"),
          status: "waiting_result"
        }
      ],
      isActiveTurn: false,
      pendingApproval,
      turn
    }),
    null
  )
})

test("summarization messages project as context compaction rows outside turns", () => {
  const summaryMessage: Message = {
    ...createUserMessage("summary-1", "Summary of prior context"),
    metadata: {
      lc_source: "summarization"
    }
  }
  const projection = projectMessages([
    summaryMessage,
    createUserMessage("user-2", "Current question"),
    createAssistantMessage({ content: "Current answer", id: "assistant-2" })
  ])

  assert.equal(projection.turns.length, 1)
  assert.equal(projection.turns[0]?.key, "user-2")
  assert.deepEqual(
    projection.displayRows.map((row) => row.kind),
    ["context-compaction", "turn", "footer"]
  )
  assert.deepEqual(projection.displayRows[0], {
    kind: "context-compaction",
    key: "context-compaction:summary-1",
    messageId: "summary-1"
  })
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
