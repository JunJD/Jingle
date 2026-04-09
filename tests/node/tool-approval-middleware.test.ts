import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import { ToolMessage } from "@langchain/core/messages"
import {
  createToolApprovalMiddleware,
  resolveFileMutationChangeType
} from "../../src/main/agent/tool-approval-middleware"
import { withExecuteCommandPolicy } from "../../src/shared/execute-command-policy"

const middleware = createToolApprovalMiddleware()

test("read-only execute commands bypass approval and continue to the handler", async () => {
  let handlerCalls = 0
  const request = {
    toolCall: {
      args: withExecuteCommandPolicy(
        { command: "pwd" },
        {
          command: "pwd",
          profile: "read_only",
          disposition: "allow",
          summary: "Read-only command allowed without approval (pwd).",
          reason: "pwd is an allowlisted read-only command.",
          commands: ["pwd"]
        }
      ),
      id: "tool-call-1",
      name: "execute",
      type: "tool_call"
    }
  }

  const result = (await middleware.wrapToolCall!(request as never, async () => {
    handlerCalls += 1
    return new ToolMessage({
      content: "executed without approval",
      name: "execute",
      tool_call_id: "tool-call-1"
    })
  })) as ToolMessage

  assert.equal(handlerCalls, 1)
  assert.equal(result.content, "executed without approval")
})

test("denied execute commands do not reach the handler", async () => {
  let handlerCalls = 0
  const request = {
    toolCall: {
      args: withExecuteCommandPolicy(
        { command: "npm run dev" },
        {
          command: "npm run dev",
          profile: "host_unsafe",
          disposition: "deny",
          summary: "Command blocked by the controlled shell policy (npm).",
          reason: "npm commands are outside the controlled shell profile.",
          commands: ["npm"]
        }
      ),
      id: "tool-call-2",
      name: "execute",
      type: "tool_call"
    }
  }

  const result = (await middleware.wrapToolCall!(request as never, async () => {
    handlerCalls += 1
    return new ToolMessage({
      content: "should not run",
      name: "execute",
      tool_call_id: "tool-call-2"
    })
  })) as ToolMessage

  assert.equal(handlerCalls, 0)
  assert.equal(result.status, "error")
  assert.match(
    typeof result.content === "string" ? result.content : "",
    /outside the controlled shell profile/i
  )
})

test("file mutation tools require tool_call.id before approval", async () => {
  const request = {
    toolCall: {
      args: {
        content: "hello",
        path: "/tmp/demo.txt"
      },
      name: "write_file",
      type: "tool_call"
    }
  }

  await assert.rejects(
    async () =>
      middleware.wrapToolCall!(request as never, async () => {
        throw new Error("handler should not be reached")
      }),
    /Missing tool_call\.id/i
  )
})

test("resolveFileMutationChangeType marks missing write_file targets as create", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "openwork-tool-approval-"))
  const targetPath = join(tempDir, "new-file.txt")

  const changeType = await resolveFileMutationChangeType("write_file", {
    content: "hello",
    path: targetPath
  })

  assert.equal(changeType, "create")
})

test("resolveFileMutationChangeType marks existing write_file targets as modify", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "openwork-tool-approval-"))
  const targetPath = join(tempDir, "existing-file.txt")
  await writeFile(targetPath, "hello")

  const changeType = await resolveFileMutationChangeType("write_file", {
    content: "updated",
    path: targetPath
  })

  assert.equal(changeType, "modify")
})
