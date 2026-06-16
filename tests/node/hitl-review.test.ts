import assert from "node:assert/strict"
import test from "node:test"
import type { HitlRequestRow } from "../../src/main/db"
import {
  extractMessagesFromCheckpoint,
  extractHitlRequestFromCheckpoint,
  extractHitlRequestFromValuesState,
  mapHitlRowToRequest
} from "../../src/main/agent/runtime-state"

test("extractHitlRequestFromValuesState keeps review payload separate from tool args", () => {
  const request = extractHitlRequestFromValuesState("thread-1", "run-1", {
    messages: [
      {
        kwargs: {
          tool_calls: [
            {
              id: "tool-call-1",
              name: "write_file",
              args: {
                content: "hello",
                path: "/tmp/demo.txt"
              }
            }
          ]
        }
      }
    ],
    __interrupt__: [
      {
        value: {
          actionRequests: [
            {
              id: "tool-call-1",
              toolCallId: "tool-call-1",
              name: "write_file",
              args: {
                content: "hello",
                path: "/tmp/demo.txt"
              },
              review: {
                kind: "file_mutation",
                toolName: "write_file",
                path: "/tmp/demo.txt",
                content: "hello",
                oldText: null,
                newText: null,
                changes: [
                  {
                    path: "/tmp/demo.txt",
                    changeType: "create"
                  }
                ]
              }
            }
          ],
          reviewConfigs: [
            {
              actionName: "write_file",
              allowedDecisions: ["approve", "reject"]
            }
          ]
        }
      }
    ]
  })

  assert.deepEqual(request, {
    id: "hitl:thread-1:run-1:tool-call-1",
    tool_call: {
      id: "tool-call-1",
      name: "write_file",
      args: {
        content: "hello",
        path: "/tmp/demo.txt"
      }
    },
    allowed_decisions: ["approve", "reject"],
    review: {
      kind: "file_mutation",
      toolName: "write_file",
      path: "/tmp/demo.txt",
      content: "hello",
      oldText: null,
      newText: null,
      changes: [
        {
          path: "/tmp/demo.txt",
          changeType: "create"
        }
      ]
    }
  })
})

test("mapHitlRowToRequest restores review payload from dedicated columns", () => {
  const row: HitlRequestRow = {
    request_id: "request-1",
    thread_id: "thread-1",
    run_id: "run-1",
    tool_call_id: "tool-call-1",
    tool_name: "execute",
    tool_args: JSON.stringify({ command: "echo hello > file.txt" }),
    review_kind: "execute_command",
    review_payload: JSON.stringify({
      kind: "execute_command",
      toolName: "execute",
      command: "echo hello > file.txt",
      changes: [
        {
          path: "/workspace/file.txt",
          changeType: "create"
        }
      ],
      profile: "predictable_mutation",
      predictionStatus: "predicted",
      reason: "Command writes to local files through shell redirection."
    }),
    allowed_decisions: JSON.stringify(["approve", "reject"]),
    status: "pending",
    decision: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    resolved_at: null
  }

  assert.deepEqual(mapHitlRowToRequest(row), {
    id: "request-1",
    tool_call: {
      id: "tool-call-1",
      name: "execute",
      args: {
        command: "echo hello > file.txt"
      }
    },
    allowed_decisions: ["approve", "reject"],
    review: {
      kind: "execute_command",
      toolName: "execute",
      command: "echo hello > file.txt",
      changes: [
        {
          path: "/workspace/file.txt",
          changeType: "create"
        }
      ],
      profile: "predictable_mutation",
      predictionStatus: "predicted",
      reason: "Command writes to local files through shell redirection."
    }
  })
})

test("extractHitlRequestFromValuesState rejects interrupts without toolCallId", () => {
  assert.throws(
    () =>
      extractHitlRequestFromValuesState("thread-1", "run-1", {
        __interrupt__: [
          {
            value: {
              actionRequests: [
                {
                  id: "tool-call-1",
                  name: "write_file",
                  args: {
                    content: "hello",
                    path: "/tmp/demo.txt"
                  }
                }
              ]
            }
          }
        ]
      }),
    /Missing toolCallId/i
  )
})

test("extractHitlRequestFromCheckpoint prefers persisted run_id for request identity", () => {
  const request = extractHitlRequestFromCheckpoint(
    "thread-1",
    {
      checkpoint: {
        id: "checkpoint-1",
        channel_values: {
          __interrupt__: [
            {
              value: {
                actionRequests: [
                  {
                    toolCallId: "tool-call-1",
                    name: "write_file",
                    args: {
                      content: "hello",
                      path: "/tmp/demo.txt"
                    }
                  }
                ],
                reviewConfigs: [
                  {
                    actionName: "write_file",
                    allowedDecisions: ["approve", "reject"]
                  }
                ]
              }
            }
          ]
        }
      },
      config: {
        configurable: {
          thread_id: "thread-1",
          checkpoint_id: "checkpoint-1",
          run_id: "run-1"
        }
      },
      metadata: {}
    } as never
  )

  assert.deepEqual(request, {
    id: "hitl:thread-1:run-1:tool-call-1",
    tool_call: {
      id: "tool-call-1",
      name: "write_file",
      args: {
        content: "hello",
        path: "/tmp/demo.txt"
      }
    },
    allowed_decisions: ["approve", "reject"],
    review: null
  })
})

test("extractMessagesFromCheckpoint does not reinterpret OpenAI-style tool calls", () => {
  const rows = extractMessagesFromCheckpoint("thread-1", {
    checkpoint: {
      id: "checkpoint-1",
      channel_values: {
        messages: [
          {
            id: ["AIMessage"],
            kwargs: {
              additional_kwargs: {
                tool_calls: [
                  {
                    function: {
                      arguments: '{"path":"README.md"}'
                    },
                    id: "tool-call-nameless",
                    type: "function"
                  },
                  {
                    function: {
                      arguments: '{"path":"README.md"}',
                      name: "read_file"
                    },
                    id: "tool-call-complete",
                    type: "function"
                  }
                ]
              },
              content: "",
              id: "assistant-checkpoint"
            }
          }
        ]
      }
    }
  } as never)

  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.message_id, "assistant-checkpoint")
  assert.equal(rows[0]?.tool_calls, null)
  assert.doesNotMatch(rows[0]?.content ?? "", /unknown|checkpoint-tool/)
})

test("extractMessagesFromCheckpoint restores canonical checkpoint tool calls", () => {
  const rows = extractMessagesFromCheckpoint("thread-1", {
    checkpoint: {
      id: "checkpoint-1",
      channel_values: {
        messages: [
          {
            id: ["AIMessage"],
            kwargs: {
              content: "",
              id: "assistant-checkpoint",
              tool_calls: [
                {
                  args: {
                    path: "README.md"
                  },
                  id: "tool-call-complete",
                  name: "read_file",
                  type: "tool_call"
                }
              ]
            }
          }
        ]
      }
    }
  } as never)

  assert.equal(rows.length, 1)
  assert.deepEqual(JSON.parse(rows[0]?.tool_calls ?? "[]"), [
    {
      args: {
        path: "README.md"
      },
      id: "tool-call-complete",
      name: "read_file",
      type: "tool_call"
    }
  ])
})

test("extractMessagesFromCheckpoint preserves summarization message source metadata", () => {
  const rows = extractMessagesFromCheckpoint("thread-1", {
    checkpoint: {
      id: "checkpoint-1",
      channel_values: {
        messages: [
          {
            id: ["HumanMessage"],
            kwargs: {
              additional_kwargs: {
                lc_source: "summarization"
              },
              content: "Summary of prior context",
              id: "summary-message"
            }
          }
        ]
      }
    }
  } as never)

  assert.equal(rows.length, 1)
  assert.deepEqual(JSON.parse(rows[0]?.metadata ?? "{}"), {
    lc_source: "summarization"
  })
})

test("mapHitlRowToRequest rejects rows without tool_call_id", () => {
  const row: HitlRequestRow = {
    request_id: "request-1",
    thread_id: "thread-1",
    run_id: "run-1",
    tool_call_id: null,
    tool_name: "execute",
    tool_args: JSON.stringify({ command: "echo hello > file.txt" }),
    review_kind: null,
    review_payload: null,
    allowed_decisions: JSON.stringify(["approve", "reject"]),
    status: "pending",
    decision: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    resolved_at: null
  }

  assert.throws(() => mapHitlRowToRequest(row), /missing tool_call_id/i)
})
