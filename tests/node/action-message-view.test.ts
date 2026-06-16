import assert from "node:assert/strict"
import test from "node:test"
import {
  projectAgentActivityFallbackHeaderText,
  projectAgentActivityHeaderSummary
} from "../../src/renderer/src/components/chat/agent-activity-summary"
import { appCopy } from "../../src/renderer/src/lib/i18n/messages"
import type { HITLRequest, ToolCall } from "../../src/renderer/src/types"
import type { FileMutationResultMetadata } from "../../src/shared/file-mutation-result"
import type { ReactNode } from "react"
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

  assert.equal(displayText(fileWithPathView), "Write File · notes.md · Writing 2 lines to notes.md")
})

test("createActionMessageView does not build file mutation detail from tool args", async () => {
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
})

test("createActionMessageView renders streaming file mutation args without inventing args facts", async () => {
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

  assert.equal(displayText(partialView), "Write File")
  assert.equal(partialView.model.fileMutation?.kind, "partial_args")
  assert.notEqual(partialDetail, null)

  const completeView = createActionMessageView({
    activeArgsText: '{"path":"src/notes.md","content":"first\\nsecond"}',
    copy,
    presentation: "grouped",
    status: "arguments_streaming",
    toolCall
  })

  assert.equal(displayText(completeView), "Write File · notes.md · +2")
  assert.equal(completeView.model.fileMutation?.kind, "view")
  if (completeView.model.fileMutation?.kind === "view") {
    assert.equal(completeView.model.fileMutation.viewModel.source, "streaming_preview")
    assert.equal(completeView.model.fileMutation.viewModel.status, "pending")
    assert.equal(completeView.model.fileMutation.viewModel.files[0]?.path, "src/notes.md")
    assert.equal(completeView.model.fileMutation.viewModel.files[0]?.diffMode, "code")
  }
})

test("file mutation view model keeps partial args out of pending diff previews", () => {
  const projection = buildStreamingFileMutationViewModel({
    argsText: '{"path":"src/',
    toolCallId: "call_write",
    toolName: "write_file"
  })

  assert.deepEqual(projection, {
    kind: "partial_args",
    rawArgs: '{"path":"src/'
  })
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

test("completed file mutation view model only uses completed result facts", async () => {
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
  const rawOnlyView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: "wrote src/notes.md",
    toolCall
  })

  assert.equal(rawOnlyView.model.fileMutation?.kind, "raw_result")

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

  assert.equal(structuredView.model.fileMutation?.kind, "raw_result")
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
    },
    {
      status: "complete",
      toolCall: {
        args: { path: "/repo/src/index.ts", oldText: "old", newText: "new" },
        id: "call_edit_index",
        name: "edit_file",
        type: "tool_call"
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
          name: "read_file",
          type: "tool_call"
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
          name: "edit_file",
          type: "tool_call"
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
          name: "ls",
          type: "tool_call"
        }
      },
      {
        status: "running",
        toolCall: {
          args: { path: "/repo/blog" },
          id: "call_list_blog",
          name: "ls",
          type: "tool_call"
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
