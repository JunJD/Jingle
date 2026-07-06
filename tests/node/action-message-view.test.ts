import assert from "node:assert/strict"
import test from "node:test"
import {
  projectAgentActivityFallbackHeaderText,
  projectAgentActivityHeaderSummary
} from "../../src/renderer/src/components/chat/agent-activity-summary"
import { appCopy } from "../../src/renderer/src/lib/i18n/messages"
import type { HITLRequest, ToolCall } from "../../src/renderer/src/types"
import type { FileMutationResultMetadata } from "../../src/shared/file-mutation-result"
import { serializeContextRetrievalToolResult } from "../../src/shared/context-retrieval-results"
import type { ReactNode } from "react"
import { Circle } from "lucide-react"
import {
  buildPatchArtifactFileMutationViewModel,
  buildStreamingFileMutationViewModel
} from "../../src/renderer/src/components/chat/tools/file-mutation-view-model"

const copy = appCopy["en-US"]

function displayText(view: {
  display: { detail: ReactNode | null; resultMeta: ReactNode | null; title: ReactNode }
}): string {
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

test("tool renderer registry can unregister a temporary renderer without fallback", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")
  const { registerToolComponent } = await import("../../src/renderer/src/components/chat/tools")

  const dispose = registerToolComponent({
    icon: Circle,
    name: "temporary_tool",
    renderDisplay: () => ({ title: "Temporary Tool" })
  })
  const toolCall: ToolCall = {
    args: {},
    id: "call_temporary",
    name: "temporary_tool",
    type: "tool_call"
  }

  assert.equal(
    displayText(
      createActionMessageView({
        copy,
        presentation: "grouped",
        toolCall
      })
    ),
    "Temporary Tool"
  )

  dispose()

  assert.throws(
    () =>
      createActionMessageView({
        copy,
        presentation: "grouped",
        toolCall
      }),
    /No chat tool renderer registered for tool "temporary_tool"\./
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
    result:
      "/Users/example/project/src (directory)\n/Users/example/project/package.json (42 bytes)",
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

  assert.equal(displayText(fileWithPathView), "Write File · notes.md")
})

test("createActionMessageView builds file mutation detail from tool args without raw text", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  const toolCall: ToolCall = {
    args: {
      content: "first\nsecond",
      path: "/Users/example/project/notes.md"
    },
    id: "call_write",
    name: "write_file",
    type: "tool_call"
  }

  const runningView = createActionMessageView({
    copy,
    presentation: "grouped",
    toolCall
  })
  const runningDetail =
    runningView.definition.renderDetail?.({
      copy,
      isExpanded: true,
      presentation: "grouped",
      toolCall,
      ...runningView.model
    }) ?? null

  assert.equal(runningDetail, null)

  const completedView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: "wrote notes.md",
    toolCall
  })
  const completedDetail =
    completedView.definition.renderDetail?.({
      copy,
      isExpanded: true,
      presentation: "grouped",
      toolCall,
      ...completedView.model
    }) ?? null

  assert.notEqual(completedDetail, null)
  assert.equal(completedView.hasDetail, true)
  assert.equal(completedView.model.fileMutation?.kind, "view")
  if (completedView.model.fileMutation?.kind === "view") {
    assert.equal(completedView.model.fileMutation.viewModel.source, "tool_args_preview")
    assert.equal(completedView.model.fileMutation.viewModel.files[0]?.after, "first\nsecond")
    assert.equal(completedView.model.fileMutation.viewModel.files[0]?.path, "/Users/example/project/notes.md")
  }
})

test("createActionMessageView renders partial streaming file mutation previews", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  const toolCall: ToolCall = {
    args: {},
    id: "call_write",
    name: "write_file",
    type: "tool_call"
  }

  const partialView = createActionMessageView({
    activeArgsText: '{"path":"src/',
    copy,
    presentation: "grouped",
    status: "arguments_streaming",
    toolCall
  })
  const partialDetail =
    partialView.definition.renderDetail?.({
      copy,
      isExpanded: true,
      presentation: "grouped",
      toolCall,
      ...partialView.model
    }) ?? null

  assert.equal(displayText(partialView), "Write File · src/")
  assert.deepEqual(partialView.model.fileMutation, {
    kind: "pending_args",
    path: "src/",
    toolName: "write_file"
  })
  assert.equal(partialDetail, null)
  assert.equal(partialView.hasDetail, false)

  const contentView = createActionMessageView({
    activeArgsText: '{"path":"src/notes.md","content":"first',
    copy,
    presentation: "grouped",
    status: "arguments_streaming",
    toolCall
  })

  const contentDetail =
    contentView.definition.renderDetail?.({
      copy,
      isExpanded: true,
      presentation: "grouped",
      toolCall,
      ...contentView.model
    }) ?? null

  assert.equal(displayText(contentView), "Write File · notes.md")
  assert.equal(contentView.model.fileMutation?.kind, "view")
  assert.equal(contentView.hasDetail, true)
  assert.notEqual(contentDetail, null)
  if (contentView.model.fileMutation?.kind === "view") {
    assert.equal(contentView.model.fileMutation.viewModel.source, "streaming_preview")
    assert.equal(contentView.model.fileMutation.viewModel.status, "pending")
    assert.equal(contentView.model.fileMutation.viewModel.files[0]?.after, "first")
    assert.equal(contentView.model.fileMutation.viewModel.files[0]?.path, "src/notes.md")
  }
})

test("file mutation view model derives streaming previews from partial args", () => {
  const projection = buildStreamingFileMutationViewModel({
    argsText: '{"path":"src/notes.md","content":"first',
    toolCallId: "call_write",
    toolName: "write_file"
  })

  assert.equal(projection?.kind, "view")
  if (projection?.kind === "view") {
    assert.equal(projection.viewModel.source, "streaming_preview")
    assert.equal(projection.viewModel.status, "pending")
    assert.equal(projection.viewModel.files[0]?.path, "src/notes.md")
    assert.equal(projection.viewModel.files[0]?.after, "first")
  }
})

test("file mutation approval preview uses pending Pierre view model facts", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")
  const toolCall: ToolCall = {
    args: {
      old_str: "export const value = 1\n",
      new_str: "export const value = 2\n",
      path: "/workspace/src/app.ts"
    },
    id: "call_edit",
    name: "edit_file",
    type: "tool_call"
  }
  const approvalRequest: HITLRequest = {
    allowed_decisions: ["approve", "reject"],
    id: "hitl:thread:run:call_edit",
    review: {
      changes: [{ changeType: "modify", path: "/workspace/src/app.ts" }],
      content: null,
      kind: "file_mutation",
      newText: "export const value = 2\n",
      oldText: "export const value = 1\n",
      path: "/workspace/src/app.ts",
      toolName: "edit_file"
    },
    tool_call: toolCall
  }

  const view = createActionMessageView({
    approvalRequest,
    copy,
    presentation: "grouped",
    toolCall
  })

  assert.equal(view.model.status, "approval")
  assert.equal(view.model.fileMutation?.kind, "view")
  if (view.model.fileMutation?.kind === "view") {
    assert.equal(view.model.fileMutation.viewModel.source, "approval_preview")
    assert.equal(view.model.fileMutation.viewModel.status, "pending")
    assert.equal(view.model.fileMutation.viewModel.files[0]?.diffMode, "diff")
  }
})

test("completed file mutation view model renders only completed result facts", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")
  const toolCall: ToolCall = {
    args: {
      content: "draft",
      path: "src/notes.md"
    },
    id: "call_write",
    name: "write_file",
    type: "tool_call"
  }
  const missingMetadataView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: "wrote src/notes.md",
    toolCall
  })

  assert.equal(missingMetadataView.model.fileMutation?.kind, "view")
  assert.equal(missingMetadataView.hasDetail, true)
  if (missingMetadataView.model.fileMutation?.kind === "view") {
    assert.equal(missingMetadataView.model.fileMutation.viewModel.source, "tool_args_preview")
    assert.equal(missingMetadataView.model.fileMutation.viewModel.files[0]?.after, "draft")
  }

  const completedFileMutationResult: FileMutationResultMetadata = {
    files: [
      {
        after: "first\nsecond",
        before: null,
        changeType: null,
        path: "src/notes.md"
      }
    ],
    status: "completed",
    toolCallId: "call_write",
    toolName: "write_file"
  }
  const metadataView = createActionMessageView({
    copy,
    fileMutationResult: completedFileMutationResult,
    presentation: "grouped",
    result: "Successfully wrote to 'src/notes.md'",
    toolCall
  })

  assert.equal(metadataView.model.fileMutation?.kind, "view")
  if (metadataView.model.fileMutation?.kind === "view") {
    assert.equal(metadataView.model.fileMutation.viewModel.source, "completed_result")
    assert.equal(metadataView.model.fileMutation.viewModel.status, "completed")
    assert.equal(metadataView.model.fileMutation.viewModel.files[0]?.after, "first\nsecond")
    assert.equal(metadataView.model.fileMutation.viewModel.files[0]?.changeType, null)
    assert.equal(metadataView.model.fileMutation.viewModel.files[0]?.diffMode, "code")
  }

  const structuredView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: {
      files: [
        {
          changeType: "create",
          content: "first\nsecond",
          path: "src/notes.md"
        }
      ]
    },
    toolCall
  })

  assert.equal(structuredView.model.fileMutation?.kind, "view")
  assert.equal(structuredView.hasDetail, true)
  if (structuredView.model.fileMutation?.kind === "view") {
    assert.equal(structuredView.model.fileMutation.viewModel.source, "tool_args_preview")
  }
})

test("patch artifacts project multi-file changes into the Pierre file mutation model", () => {
  const viewModel = buildPatchArtifactFileMutationViewModel({
    patchText: [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/b.ts b/src/b.ts",
      "new file mode 100644",
      "index 0000000..3333333",
      "--- /dev/null",
      "+++ b/src/b.ts",
      "@@ -0,0 +1 @@",
      "+created"
    ].join("\n"),
    title: "Patch"
  })

  assert.equal(viewModel.source, "artifact")
  assert.equal(viewModel.status, "completed")
  assert.deepEqual(
    viewModel.files.map((file) => [file.path, file.diffMode, file.changeType]),
    [
      ["src/a.ts", "diff", "modify"],
      ["src/b.ts", "diff", "create"]
    ]
  )
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
      args: { query: "Jingle agent runtime" },
      id: "call_web_search",
      name: "web_search",
      type: "tool_call"
    }
  })
  const searchHistoryView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: "Retrieved history content should stay out of the tool activity detail.",
    toolCall: {
      args: { query: "old runtime decision" },
      id: "call_search_history",
      name: "search_history",
      type: "tool_call"
    }
  })
  const messageContextView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: "Retrieved message content should stay out of the tool activity detail.",
    toolCall: {
      args: { messageId: "msg_0123456789abcdef", threadId: "thread_0123456789abcdef" },
      id: "call_get_message_context",
      name: "get_message_context",
      type: "tool_call"
    }
  })
  const traceEvidenceView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: "Retrieved trace content should stay out of the tool activity detail.",
    toolCall: {
      args: { traceStepId: "trace_step_0123456789abcdef" },
      id: "call_get_trace_evidence",
      name: "get_trace_evidence",
      type: "tool_call"
    }
  })

  assert.equal(
    displayText(commandView),
    "Execute Command · npm run test:node -- tests/node/message-projection.test.ts"
  )
  assert.equal(displayText(globView), "Find Files · src/**/*.ts · Found 1 match")
  assert.equal(displayText(grepView), "Search Content · runtime · 1 match in 1 file")
  assert.equal(displayText(webSearchView), "Search Web · Jingle agent runtime")
  assert.equal(displayText(searchHistoryView), "Search History · old runtime decision")
  assert.equal(
    displayText(messageContextView),
    "Read Message Context · thread_0123456789abcdef · msg_0123456789abcdef"
  )
  assert.equal(displayText(traceEvidenceView), "Read Trace Evidence · trace_step_0123456789abcdef")
  assert.equal(searchHistoryView.hasDetail, false)
  assert.equal(messageContextView.hasDetail, false)
  assert.equal(traceEvidenceView.hasDetail, false)
})

test("createActionMessageView expands structured context retrieval results", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  const toolCall: ToolCall = {
    args: { query: "history" },
    id: "call_search_history_structured",
    name: "search_history",
    type: "tool_call"
  }
  const view = createActionMessageView({
    copy,
    presentation: "grouped",
    result: serializeContextRetrievalToolResult({
      items: [
        {
          messageId: "message-1",
          role: "assistant",
          runId: "run-1",
          snippet: "History result body",
          threadId: "thread-1",
          toolCallId: null,
          toolCalls: [],
          type: "history_message"
        }
      ],
      kind: "history_search",
      nextActions: [
        {
          args: {
            after: 2,
            before: 2,
            messageId: "message-1",
            threadId: "thread-1"
          },
          reason: "Expand transcript context around thread-1/message-1.",
          tool: "get_message_context"
        }
      ],
      query: "history",
      status: "ok",
      summary: "Found 0 thread digest match(es) and 1 history message match(es)."
    }),
    toolCall
  })

  const detail =
    view.definition.renderDetail?.({
      copy,
      isExpanded: true,
      presentation: "grouped",
      toolCall,
      ...view.model
    }) ?? null

  assert.equal(view.hasDetail, true)
  assert.notEqual(detail, null)
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
        description: "Search GitHub repositories from GitHub.",
        title: "Search Repositories"
      },
      id: "tool-call-extension",
      name: "callExtension",
      presentation: {
        access: "external",
        capabilityDisplayName: "GitHub",
        capabilityTitle: "GitHub",
        kind: "extension"
      },
      type: "tool_call"
    }
  })

  assert.equal(displayText(view), "Search Repositories · GitHub")
  assert.equal(view.display.title, "Search Repositories")
})

test("projectAgentActivityHeaderSummary summarizes completed exploration tools", () => {
  const summary = projectAgentActivityHeaderSummary(copy, [
    {
      status: "complete",
      toolCall: {
        args: { file_path: "/repo/src/index.ts" },
        id: "call_read_index",
        name: "read_file"
      }
    },
    {
      status: "complete",
      toolCall: {
        args: { file_path: "/repo/src/main.tsx" },
        id: "call_read_main",
        name: "read_file"
      }
    },
    {
      status: "complete",
      toolCall: {
        args: { path: "/repo/src" },
        id: "call_ls",
        name: "ls"
      }
    },
    {
      status: "complete",
      toolCall: {
        args: { pattern: "runtime" },
        id: "call_grep",
        name: "grep"
      }
    },
    {
      status: "complete",
      toolCall: {
        args: { path: "/repo/src/index.ts", oldText: "old", newText: "new" },
        id: "call_edit_index",
        name: "edit_file"
      }
    }
  ])

  assert.deepEqual(summary, {
    detail: "2 files · 1 change · 1 search · 1 list",
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
          name: "read_file"
        }
      }
    ]),
    {
      detail: null,
      icon: "file",
      title: "Reading file"
    }
  )

  assert.deepEqual(
    projectAgentActivityHeaderSummary(copy, [
      {
        status: "running",
        toolCall: {
          args: { path: "/repo/src/index.ts", oldText: "old", newText: "new" },
          id: "call_edit",
          name: "edit_file"
        }
      }
    ]),
    {
      detail: null,
      icon: "pencil",
      title: "Editing file"
    }
  )

  assert.deepEqual(
    projectAgentActivityHeaderSummary(copy, [
      {
        status: "complete",
        toolCall: {
          args: { path: "/repo/src" },
          id: "call_list_src",
          name: "ls"
        }
      },
      {
        status: "running",
        toolCall: {
          args: { path: "/repo/blog" },
          id: "call_list_blog",
          name: "ls"
        }
      }
    ]),
    {
      detail: "1 list",
      icon: "folder",
      title: "Listing directory"
    }
  )

  assert.deepEqual(
    projectAgentActivityHeaderSummary(copy, [
      {
        status: "complete",
        toolCall: {
          args: { command: "npm test" },
          id: "call_execute",
          name: "execute"
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
          name: "read_file"
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
          name: "read_file"
        }
      }
    ]),
    null
  )
})

test("projectAgentActivityFallbackHeaderText keeps grouped loading headers stable", () => {
  assert.deepEqual(
    projectAgentActivityFallbackHeaderText(copy, {
      hasApprovalActions: false,
      hasLoadingActions: true,
      itemsLength: 3
    }),
    {
      detail: null,
      title: "Using tools"
    }
  )

  assert.deepEqual(
    projectAgentActivityFallbackHeaderText(copy, {
      hasApprovalActions: true,
      hasLoadingActions: true,
      itemsLength: 3
    }),
    {
      detail: null,
      title: "Waiting for your confirmation"
    }
  )

  assert.deepEqual(
    projectAgentActivityFallbackHeaderText(copy, {
      hasApprovalActions: false,
      hasLoadingActions: false,
      itemsLength: 3
    }),
    {
      detail: null,
      title: "3 steps completed"
    }
  )
})
