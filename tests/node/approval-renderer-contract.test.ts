import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { appCopy } from "../../src/renderer/src/lib/i18n/messages"
import { buildLargeApprovalViewModel } from "../../src/renderer/src/components/chat/tools/approval-large-view-model"
import {
  getCompactToolApprovalPresentation,
  getToolApprovalPresentationMeta
} from "../../src/renderer/src/components/chat/tools/tool-approval-presentation"
import type {
  ComputerUseToolApprovalItem,
  ExtensionToolApprovalItem,
  FileMutationToolApprovalItem
} from "../../src/shared/tool-approval"

const copy = appCopy["en-US"]

const extensionReview: ExtensionToolApprovalItem = {
  access: "write",
  args: { title: "Quarterly review" },
  capabilityDisplayName: "Apple Reminders",
  capabilityId: "appleReminders",
  extensionName: "apple-reminders",
  kind: "extension_tool",
  permissionMode: "ask-to-edit",
  reason: "This action writes external data.",
  toolName: "ext__appleReminders__createReminder",
  toolTitle: "Create Reminder"
}

test("approval presentation consumes typed extension review facts without raw tool-name fallback", () => {
  assert.deepEqual(getToolApprovalPresentationMeta(copy, extensionReview), {
    subtitle: "Apple Reminders",
    title: "Create Reminder"
  })
  assert.equal(
    getCompactToolApprovalPresentation(copy, extensionReview, "tool-call-1").target,
    "Apple Reminders"
  )

  const viewModel = buildLargeApprovalViewModel(copy, extensionReview, "tool-call-1")
  assert.equal(viewModel.action?.title, "Create Reminder")
  assert.equal(viewModel.action?.detail, "apple-reminders")
  assert.deepEqual(viewModel.parameters, [])
  assert.doesNotMatch(JSON.stringify(viewModel), /Quarterly review/)
  assert.doesNotMatch(JSON.stringify(viewModel), /ext__appleReminders__createReminder/)
})

test("Computer Use approval presents canonical application, window, and referenced elements", () => {
  const review: ComputerUseToolApprovalItem = {
    actions: [
      { kind: "press", ref: "@save" },
      { kind: "type_text", ref: "@editor", value: "Hello" }
    ],
    kind: "computer_use_action",
    sessionId: "session-1",
    stateId: "state-1",
    target: {
      application: { id: "com.example.editor", name: "Editor" },
      elements: [
        { ref: "@save", role: "button", title: "Save" },
        { description: "Document body", ref: "@editor", role: "text_area" }
      ],
      window: { nativeId: "window-1", platform: "macos" }
    },
    toolName: "computer_use_action"
  }

  const viewModel = buildLargeApprovalViewModel(copy, review, "tool-call-1")
  assert.deepEqual(viewModel.target, [
    { label: "Application", value: "Editor (com.example.editor)" },
    { label: "Window", presentation: "mono", value: "macos:window-1" },
    {
      label: "Elements",
      presentation: "preview",
      value: "@save [button] Save\n@editor [text_area] - Document body"
    }
  ])
  assert.doesNotMatch(JSON.stringify(viewModel), /raw args/i)
})

test("approval presentation fails closed when a built-in review has no registered label", () => {
  const review: FileMutationToolApprovalItem = {
    changes: [],
    content: null,
    kind: "file_mutation",
    newText: null,
    oldText: null,
    path: "README.md",
    toolName: "write_file"
  }
  const copyWithoutLabel = {
    ...copy,
    toolCall: {
      ...copy.toolCall,
      labels: {}
    }
  }

  assert.throws(
    () => getToolApprovalPresentationMeta(copyWithoutLabel, review),
    /Missing approval presentation label for tool "write_file"/
  )
})

test("composer renders invalid review as non-executable and keeps typed approval decisions", async () => {
  const source = await readFile(
    new URL("../../src/renderer/src/components/chat/ComposerApprovalPrompt.tsx", import.meta.url),
    "utf8"
  )

  assert.match(source, /if \(!approvalItem\) \{[\s\S]*?actions=\{null\}/)
  assert.match(source, /approvalInvalidDescription/)
  assert.doesNotMatch(source, /stringifyToolValue|request\.tool_call\.args/)
  assert.doesNotMatch(source, /request\.tool_call\.name/)
  assert.match(source, /onDecision\(\{ type: "user_declined" \}\)/)
  assert.match(source, /onDecision\(\{ correction: trimmedFeedback, type: "corrected" \}\)/)
  assert.match(source, /onDecision\(\{ type: "approve" \}\)/)
})
