import assert from "node:assert/strict"
import test from "node:test"
import type { AppCopy } from "../../src/renderer/src/lib/i18n/messages"
import type { HITLRequest, ToolCall } from "../../src/renderer/src/types"

const copy = {
  common: {
    approval: "Approval"
  },
  toolCall: {
    labels: {}
  }
} as AppCopy

test("createActionMessageView falls back for extension approval tool calls without UI presentation", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      api: {
        models: {},
        threads: {}
      }
    }
  })

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

  const view = createActionMessageView({
    approvalRequest,
    copy,
    presentation: "grouped",
    toolCall
  })

  assert.equal(view.summary, "ext__appleReminders__createReminder")
  assert.equal(view.status, "approval")
  assert.ok(view.hitlDefinition)
})
