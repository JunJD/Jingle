import assert from "node:assert/strict"
import test from "node:test"
import { projectAgentActivityHeaderSummary } from "../../src/renderer/src/components/chat/agent-activity-summary"
import { appCopy } from "../../src/renderer/src/lib/i18n/messages"
import type { HITLRequest, ToolCall } from "../../src/renderer/src/types"
import type { ReactNode } from "react"

const copy = appCopy["en-US"]

function displayText(view: { display: { detail: ReactNode | null; resultMeta: ReactNode | null; title: ReactNode } }): string {
  return [view.display.title, view.display.detail, view.display.resultMeta]
    .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    .map(String)
    .join(" · ")
}

function setRendererWindowStub(): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      api: {
        models: {},
        threads: {}
      }
    }
  })
}

test("createActionMessageView requires a registered renderer or extension presentation", async () => {
  setRendererWindowStub()

  const toolCall: ToolCall = {
    args: {
      title: "Review quarterly budget report"
    },
    id: "call_1",
    name: "ext__appleReminders__createReminder",
    type: "tool_call"
  }
  const approvalRequest: HITLRequest = {
    allowed_decisions: ["approve", "reject"],
    id: "hitl:thread:run:call_1",
    review: {
      access: "write",
      args: toolCall.args,
      capabilityDisplayName: "Apple Reminders",
      capabilityId: "appleReminders",
      extensionName: "apple-reminders",
      kind: "extension_tool",
      permissionMode: "ask-to-edit",
      reason: "Ask to Edit mode requires approval for write and external extension tools.",
      toolName: "ext__appleReminders__createReminder",
      toolTitle: "Create Reminder"
    },
    tool_call: toolCall
  }
  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  assert.throws(
    () =>
      createActionMessageView({
        approvalRequest,
        copy,
        presentation: "grouped",
        toolCall
      }),
    /No chat tool renderer registered for tool "ext__appleReminders__createReminder"\./
  )
})

test("createActionMessageView does not repeat the list directory label when no path is shown", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  const baseToolCall: ToolCall = {
    args: {},
    id: "call_ls",
    name: "ls",
    type: "tool_call"
  }

  const currentDirectoryView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: [],
    toolCall: baseToolCall
  })

  assert.equal(displayText(currentDirectoryView), "List Directory")
  assert.equal(currentDirectoryView.display.detail, null)

  const listedDirectoryView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: "/Users/example/project/src (directory)\n/Users/example/project/package.json (42 bytes)",
    toolCall: baseToolCall
  })

  assert.equal(displayText(listedDirectoryView), "List Directory · 1 file, 1 folder")
  assert.equal(listedDirectoryView.display.detail, "1 file, 1 folder")

  const nestedDirectoryView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: [],
    toolCall: {
      ...baseToolCall,
      args: {
        path: "/Users/example/project/src"
      }
    }
  })

  assert.equal(displayText(nestedDirectoryView), "List Directory · src")
  assert.equal(nestedDirectoryView.display.detail, "src")
})

test("createActionMessageView does not repeat the read file label when no path is shown", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  const baseToolCall: ToolCall = {
    args: {},
    id: "call_read",
    name: "read_file",
    type: "tool_call"
  }

  const currentFileView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: "hello",
    toolCall: baseToolCall
  })

  assert.equal(displayText(currentFileView), "Read File · Read 1 line")
  assert.equal(currentFileView.display.detail, "Read 1 line")

  const nestedFileView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: "hello",
    toolCall: {
      ...baseToolCall,
      args: {
        path: "/Users/example/project/src/index.ts"
      }
    }
  })

  assert.equal(displayText(nestedFileView), "Read File · index.ts")
  assert.equal(nestedFileView.display.detail, "index.ts")
})

test("createActionMessageView gives write todos a progress detail from official args", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  const view = createActionMessageView({
    copy,
    presentation: "grouped",
    toolCall: {
      args: {
        todos: [
          {
            content: "Inspect runtime facts",
            id: "todo_1",
            status: "completed"
          },
          {
            content: "Tighten renderer projection",
            id: "todo_2",
            status: "in_progress"
          }
        ]
      },
      id: "call_todos",
      name: "write_todos",
      type: "tool_call"
    }
  })

  assert.equal(displayText(view), "Update Tasks · 1/2 done")
  assert.equal(view.display.detail, "1/2 done")
})

test("createActionMessageView does not repeat file mutation labels when no path is shown", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  const baseToolCall: ToolCall = {
    args: {
      content: "first\nsecond"
    },
    id: "call_write",
    name: "write_file",
    type: "tool_call"
  }

  const fileWithoutPathView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: "done",
    toolCall: baseToolCall
  })

  assert.equal(displayText(fileWithoutPathView), "Write File")

  const fileWithPathView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: "done",
    toolCall: {
      ...baseToolCall,
      args: {
        content: "first\nsecond",
        path: "/Users/example/project/notes.md"
      }
    }
  })

  assert.equal(displayText(fileWithPathView), "Write File · notes.md · Writing 2 lines to notes.md")
})

test("createActionMessageView keeps read search list command summaries descriptive", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  const commandView = createActionMessageView({
    copy,
    presentation: "grouped",
    toolCall: {
      args: { command: "npm run test:node -- tests/node/message-projection.test.ts" },
      id: "call_execute",
      name: "execute",
      type: "tool_call"
    }
  })
  const globView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: ["src/renderer/src/lib/message-projection.ts"],
    toolCall: {
      args: { pattern: "src/**/*.ts" },
      id: "call_glob",
      name: "glob",
      type: "tool_call"
    }
  })
  const grepView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: [{ line: 12, path: "src/renderer/src/lib/message-projection.ts", text: "runtime" }],
    toolCall: {
      args: { pattern: "runtime" },
      id: "call_grep",
      name: "grep",
      type: "tool_call"
    }
  })
  const webSearchView = createActionMessageView({
    copy,
    presentation: "grouped",
    toolCall: {
      args: { query: "Openwork agent runtime" },
      id: "call_web_search",
      name: "web_search",
      type: "tool_call"
    }
  })

  assert.equal(
    displayText(commandView),
    "Execute Command · npm run test:node -- tests/node/message-projection.test.ts"
  )
  assert.equal(displayText(globView), "Find Files · src/**/*.ts · Found 1 match")
  assert.equal(displayText(grepView), "Search Content · runtime · 1 match in 1 file")
  assert.equal(displayText(webSearchView), "Search Web · Openwork agent runtime")
})

test("createActionMessageView renders explicit extension display and presentation", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  const view = createActionMessageView({
    copy,
    presentation: "grouped",
    toolCall: {
      args: {},
      display: {
        description: "Generate Image from image-generation.",
        title: "Generate Image"
      },
      id: "tool-call-extension",
      name: "callExtension",
      presentation: {
        access: "external",
        capabilityDisplayName: "image-generation",
        capabilityTitle: "Image Generation",
        kind: "extension"
      },
      type: "tool_call"
    }
  })

  assert.equal(displayText(view), "Generate Image · image-generation")
  assert.equal(view.display.title, "Generate Image")
})

test("projectAgentActivityHeaderSummary summarizes completed exploration tools", () => {
  const summary = projectAgentActivityHeaderSummary(copy, [
    {
      status: "complete",
      toolCall: {
        args: { file_path: "/repo/src/index.ts" },
        id: "call_read_index",
        name: "read_file",
        type: "tool_call"
      }
    },
    {
      status: "complete",
      toolCall: {
        args: { file_path: "/repo/src/main.tsx" },
        id: "call_read_main",
        name: "read_file",
        type: "tool_call"
      }
    },
    {
      status: "complete",
      toolCall: {
        args: { path: "/repo/src" },
        id: "call_ls",
        name: "ls",
        type: "tool_call"
      }
    },
    {
      status: "complete",
      toolCall: {
        args: { pattern: "runtime" },
        id: "call_grep",
        name: "grep",
        type: "tool_call"
      }
    }
  ])

  assert.deepEqual(summary, {
    detail: "2 files · 1 search · 1 list",
    icon: "file",
    title: "Explored"
  })
})

test("projectAgentActivityHeaderSummary keeps pending exploration local and excludes unsafe summaries", () => {
  assert.deepEqual(
    projectAgentActivityHeaderSummary(copy, [
      {
        status: "running",
        toolCall: {
          args: { file_path: "/repo/src/index.ts" },
          id: "call_read",
          name: "read_file",
          type: "tool_call"
        }
      }
    ]),
    {
      detail: "1 file",
      icon: "file",
      title: "Reading file"
    }
  )

  assert.deepEqual(
    projectAgentActivityHeaderSummary(copy, [
      {
        status: "complete",
        toolCall: {
          args: { command: "npm test" },
          id: "call_execute",
          name: "execute",
          type: "tool_call"
        }
      }
    ]),
    {
      detail: "1 command",
      icon: "command",
      title: "Ran"
    }
  )

  assert.equal(
    projectAgentActivityHeaderSummary(copy, [
      {
        status: "failed",
        toolCall: {
          args: { file_path: "/repo/src/index.ts" },
          id: "call_failed_read",
          name: "read_file",
          type: "tool_call"
        }
      }
    ]),
    null
  )

  assert.equal(
    projectAgentActivityHeaderSummary(copy, [
      {
        status: "complete",
        toolCall: {
          args: {},
          id: "call_read_missing_path",
          name: "read_file",
          type: "tool_call"
        }
      }
    ]),
    null
  )
})
