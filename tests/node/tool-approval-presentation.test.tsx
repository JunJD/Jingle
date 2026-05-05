import assert from "node:assert/strict"
import test from "node:test"
import type { AppCopy } from "../../src/renderer/src/lib/i18n/messages"
import { extensionToolComponent } from "../../src/renderer/src/components/chat/tools/ExtensionTool"
import { getToolApprovalPresentationMeta } from "../../src/renderer/src/components/chat/tools/tool-approval-presentation"
import type { ExtensionToolApprovalItem } from "../../src/shared/tool-approval"

const copy = {
  common: {
    approval: "Approval",
    rawArguments: "Raw Arguments",
    rawResult: "Raw Result",
    running: "Running"
  },
  toolCall: {
    approvalItem: "Approval Item",
    labels: {}
  }
} as AppCopy

test("extension approval presentation falls back to extension tool titles", () => {
  const approvalItem: ExtensionToolApprovalItem = {
    access: "write",
    approval: "mode-governed",
    args: {
      title: "Ship it"
    },
    extensionName: "mockExtension",
    kind: "extension_tool",
    permissionMode: "ask-to-edit",
    reason: "Ask to Edit mode requires approval for write and external extension tools.",
    sourceDisplayName: "Mock Profile",
    sourceId: "mockSource",
    sourceProfileId: "profile-1",
    toolName: "ext__mockSource__createItem",
    toolTitle: "Create Item"
  }

  const meta = getToolApprovalPresentationMeta(copy, approvalItem, approvalItem.toolName)

  assert.equal(meta.title, "Create Item")
  assert.equal(meta.subtitle, "Mock Profile")
})

test("extension tool presentation renders from schema display metadata", () => {
  const summary = extensionToolComponent.renderSummary({
    args: {
      title: "Ship it"
    },
    copy,
    hasResult: true,
    isExpanded: false,
    presentation: "standalone",
    rawArgs: '{\n  "title": "Ship it"\n}',
    rawResult: '{\n  "id": "reminder-1"\n}',
    result: {
      id: "reminder-1"
    },
    status: "complete",
    toolCall: {
      args: {
        title: "Ship it"
      },
      display: {
        description: "Create a reminder in Apple Reminders.",
        title: "Create Reminder"
      },
      id: "tool-call-1",
      name: "ext__appleReminders__createReminder",
      presentation: {
        access: "write",
        approval: "mode-governed",
        kind: "extension",
        profileTitle: "Personal",
        sourceTitle: "Apple Reminders"
      },
      type: "tool_call"
    }
  })

  assert.equal(summary, "Create Reminder · Personal")
})
