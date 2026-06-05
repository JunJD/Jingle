import assert from "node:assert/strict"
import test from "node:test"
import type { AppCopy } from "../../src/renderer/src/lib/i18n/messages"
import { buildLargeApprovalViewModel } from "../../src/renderer/src/components/chat/tools/approval-large-presentation"
import type {
  ExecuteToolApprovalItem,
  FileMutationToolApprovalItem,
  ExtensionToolApprovalItem
} from "../../src/shared/tool-approval"

const copy = {
  common: {
    rawArguments: "Raw Arguments"
  },
  toolCall: {
    approvalAction: "Action",
    approvalImpact: "Expected impact",
    approvalParameters: "Parameters",
    approvalPrediction: "Prediction",
    approvalProfile: "Profile",
    approvalReason: "Reason",
    approvalSource: "Source",
    approvalTarget: "Target",
    changeCreate: "Create",
    changeDelete: "Delete",
    changeModify: "Modify",
    fileReviewContent: "Content",
    fileReviewDetails: "Content details",
    fileReviewOriginal: "Current Content",
    fileReviewPath: "Path",
    fileReviewUpdated: "Updated Content",
    labels: {
      edit_file: "Edit File",
      execute: "Execute Command",
      write_file: "Write File"
    },
    upcomingChanges: "Upcoming changes"
  }
} as unknown as AppCopy

test("large execute approval adapts command, impact, and prediction metadata", () => {
  const review: ExecuteToolApprovalItem = {
    changes: [
      { changeType: "create", path: "/workspace/new.txt" },
      { changeType: "delete", path: "/workspace/old.txt" }
    ],
    command: "echo hello > new.txt && rm old.txt",
    kind: "execute_command",
    predictionStatus: "predicted",
    profile: "predictable_mutation",
    reason: "Command writes and deletes local files.",
    toolName: "execute"
  }

  const viewModel = buildLargeApprovalViewModel(copy, review, "{}")

  assert.deepEqual(viewModel.action, {
    detail: "echo hello > new.txt && rm old.txt",
    presentation: "command",
    title: "Execute Command"
  })
  assert.deepEqual(viewModel.target, [
    { label: "Path", presentation: "path", value: "/workspace/new.txt" },
    { label: "Path", presentation: "path", value: "/workspace/old.txt" }
  ])
  assert.deepEqual(viewModel.impact, [
    { detail: "/workspace/new.txt", label: "Create", tone: "success" },
    { detail: "/workspace/old.txt", label: "Delete", tone: "destructive" },
    { detail: "Command writes and deletes local files.", label: "Reason", tone: "neutral" }
  ])
  assert.deepEqual(viewModel.parameters, [
    { label: "Profile", presentation: "mono", value: "predictable_mutation" },
    { label: "Prediction", presentation: "mono", value: "predicted" }
  ])
})

test("large execute approval explains unknown commands before approval", () => {
  const review: ExecuteToolApprovalItem = {
    changes: [],
    command: "npm run build",
    kind: "execute_command",
    predictionStatus: null,
    profile: "unknown_command",
    reason: "Unknown command 'npm' requires user approval before it can run.",
    toolName: "execute"
  }

  const viewModel = buildLargeApprovalViewModel(copy, review, "{}")

  assert.deepEqual(viewModel.impact, [
    {
      detail: "Unknown command 'npm' requires user approval before it can run.",
      label: "Reason",
      tone: "warning"
    }
  ])
  assert.deepEqual(viewModel.parameters, [
    { label: "Profile", presentation: "mono", value: "unknown_command" }
  ])
})

test("large file mutation approval preserves target path, change type, and content facts", () => {
  const review: FileMutationToolApprovalItem = {
    changes: [{ changeType: "modify", path: "/workspace/src/app.ts" }],
    content: null,
    kind: "file_mutation",
    newText: "export const value = 2\n",
    oldText: "export const value = 1\n",
    path: "/workspace/src/app.ts",
    toolName: "edit_file"
  }

  const viewModel = buildLargeApprovalViewModel(copy, review, "{}")

  assert.deepEqual(viewModel.action, {
    detail: null,
    presentation: "text",
    title: "Edit File"
  })
  assert.deepEqual(viewModel.target, [
    { label: "Path", presentation: "path", value: "/workspace/src/app.ts" }
  ])
  assert.deepEqual(viewModel.impact, [
    { detail: "/workspace/src/app.ts", label: "Modify", tone: "warning" }
  ])
  assert.deepEqual(viewModel.parameters, [
    {
      label: "Current Content",
      presentation: "preview",
      value: "export const value = 1\n"
    },
    {
      label: "Updated Content",
      presentation: "preview",
      value: "export const value = 2\n"
    }
  ])
})

test("large extension approval adapts business parameters without file assumptions", () => {
  const review: ExtensionToolApprovalItem = {
    access: "write",
    args: {
      body: "Ship the approval adapter",
      labels: ["frontend", "agent"],
      title: "Create issue"
    },
    capabilityDisplayName: "Openwork GitHub",
    capabilityId: "github",
    confirmation: {
      facts: [
        {
          label: "title",
          value: "Create issue"
        },
        {
          label: "Repository",
          mono: true,
          value: "JunJD/Jingle"
        }
      ],
      message: "Create this issue?",
      title: "Confirm GitHub Issue",
      tone: "warning"
    },
    extensionName: "github",
    kind: "extension_tool",
    permissionMode: "ask-to-edit",
    reason: "Ask to Edit mode requires approval for write and external extension tools.",
    toolName: "ext__github__default__createIssue",
    toolTitle: "Create Issue"
  }

  const viewModel = buildLargeApprovalViewModel(copy, review, "{}")

  assert.deepEqual(viewModel.action, {
    detail: "ext__github__default__createIssue",
    presentation: "text",
    title: "Confirm GitHub Issue"
  })
  assert.deepEqual(viewModel.target, [{ label: "Source", value: "Openwork GitHub" }])
  assert.deepEqual(viewModel.impact, [
    {
      detail: "Create this issue?",
      label: "Reason",
      tone: "warning"
    },
    {
      detail: "Ask to Edit mode requires approval for write and external extension tools.",
      label: "Reason",
      tone: "warning"
    }
  ])
  assert.deepEqual(viewModel.parameters, [
    { label: "title", presentation: "text", value: "Create issue" },
    { label: "Repository", presentation: "mono", value: "JunJD/Jingle" },
    { label: "body", presentation: "text", value: "Ship the approval adapter" },
    {
      label: "labels",
      presentation: "mono",
      value: '[\n  "frontend",\n  "agent"\n]'
    }
  ])
})
