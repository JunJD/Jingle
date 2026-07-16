import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  projectAgentActivityFallbackHeaderText,
  projectAgentActivityHeaderSummary
} from "../../src/renderer/src/components/chat/agent-activity-summary"
import { searchWeb } from "../../src/main/services/web-tools/search"
import { appCopy } from "../../src/renderer/src/lib/i18n/messages"
import type { HITLRequest, ToolCall } from "../../src/renderer/src/types"
import type { FileMutationResultMetadata } from "../../src/shared/file-mutation-result"
import {
  parseContextRetrievalToolResult,
  serializeContextRetrievalToolResult,
  type ContextRetrievalToolResult,
  type TraceEvidenceToolResult
} from "../../src/shared/context-retrieval-results"
import { normalizeWebSearchQuery, parseWebSearchResponse } from "../../src/shared/web-search"
import { Children, isValidElement, type ElementType, type ReactNode } from "react"
import { Circle } from "lucide-react"
import { buildStreamingFileMutationViewModel } from "../../src/renderer/src/components/chat/tools/file-mutation-view-model"
import { projectFileMutationTool } from "../../src/renderer/src/components/chat/tools/file-mutation-presentation"
import { projectToolProjectionFacts } from "../../src/renderer/src/components/chat/tools/normalize"
import { ToolContractNotice } from "../../src/renderer/src/components/chat/tools/shared-components"
import { projectActionMessageCollapse } from "../../src/renderer/src/components/chat/action-message-collapse"

const copy = appCopy["en-US"]
const TEST_THREAD_ID = "thread-action-message-view"

test("ActionMessage maps the existing expansion contract onto content-card collapse", () => {
  assert.deepEqual(
    projectActionMessageCollapse({
      approvalRequired: false,
      defaultExpanded: false,
      hasDetail: true
    }),
    { collapsed: undefined, defaultCollapsed: true, interactive: true }
  )
  assert.deepEqual(
    projectActionMessageCollapse({
      approvalRequired: false,
      defaultExpanded: false,
      expanded: true,
      hasDetail: true
    }),
    { collapsed: false, defaultCollapsed: true, interactive: true }
  )
  assert.deepEqual(
    projectActionMessageCollapse({
      approvalRequired: true,
      defaultExpanded: false,
      expanded: false,
      hasDetail: true
    }),
    { collapsed: false, defaultCollapsed: false, interactive: false }
  )
})

function displayText(view: {
  display: { detail: ReactNode | null; resultMeta: ReactNode | null; title: ReactNode }
}): string {
  return [view.display.title, view.display.detail, view.display.resultMeta]
    .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    .map(String)
    .join(" · ")
}

function containsElementType(node: ReactNode, type: ElementType): boolean {
  if (!isValidElement(node)) {
    return false
  }

  if (node.type === type) {
    return true
  }

  const children = (node.props as { children?: ReactNode }).children
  return Children.toArray(children).some((child) => containsElementType(child, type))
}

function hasToolContractNotice(node: ReactNode): boolean {
  return containsElementType(node, ToolContractNotice)
}

function createEmptyContextRetrievalResult(
  kind: "history_search" | "message_context",
  identity: { messageId?: string; query?: string; threadId?: string }
): ContextRetrievalToolResult {
  if (kind === "history_search") {
    return {
      items: [],
      kind,
      nextActions: [],
      query: identity.query ?? "",
      status: "empty",
      summary: "No matching history context found."
    }
  }

  return {
    focus: {
      messageId: identity.messageId ?? "",
      runId: null,
      threadId: identity.threadId ?? ""
    },
    items: [],
    kind,
    nextActions: [],
    status: "empty",
    summary: "Message context not found.",
    window: {
      after: 2,
      before: 2
    }
  }
}

function createTraceEvidenceResult(): TraceEvidenceToolResult {
  return {
    artifacts: [
      {
        artifactId: "artifact-1",
        kind: "summary",
        preview: "Artifact preview",
        runId: "run-1",
        status: "ready",
        threadId: "thread-1",
        title: "Artifact 1",
        toolCallId: "tool-call-1"
      }
    ],
    blobs: {
      input: null,
      output: null
    },
    kind: "trace_evidence",
    nextActions: [],
    status: "ok",
    step: {
      durationMs: 12,
      status: "completed",
      stepIndex: 0,
      stepType: "tool",
      toolCallId: "tool-call-1",
      toolName: "read_file",
      traceStepId: "trace-1:0"
    },
    summary: "Loaded trace evidence.",
    trace: {
      model: "gpt-test",
      provider: "test",
      runId: "run-1",
      status: "completed",
      threadId: "thread-1",
      traceId: "trace-1"
    }
  }
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
        threadId: TEST_THREAD_ID,
        status: "approval",
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
    project: () => null,
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
        threadId: TEST_THREAD_ID,
        status: "complete",
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
        threadId: TEST_THREAD_ID,
        status: "complete",
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
    threadId: TEST_THREAD_ID,
    result: [],
    status: "complete",
    toolCall: baseToolCall
  })

  assert.equal(displayText(currentDirectoryView), "List Directory")
  assert.equal(currentDirectoryView.display.detail, null)

  const listedDirectoryView = createActionMessageView({
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    result:
      "/Users/example/project/src (directory)\n/Users/example/project/package.json (42 bytes)",
    status: "complete",
    toolCall: baseToolCall
  })

  assert.equal(displayText(listedDirectoryView), "List Directory")
  assert.equal(listedDirectoryView.display.detail, null)
  assert.equal(listedDirectoryView.hasDetail, true)

  const nestedDirectoryView = createActionMessageView({
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    result: [],
    status: "complete",
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
    threadId: TEST_THREAD_ID,
    result: "hello",
    status: "complete",
    toolCall: baseToolCall
  })

  assert.equal(displayText(currentFileView), "Read File · Read 1 line")
  assert.equal(currentFileView.display.detail, "Read 1 line")

  const streamingFileView = createActionMessageView({
    activeArgsText: '{"file_path":"/Users/example',
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    status: "arguments_streaming",
    toolCall: baseToolCall
  })

  assert.equal(displayText(streamingFileView), "Read File")
  assert.equal(streamingFileView.hasDetail, false)

  const nestedFileView = createActionMessageView({
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    result: "hello",
    status: "complete",
    toolCall: {
      ...baseToolCall,
      args: {
        file_path: "/Users/example/project/src/index.ts"
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
    threadId: TEST_THREAD_ID,
    status: "complete",
    toolCall: {
      args: {
        todos: [
          {
            content: "Inspect runtime facts",
            status: "completed"
          },
          {
            content: "Tighten renderer projection",
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

test("createActionMessageView exposes the file mutation path contract in its summary", async () => {
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
    threadId: TEST_THREAD_ID,
    status: "running",
    toolCall: baseToolCall
  })

  assert.equal(
    displayText(fileWithoutPathView),
    `Write File · ${copy.chat.messageContentUnavailable}`
  )
  assert.equal(hasToolContractNotice(fileWithoutPathView.renderDetail()), true)

  const fileWithPathView = createActionMessageView({
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    status: "running",
    toolCall: {
      ...baseToolCall,
      args: {
        content: "first\nsecond",
        file_path: "/Users/example/project/notes.md"
      }
    }
  })

  assert.equal(displayText(fileWithPathView), "Write File · notes.md")
})

test("createActionMessageView does not treat running file mutation args as completed detail", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  const toolCall: ToolCall = {
    args: {
      content: "first\nsecond",
      file_path: "/Users/example/project/notes.md"
    },
    id: "call_write",
    name: "write_file",
    type: "tool_call"
  }

  const runningView = createActionMessageView({
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    status: "running",
    toolCall
  })
  const runningDetail = runningView.renderDetail()

  assert.equal(runningDetail, null)
  assert.equal(runningView.hasDetail, false)
})

test("file mutation projection validates required non-streaming args without rejecting empty content", () => {
  const invalidCases = [
    {
      args: { file_path: "src/notes.md" },
      expectedField: "content",
      status: "running" as const,
      toolName: "write_file"
    },
    {
      args: { content: 42, file_path: "src/notes.md" },
      expectedField: "content",
      status: "waiting_result" as const,
      toolName: "write_file"
    },
    {
      args: { file_path: "src/app.ts", new_string: "next", old_string: null },
      expectedField: "old_string",
      status: "failed" as const,
      toolName: "edit_file"
    },
    {
      args: { content: "next", file_path: "   " },
      expectedField: "file_path",
      status: "unavailable" as const,
      toolName: "write_file"
    }
  ]

  for (const invalidCase of invalidCases) {
    const projection = projectToolProjectionFacts({
      status: invalidCase.status,
      toolCall: {
        args: invalidCase.args,
        id: `call-${invalidCase.status}`,
        name: invalidCase.toolName,
        type: "tool_call"
      }
    }).fileMutation

    assert.deepEqual(projection, {
      field: invalidCase.expectedField,
      kind: "invalid",
      reason: "invalid_args"
    })
  }

  const emptyWriteContent = projectToolProjectionFacts({
    status: "running",
    toolCall: {
      args: { content: "", file_path: "src/empty.txt" },
      id: "call-empty-write",
      name: "write_file",
      type: "tool_call"
    }
  }).fileMutation
  assert.deepEqual(emptyWriteContent, {
    kind: "pending_args",
    path: "src/empty.txt",
    toolName: "write_file"
  })

  const emptyEditStrings = projectToolProjectionFacts({
    status: "waiting_result",
    toolCall: {
      args: { file_path: "src/empty.txt", new_string: "", old_string: "" },
      id: "call-empty-edit",
      name: "edit_file",
      type: "tool_call"
    }
  }).fileMutation
  assert.deepEqual(emptyEditStrings, {
    kind: "pending_args",
    path: "src/empty.txt",
    toolName: "edit_file"
  })
})

test("completed file mutation rejects invalid args before projecting result metadata", () => {
  const projection = projectToolProjectionFacts({
    fileMutationResult: {
      files: [
        {
          after: "saved",
          before: null,
          changeType: null,
          path: "src/notes.md"
        }
      ],
      status: "completed",
      toolCallId: "call-invalid-complete",
      toolName: "write_file"
    },
    status: "complete",
    toolCall: {
      args: { file_path: "src/notes.md" },
      id: "call-invalid-complete",
      name: "write_file",
      type: "tool_call"
    }
  }).fileMutation

  assert.deepEqual(projection, {
    field: "content",
    kind: "invalid",
    reason: "invalid_args"
  })
})

test("file mutation required-args failures render a typed contract notice", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")
  const view = createActionMessageView({
    copy,
    presentation: "grouped",
    status: "failed",
    threadId: TEST_THREAD_ID,
    toolCall: {
      args: {
        file_path: "src/notes.md"
      },
      id: "call-invalid-write",
      name: "write_file",
      type: "tool_call"
    }
  })

  assert.equal(view.hasDetail, true)
  assert.equal(hasToolContractNotice(view.renderDetail()), true)
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
    activeArgsText: '{"file_path":"src/',
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    status: "arguments_streaming",
    toolCall
  })
  const partialModel = projectToolProjectionFacts({
    activeArgsText: '{"file_path":"src/',
    status: "arguments_streaming",
    toolCall
  })
  const partialDetail = partialView.renderDetail()

  assert.equal(displayText(partialView), "Write File · src/")
  assert.deepEqual(partialModel.fileMutation, {
    kind: "pending_args",
    path: "src/",
    toolName: "write_file"
  })
  assert.equal(partialDetail, null)
  assert.equal(partialView.hasDetail, false)

  const contentView = createActionMessageView({
    activeArgsText: '{"file_path":"src/notes.md","content":"first',
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    status: "arguments_streaming",
    toolCall
  })
  const contentModel = projectToolProjectionFacts({
    activeArgsText: '{"file_path":"src/notes.md","content":"first',
    status: "arguments_streaming",
    toolCall
  })
  const contentDetail = contentView.renderDetail()

  assert.equal(displayText(contentView), "Write File · notes.md")
  assert.equal(contentModel.fileMutation?.kind, "view")
  assert.equal(contentView.hasDetail, true)
  assert.notEqual(contentDetail, null)
  if (contentModel.fileMutation?.kind === "view") {
    assert.equal(contentModel.fileMutation.viewModel.source, "streaming_preview")
    assert.equal(contentModel.fileMutation.viewModel.status, "pending")
    assert.equal(contentModel.fileMutation.viewModel.files[0]?.after, "first")
    assert.equal(contentModel.fileMutation.viewModel.files[0]?.path, "src/notes.md")
  }
})

test("file mutation view model derives streaming previews from partial args", () => {
  const projection = buildStreamingFileMutationViewModel({
    argsText: '{"file_path":"src/notes.md","content":"first',
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
      file_path: "/workspace/src/app.ts",
      new_string: "export const value = 2\n",
      old_string: "export const value = 1\n"
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
    threadId: TEST_THREAD_ID,
    status: "approval",
    toolCall
  })
  const model = projectToolProjectionFacts({
    approvalRequest,
    status: "approval",
    toolCall
  })

  assert.equal(view.hasDetail, true)
  assert.equal(model.status, "approval")
  assert.equal(model.fileMutation?.kind, "view")
  if (model.fileMutation?.kind === "view") {
    assert.equal(model.fileMutation.viewModel.source, "approval_preview")
    assert.equal(model.fileMutation.viewModel.status, "pending")
    assert.equal(model.fileMutation.viewModel.files[0]?.diffMode, "diff")
  }
})

test("completed file mutation view model renders only completed result facts", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")
  const toolCall: ToolCall = {
    args: {
      content: "draft",
      file_path: "src/notes.md"
    },
    id: "call_write",
    name: "write_file",
    type: "tool_call"
  }
  const missingMetadataResult = "wrote src/notes.md"
  const missingMetadataView = createActionMessageView({
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    result: missingMetadataResult,
    status: "complete",
    toolCall
  })
  const missingMetadataModel = projectToolProjectionFacts({
    result: missingMetadataResult,
    status: "complete",
    toolCall
  })

  assert.deepEqual(missingMetadataModel.fileMutation, {
    kind: "invalid",
    reason: "missing_metadata"
  })
  assert.equal(missingMetadataView.hasDetail, true)
  assert.notEqual(missingMetadataView.renderDetail(), null)

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
    threadId: TEST_THREAD_ID,
    result: "Successfully wrote to 'src/notes.md'",
    status: "complete",
    toolCall
  })
  const metadataModel = projectToolProjectionFacts({
    fileMutationResult: completedFileMutationResult,
    result: "Successfully wrote to 'src/notes.md'",
    status: "complete",
    toolCall
  })

  assert.equal(metadataModel.fileMutation?.kind, "view")
  assert.equal(metadataView.hasDetail, true)
  if (metadataModel.fileMutation?.kind === "view") {
    assert.equal(metadataModel.fileMutation.viewModel.source, "completed_result")
    assert.equal(metadataModel.fileMutation.viewModel.status, "completed")
    assert.equal(metadataModel.fileMutation.viewModel.files[0]?.after, "first\nsecond")
    assert.equal(metadataModel.fileMutation.viewModel.files[0]?.changeType, null)
    assert.equal(metadataModel.fileMutation.viewModel.files[0]?.diffMode, "code")
  }
  assert.equal(
    projectFileMutationTool(
      {
        ...metadataModel,
        threadId: TEST_THREAD_ID,
        toolCall
      },
      "write_file"
    ).contentLineCount,
    2
  )

  const emptyFileToolCall: ToolCall = {
    args: {
      content: "stale arg content",
      file_path: "src/empty.txt"
    },
    id: "call_write_empty",
    name: "write_file",
    type: "tool_call"
  }
  const emptyFileModel = projectToolProjectionFacts({
    fileMutationResult: {
      files: [
        {
          after: "",
          before: null,
          changeType: null,
          path: "src/empty.txt"
        }
      ],
      status: "completed",
      toolCallId: "call_write_empty",
      toolName: "write_file"
    },
    status: "complete",
    toolCall: emptyFileToolCall
  })
  assert.equal(
    projectFileMutationTool(
      {
        ...emptyFileModel,
        threadId: TEST_THREAD_ID,
        toolCall: emptyFileToolCall
      },
      "write_file"
    ).contentLineCount,
    0
  )

  const structuredResult = {
    files: [
      {
        changeType: "create",
        content: "first\nsecond",
        path: "src/notes.md"
      }
    ]
  }
  const structuredView = createActionMessageView({
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    result: structuredResult,
    status: "complete",
    toolCall
  })
  const structuredModel = projectToolProjectionFacts({
    result: structuredResult,
    status: "complete",
    toolCall
  })

  assert.deepEqual(structuredModel.fileMutation, {
    kind: "invalid",
    reason: "missing_metadata"
  })
  assert.equal(structuredView.hasDetail, true)
  assert.notEqual(structuredView.renderDetail(), null)
})

test("createActionMessageView keeps read search list command summaries descriptive", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  const commandView = createActionMessageView({
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    status: "complete",
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
    threadId: TEST_THREAD_ID,
    result: ["src/renderer/src/lib/message-projection.ts"],
    status: "complete",
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
    threadId: TEST_THREAD_ID,
    result: [{ line: 12, path: "src/renderer/src/lib/message-projection.ts", text: "runtime" }],
    status: "complete",
    toolCall: {
      args: { pattern: "runtime" },
      id: "call_grep",
      name: "grep",
      type: "tool_call"
    }
  })
  const webSearchResult = JSON.stringify({
    provider: "tavily",
    query: "Jingle agent runtime",
    results: [
      {
        snippet: "Typed renderer projections keep contracts explicit.",
        title: "Jingle Runtime",
        url: "https://example.com/jingle-runtime"
      }
    ],
    totalResults: 1
  })
  const webSearchView = createActionMessageView({
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    result: webSearchResult,
    status: "complete",
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
    threadId: TEST_THREAD_ID,
    result: "Retrieved history content should stay out of the tool activity detail.",
    status: "complete",
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
    threadId: TEST_THREAD_ID,
    result: "Retrieved message content should stay out of the tool activity detail.",
    status: "complete",
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
    threadId: TEST_THREAD_ID,
    result: "Retrieved trace content should stay out of the tool activity detail.",
    status: "complete",
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
  assert.equal(displayText(globView), "Find Files · src/**/*.ts")
  assert.equal(displayText(grepView), "Search Content · runtime")
  assert.equal(displayText(webSearchView), "Search Web · Jingle agent runtime")
  assert.equal(parseWebSearchResponse(webSearchResult)?.results[0]?.title, "Jingle Runtime")
  assert.equal(displayText(searchHistoryView), "Search History · old runtime decision")
  assert.equal(
    displayText(messageContextView),
    "Read Message Context · thread_0123456789abcdef · msg_0123456789abcdef"
  )
  assert.equal(displayText(traceEvidenceView), "Read Trace Evidence · trace_step_0123456789abcdef")
  assert.equal(webSearchView.hasDetail, true)
  assert.equal(searchHistoryView.hasDetail, true)
  assert.equal(messageContextView.hasDetail, true)
  assert.notEqual(searchHistoryView.renderDetail(), null)
  assert.notEqual(messageContextView.renderDetail(), null)
  assert.equal(traceEvidenceView.hasDetail, true)
  assert.notEqual(traceEvidenceView.renderDetail(), null)
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
    threadId: TEST_THREAD_ID,
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
    status: "complete",
    toolCall
  })

  const detail = view.renderDetail()

  assert.equal(view.hasDetail, true)
  assert.notEqual(detail, null)
  assert.equal(hasToolContractNotice(detail), false)
  assert.equal(
    parseContextRetrievalToolResult(
      JSON.stringify({
        items: [{}],
        kind: "history_search",
        nextActions: [],
        query: "history",
        status: "ok",
        summary: "Malformed nested item"
      })
    ),
    null
  )
})

test("context retrieval projection rejects cross-kind and request identity mismatches", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")
  const createContextView = (input: {
    args: Record<string, unknown>
    id: string
    name: "get_message_context" | "get_trace_evidence" | "search_history"
    result: ContextRetrievalToolResult
  }) =>
    createActionMessageView({
      copy,
      presentation: "grouped",
      result: serializeContextRetrievalToolResult(input.result),
      status: "complete",
      threadId: TEST_THREAD_ID,
      toolCall: {
        args: input.args,
        id: input.id,
        name: input.name,
        type: "tool_call"
      }
    })

  const crossKindView = createContextView({
    args: { query: "history" },
    id: "call-cross-kind",
    name: "search_history",
    result: createEmptyContextRetrievalResult("message_context", {
      messageId: "message-1",
      threadId: "thread-1"
    })
  })
  assert.equal(hasToolContractNotice(crossKindView.renderDetail()), true)

  const queryMismatchView = createContextView({
    args: { query: "requested query" },
    id: "call-query-mismatch",
    name: "search_history",
    result: createEmptyContextRetrievalResult("history_search", {
      query: "different query"
    })
  })
  assert.equal(hasToolContractNotice(queryMismatchView.renderDetail()), true)

  const focusMismatchView = createContextView({
    args: { messageId: "message-1", threadId: "thread-1" },
    id: "call-focus-mismatch",
    name: "get_message_context",
    result: createEmptyContextRetrievalResult("message_context", {
      messageId: "different-message",
      threadId: "thread-1"
    })
  })
  assert.equal(hasToolContractNotice(focusMismatchView.renderDetail()), true)

  const traceResult = createTraceEvidenceResult()
  const traceSelectorMismatches: Array<Record<string, unknown>> = [
    { artifactId: "different-artifact" },
    { runId: "different-run" },
    { toolCallId: "different-tool-call" },
    { traceId: "different-trace" },
    { traceStepId: "different-trace:0" }
  ]
  for (const [index, args] of traceSelectorMismatches.entries()) {
    const mismatchView = createContextView({
      args,
      id: `call-trace-mismatch-${index}`,
      name: "get_trace_evidence",
      result: traceResult
    })
    assert.equal(hasToolContractNotice(mismatchView.renderDetail()), true)
  }

  const artifactCannotProveTraceRunView = createContextView({
    args: { runId: "run-1" },
    id: "call-trace-run-owned-by-artifact",
    name: "get_trace_evidence",
    result: {
      ...traceResult,
      trace: {
        ...traceResult.trace,
        runId: "different-run"
      }
    }
  })
  assert.equal(hasToolContractNotice(artifactCannotProveTraceRunView.renderDetail()), true)

  const artifactCannotProveTraceStepView = createContextView({
    args: { toolCallId: "tool-call-1" },
    id: "call-trace-step-owned-by-artifact",
    name: "get_trace_evidence",
    result: {
      ...traceResult,
      step: traceResult.step
        ? {
            ...traceResult.step,
            toolCallId: "different-tool-call"
          }
        : null
    }
  })
  assert.equal(hasToolContractNotice(artifactCannotProveTraceStepView.renderDetail()), true)

  const matchingTraceView = createContextView({
    args: {
      artifactId: "artifact-1",
      runId: "run-1",
      toolCallId: "tool-call-1",
      traceId: "trace-1",
      traceStepId: "trace-1:0"
    },
    id: "call-trace-match",
    name: "get_trace_evidence",
    result: traceResult
  })
  assert.equal(hasToolContractNotice(matchingTraceView.renderDetail()), false)
})

test("context retrieval projection relaxes selector identity only for canonical empty unavailable facts", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")
  const unavailableResult: TraceEvidenceToolResult = {
    artifacts: [],
    blobs: {
      input: null,
      output: null
    },
    diagnostics: ["Trace projection is unavailable for the requested selector."],
    kind: "trace_evidence",
    nextActions: [],
    status: "unavailable",
    step: null,
    summary: "Trace evidence not found.",
    trace: {
      model: null,
      provider: null,
      runId: null,
      status: null,
      threadId: null,
      traceId: null
    }
  }
  const view = createActionMessageView({
    copy,
    presentation: "grouped",
    result: serializeContextRetrievalToolResult(unavailableResult),
    status: "complete",
    threadId: TEST_THREAD_ID,
    toolCall: {
      args: { traceId: "missing-trace" },
      id: "call-unavailable-trace",
      name: "get_trace_evidence",
      type: "tool_call"
    }
  })

  assert.equal(view.hasDetail, true)
  assert.equal(hasToolContractNotice(view.renderDetail()), false)

  const nonEmptyUnavailableView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: serializeContextRetrievalToolResult({
      ...createTraceEvidenceResult(),
      status: "unavailable"
    }),
    status: "complete",
    threadId: TEST_THREAD_ID,
    toolCall: {
      args: { traceId: "trace-1" },
      id: "call-non-empty-unavailable-trace",
      name: "get_trace_evidence",
      type: "tool_call"
    }
  })
  assert.equal(hasToolContractNotice(nonEmptyUnavailableView.renderDetail()), false)

  const mismatchedTraceUnavailableView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: serializeContextRetrievalToolResult({
      ...createTraceEvidenceResult(),
      status: "unavailable"
    }),
    status: "complete",
    threadId: TEST_THREAD_ID,
    toolCall: {
      args: { traceId: "different-trace" },
      id: "call-mismatched-unavailable-trace",
      name: "get_trace_evidence",
      type: "tool_call"
    }
  })
  assert.equal(hasToolContractNotice(mismatchedTraceUnavailableView.renderDetail()), true)

  const mismatchedArtifactUnavailableView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: serializeContextRetrievalToolResult({
      ...unavailableResult,
      artifacts: createTraceEvidenceResult().artifacts
    }),
    status: "complete",
    threadId: TEST_THREAD_ID,
    toolCall: {
      args: { artifactId: "different-artifact" },
      id: "call-mismatched-unavailable-artifact",
      name: "get_trace_evidence",
      type: "tool_call"
    }
  })
  assert.equal(hasToolContractNotice(mismatchedArtifactUnavailableView.renderDetail()), true)

  const matchingArtifactUnavailableView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: serializeContextRetrievalToolResult({
      ...unavailableResult,
      artifacts: createTraceEvidenceResult().artifacts
    }),
    status: "complete",
    threadId: TEST_THREAD_ID,
    toolCall: {
      args: { artifactId: "artifact-1" },
      id: "call-matching-unavailable-artifact",
      name: "get_trace_evidence",
      type: "tool_call"
    }
  })
  assert.equal(hasToolContractNotice(matchingArtifactUnavailableView.renderDetail()), false)

  const blobOnlyUnavailableView = createActionMessageView({
    copy,
    presentation: "grouped",
    result: serializeContextRetrievalToolResult({
      ...unavailableResult,
      blobs: {
        input: {
          kind: "input",
          preview: null,
          sizeBytes: 0,
          text: ""
        },
        output: null
      }
    }),
    status: "complete",
    threadId: TEST_THREAD_ID,
    toolCall: {
      args: { traceId: "missing-trace" },
      id: "call-blob-only-unavailable-trace",
      name: "get_trace_evidence",
      type: "tool_call"
    }
  })
  assert.equal(hasToolContractNotice(blobOnlyUnavailableView.renderDetail()), true)
})

test("web search producer and renderer share the canonical query owner", async () => {
  setRendererWindowStub()

  const testHome = mkdtempSync(join(tmpdir(), "jingle-web-search-"))
  const previousJingleHome = process.env.JINGLE_HOME
  const previousTavilyApiKey = process.env.TAVILY_API_KEY
  process.env.JINGLE_HOME = testHome
  delete process.env.TAVILY_API_KEY

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")
  const createWebSearchView = (requestQuery: string, resultQuery: string) =>
    createActionMessageView({
      copy,
      presentation: "grouped",
      result: JSON.stringify({
        provider: "tavily",
        query: resultQuery,
        results: [],
        totalResults: 0
      }),
      status: "complete",
      threadId: TEST_THREAD_ID,
      toolCall: {
        args: { query: requestQuery },
        id: `call-web-search-${resultQuery}`,
        name: "web_search",
        type: "tool_call"
      }
    })

  try {
    const requestQuery = `  ${"Jingle   ".repeat(80)}agent runtime  `
    const response = await searchWeb(requestQuery)
    const canonicalQuery = normalizeWebSearchQuery(requestQuery)

    assert.deepEqual(response, {
      provider: "tavily",
      query: canonicalQuery,
      results: [],
      totalResults: 0
    })
    assert.equal(canonicalQuery.length, 400)

    const canonicalView = createWebSearchView(requestQuery, response.query)
    assert.equal(hasToolContractNotice(canonicalView.renderDetail()), false)

    const mismatchedView = createWebSearchView(requestQuery, `${response.query}!`)
    assert.equal(hasToolContractNotice(mismatchedView.renderDetail()), true)

    assert.deepEqual(await searchWeb(" \n\t "), {
      provider: "tavily",
      query: "",
      results: [],
      totalResults: 0
    })
  } finally {
    if (previousJingleHome === undefined) {
      delete process.env.JINGLE_HOME
    } else {
      process.env.JINGLE_HOME = previousJingleHome
    }
    if (previousTavilyApiKey === undefined) {
      delete process.env.TAVILY_API_KEY
    } else {
      process.env.TAVILY_API_KEY = previousTavilyApiKey
    }
    rmSync(testHome, { force: true, recursive: true })
  }
})

test("createActionMessageView renders explicit extension display and presentation", async () => {
  setRendererWindowStub()

  const { createActionMessageView } =
    await import("../../src/renderer/src/components/chat/action-message-view")

  const view = createActionMessageView({
    copy,
    presentation: "grouped",
    threadId: TEST_THREAD_ID,
    status: "complete",
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
        args: { file_path: "/repo/src/index.ts", new_string: "new", old_string: "old" },
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
          args: { file_path: "/repo/src/index.ts", new_string: "new", old_string: "old" },
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
