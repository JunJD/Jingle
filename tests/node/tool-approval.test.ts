import assert from "node:assert/strict"
import test from "node:test"
import { withExecuteCommandPolicy } from "../../src/shared/execute-command-policy"
import { withMutationPrediction } from "../../src/shared/mutation-prediction"
import { buildToolApprovalItem, requiresToolApproval } from "../../src/shared/tool-approval"

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

test("requiresToolApproval does not gate desktop automation tools once allowlist policy owns them", () => {
  assert.equal(requiresToolApproval("open_application"), false)
  assert.equal(requiresToolApproval("open_desktop_route"), false)
  assert.equal(requiresToolApproval("find_ax_elements"), false)
  assert.equal(requiresToolApproval("press_ax_element"), false)
  assert.equal(requiresToolApproval("click_screen_point"), false)
  assert.equal(requiresToolApproval("web_search"), false)
})
