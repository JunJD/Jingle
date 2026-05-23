import assert from "node:assert/strict"
import test from "node:test"
import { getToolApprovalDisplaySize } from "../../src/shared/hitl"
import type { ToolApprovalItem } from "../../src/shared/tool-approval"

test("classifies simple approvals as small", () => {
  assert.equal(getToolApprovalDisplaySize(null), "small")

  assert.equal(
    getToolApprovalDisplaySize({
      changes: [],
      command: "python3 -m http.server",
      kind: "execute_command",
      predictionStatus: null,
      profile: "managed_process",
      toolName: "execute"
    }),
    "small"
  )
})

test("classifies file-impacting approvals as large", () => {
  assert.equal(
    getToolApprovalDisplaySize({
      changes: [{ changeType: "create", path: "/workspace/file.txt" }],
      command: "echo hello > file.txt",
      kind: "execute_command",
      predictionStatus: "predicted",
      profile: "predictable_mutation",
      toolName: "execute"
    }),
    "large"
  )

  assert.equal(
    getToolApprovalDisplaySize({
      changes: [{ changeType: "modify", path: "/workspace/src/app.ts" }],
      content: "export {}",
      kind: "file_mutation",
      newText: null,
      oldText: null,
      path: "/workspace/src/app.ts",
      toolName: "write_file"
    }),
    "large"
  )
})

test("classifies extension approvals by access and argument density", () => {
  const base = {
    capabilityDisplayName: "Apple Reminders",
    capabilityId: "appleReminders",
    extensionName: "apple-reminders",
    kind: "extension_tool",
    permissionMode: "ask-to-edit",
    reason: "Ask to Edit mode requires approval for write and external extension tools.",
    toolName: "ext__appleReminders__default__listReminders",
    toolTitle: "List Reminders"
  } satisfies Omit<ToolApprovalItem & { kind: "extension_tool" }, "access" | "args">

  assert.equal(
    getToolApprovalDisplaySize({
      ...base,
      access: "read",
      args: { listId: "today" }
    }),
    "small"
  )

  assert.equal(
    getToolApprovalDisplaySize({
      ...base,
      access: "read",
      args: { dueDate: "today", listId: "today", status: "open" }
    }),
    "large"
  )

  assert.equal(
    getToolApprovalDisplaySize({
      ...base,
      access: "write",
      args: { title: "Ship it" }
    }),
    "large"
  )
})
