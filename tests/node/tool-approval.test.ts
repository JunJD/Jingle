import assert from "node:assert/strict"
import test from "node:test"
import { withExecuteCommandPolicy } from "../../src/shared/execute-command-policy"
import { withMutationPrediction } from "../../src/shared/mutation-prediction"
import {
  buildToolApprovalItem,
  parseComputerUseToolApprovalInput,
  parseToolApprovalItem,
  requiresToolApproval
} from "../../src/shared/tool-approval"

test("buildToolApprovalItem maps execute predictions to upcoming file changes", () => {
  const args = withMutationPrediction(
    withExecuteCommandPolicy(
      { command: "echo hello > file.txt && rm old.txt" },
      {
        command: "echo hello > file.txt && rm old.txt",
        profile: "predictable_mutation",
        disposition: "require_approval",
        summary: "Command may modify workspace files and requires approval (echo, rm).",
        reason: "Command writes and deletes local files.",
        commands: ["echo", "rm"]
      }
    ),
    {
      command: "echo hello > file.txt && rm old.txt",
      status: "predicted",
      confidence: "medium",
      summary: "Predicted 2 file changes.",
      changes: [
        { changeType: "create", path: "/workspace/file.txt" },
        { changeType: "delete", path: "/workspace/old.txt" }
      ],
      durationMs: 8,
      exitCode: 0,
      stderr: null
    }
  )

  const approvalItem = buildToolApprovalItem("execute", args)

  assert.deepEqual(approvalItem, {
    kind: "execute_command",
    toolName: "execute",
    command: "echo hello > file.txt && rm old.txt",
    changes: [
      { changeType: "create", path: "/workspace/file.txt" },
      { changeType: "delete", path: "/workspace/old.txt" }
    ],
    profile: "predictable_mutation",
    predictionStatus: "predicted",
    reason: "Command writes and deletes local files."
  })
})

test("buildToolApprovalItem represents managed process approvals without file changes", () => {
  const args = withExecuteCommandPolicy(
    { command: "python3 -m http.server" },
    {
      command: "python3 -m http.server",
      profile: "managed_process",
      disposition: "require_approval",
      summary: "Managed process command requires approval (python3).",
      reason: "python3 -m http.server starts a managed process and requires approval.",
      commands: ["python3"]
    }
  )

  const approvalItem = buildToolApprovalItem("execute", args)

  assert.deepEqual(approvalItem, {
    kind: "execute_command",
    toolName: "execute",
    command: "python3 -m http.server",
    changes: [],
    profile: "managed_process",
    predictionStatus: null,
    reason: "python3 -m http.server starts a managed process and requires approval."
  })
})

test("buildToolApprovalItem marks new write_file targets as upcoming creations", () => {
  const approvalItem = buildToolApprovalItem(
    "write_file",
    {
      file_path: "/workspace/src/app.ts",
      content: ""
    },
    {
      fileMutationChangeType: "create"
    }
  )

  assert.deepEqual(approvalItem, {
    kind: "file_mutation",
    toolName: "write_file",
    path: "/workspace/src/app.ts",
    content: "",
    oldText: null,
    newText: null,
    changes: [
      {
        changeType: "create",
        path: "/workspace/src/app.ts"
      }
    ]
  })
})

test("buildToolApprovalItem marks existing write_file targets as upcoming modifications", () => {
  const approvalItem = buildToolApprovalItem(
    "write_file",
    {
      file_path: "/workspace/src/app.ts",
      content: "export {}"
    },
    {
      fileMutationChangeType: "modify"
    }
  )

  assert.deepEqual(approvalItem, {
    kind: "file_mutation",
    toolName: "write_file",
    path: "/workspace/src/app.ts",
    content: "export {}",
    oldText: null,
    newText: null,
    changes: [
      {
        changeType: "modify",
        path: "/workspace/src/app.ts"
      }
    ]
  })
})

test("Computer Use approval input parser preserves canonical semantic actions", () => {
  assert.deepEqual(
    parseComputerUseToolApprovalInput({
      actions: [
        { kind: "press", ref: "@save" },
        { keys: ["META", "S"], kind: "keypress", ref: "@editor" }
      ],
      sessionId: "session-1",
      stateId: "state-1"
    }),
    {
      actions: [
        { kind: "press", ref: "@save" },
        { keys: ["META", "S"], kind: "keypress", ref: "@editor" }
      ],
      sessionId: "session-1",
      stateId: "state-1"
    }
  )
  assert.equal(
    parseComputerUseToolApprovalInput({
      actions: [{ kind: "press", ref: "@save" }],
      extra: true,
      sessionId: "session-1",
      stateId: "state-1"
    }),
    null
  )
})

test("Computer Use persisted approval requires the exact canonical target", () => {
  const review = {
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
        {
          description: "Document body",
          ref: "@editor",
          role: "text_area",
          title: "Editor"
        }
      ],
      window: { nativeId: "window-1", platform: "macos" }
    },
    toolName: "computer_use_action"
  }

  assert.deepEqual(parseToolApprovalItem(review), review)
  assert.equal(parseToolApprovalItem({ ...review, target: undefined }), null)
  assert.equal(
    parseToolApprovalItem({
      ...review,
      target: { ...review.target, extra: true }
    }),
    null
  )
  assert.equal(
    parseToolApprovalItem({
      ...review,
      target: {
        ...review.target,
        elements: review.target.elements.slice().reverse()
      }
    }),
    null
  )
  assert.equal(buildToolApprovalItem("computer_use_action", review), null)
})

test("requiresToolApproval delegates only Computer Use actions to HITL policy", () => {
  assert.equal(requiresToolApproval("computer_use_observe"), false)
  assert.equal(requiresToolApproval("computer_use_action"), true)
  assert.equal(requiresToolApproval("computer_use_search"), false)
  assert.equal(requiresToolApproval("computer_use_expand"), false)
  assert.equal(requiresToolApproval("computer_use_inspect"), false)
  assert.equal(requiresToolApproval("web_search"), false)
})
