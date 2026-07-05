import { After, Given, Then, When } from "@cucumber/cucumber"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { extractJingleHitlRequestFromValuesState } from "@jingle/langchain-agent-harness/transitional"
import { resolveFileMutationChangeType } from "../../../src/main/agent/tool-permission-runtime"
import type { HITLRequest } from "../../../src/shared/hitl"
import {
  buildToolApprovalItem,
  parseToolApprovalItem,
  type FileMutationToolApprovalItem
} from "../../../src/shared/tool-approval"
import { JingleWorld } from "../support/world"

interface ToolApprovalScenarioState {
  approvalItem: FileMutationToolApprovalItem | null
  pendingRequest: HITLRequest | null
  workspaceDir: string | null
}

interface ToolApprovalWorld extends JingleWorld {
  toolApprovalState?: ToolApprovalScenarioState
}

function getState(world: ToolApprovalWorld): ToolApprovalScenarioState {
  if (!world.toolApprovalState) {
    world.toolApprovalState = {
      approvalItem: null,
      pendingRequest: null,
      workspaceDir: null
    }
  }

  return world.toolApprovalState
}

function createWorkspace(world: ToolApprovalWorld): string {
  const state = getState(world)
  if (state.workspaceDir) {
    rmSync(state.workspaceDir, { force: true, recursive: true })
  }

  const workspaceDir = mkdtempSync(join(tmpdir(), "jingle-bdd-tool-approval-"))
  state.workspaceDir = workspaceDir
  state.approvalItem = null
  state.pendingRequest = null
  return workspaceDir
}

function extractHitlRequestFromValuesState(threadId: string, runId: string, data: unknown) {
  return extractJingleHitlRequestFromValuesState(threadId, runId, data, {
    parseReview: parseToolApprovalItem
  })
}

function getWorkspaceFilePath(world: ToolApprovalWorld, relativePath: string): string {
  const workspaceDir = getState(world).workspaceDir
  assert.ok(workspaceDir, "Expected a tool approval workspace to be prepared.")
  return join(workspaceDir, relativePath)
}

function getFileApprovalItem(world: ToolApprovalWorld): FileMutationToolApprovalItem {
  const approvalItem = getState(world).approvalItem
  assert.ok(approvalItem, "Expected a file approval item to be generated.")
  return approvalItem
}

function getPendingRequest(world: ToolApprovalWorld): HITLRequest {
  const pendingRequest = getState(world).pendingRequest
  assert.ok(pendingRequest, "Expected a pending approval request to be generated.")
  return pendingRequest
}

After(function (this: ToolApprovalWorld) {
  const workspaceDir = this.toolApprovalState?.workspaceDir
  if (workspaceDir) {
    rmSync(workspaceDir, { force: true, recursive: true })
  }

  this.toolApprovalState = undefined
})

Given("一个文件审批工作区是空的", function (this: ToolApprovalWorld) {
  createWorkspace(this)
})

Given(
  "一个文件审批工作区中已有文件 {string} 内容为 {string}",
  function (this: ToolApprovalWorld, relativePath: string, content: string) {
    createWorkspace(this)
    writeFileSync(getWorkspaceFilePath(this, relativePath), content)
  }
)

When(
  "系统为文件 {string} 生成内容为 {string} 的 write_file 审批事项",
  async function (this: ToolApprovalWorld, relativePath: string, content: string) {
    const filePath = getWorkspaceFilePath(this, relativePath)
    const changeType = await resolveFileMutationChangeType("write_file", {
      content,
      path: filePath
    })

    const approvalItem = buildToolApprovalItem(
      "write_file",
      {
        content,
        path: filePath
      },
      {
        fileMutationChangeType: changeType ?? undefined
      }
    )

    assert.ok(approvalItem?.kind === "file_mutation", "Expected a file mutation approval item.")
    getState(this).approvalItem = approvalItem
  }
)

Given(
  "一个运行时中断里包含 write_file 的真实参数和独立审批事项",
  function (this: ToolApprovalWorld) {
    getState(this).pendingRequest = extractHitlRequestFromValuesState("thread-1", "run-1", {
      messages: [
        {
          kwargs: {
            tool_calls: [
              {
                id: "tool-call-1",
                name: "write_file",
                args: {
                  content: "hello",
                  path: "/tmp/demo.txt"
                }
              }
            ]
          }
        }
      ],
      __interrupt__: [
        {
          value: {
            actionRequests: [
              {
                id: "tool-call-1",
                toolCallId: "tool-call-1",
                name: "write_file",
                args: {
                  content: "hello",
                  path: "/tmp/demo.txt"
                },
                review: {
                  kind: "file_mutation",
                  toolName: "write_file",
                  path: "/tmp/demo.txt",
                  content: "hello",
                  oldText: null,
                  newText: null,
                  changes: [
                    {
                      path: "/tmp/demo.txt",
                      changeType: "create"
                    }
                  ]
                }
              }
            ],
            reviewConfigs: [
              {
                actionName: "write_file",
                allowedDecisions: ["approve", "reject"]
              }
            ]
          }
        }
      ]
    })
  }
)

When("系统从运行时提取这个待审批请求", function (this: ToolApprovalWorld) {
  assert.ok(getState(this).pendingRequest, "Expected the runtime state to yield a pending request.")
})

Then("审批事项中的目标文件应为 {string}", function (this: ToolApprovalWorld, relativePath: string) {
  const approvalItem = getFileApprovalItem(this)
  assert.equal(approvalItem.path, getWorkspaceFilePath(this, relativePath))
})

Then(
  "审批事项中的变更应标记为 {string}",
  function (this: ToolApprovalWorld, expectedChangeType: string) {
    const approvalItem = getFileApprovalItem(this)
    assert.deepEqual(approvalItem.changes, [
      {
        changeType: expectedChangeType,
        path: approvalItem.path as string
      }
    ])
  }
)

Then("待审批请求中的工具参数应为:", function (this: ToolApprovalWorld, rawArgs: string) {
  const pendingRequest = getPendingRequest(this)
  assert.deepEqual(pendingRequest.tool_call.args, JSON.parse(rawArgs) as Record<string, unknown>)
})

Then(
  "待审批请求中的审批事项应标记 {string} 为 {string}",
  function (this: ToolApprovalWorld, path: string, expectedChangeType: string) {
    const pendingRequest = getPendingRequest(this)
    assert.deepEqual(pendingRequest.review, {
      kind: "file_mutation",
      toolName: "write_file",
      path,
      content: "hello",
      oldText: null,
      newText: null,
      changes: [
        {
          path,
          changeType: expectedChangeType
        }
      ]
    })
  }
)
