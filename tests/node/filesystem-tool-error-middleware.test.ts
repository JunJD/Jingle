import assert from "node:assert/strict"
import test from "node:test"
import { ToolMessage } from "@langchain/core/messages"
import { GraphInterrupt } from "@langchain/langgraph"
import { createFilesystemToolErrorMiddleware } from "../../src/main/agent/filesystem-tool-error-middleware"

function createToolCallRequest(toolName: string) {
  return {
    toolCall: {
      args: {},
      id: "tool-call-1",
      name: toolName,
      type: "tool_call"
    }
  }
}

test("filesystem tool errors are returned to the model as error tool messages", async () => {
  const middleware = createFilesystemToolErrorMiddleware()

  const result = (await middleware.wrapToolCall!(
    createToolCallRequest("grep") as never,
    async () => {
      const error = new Error("EPERM: operation not permitted, scandir '/Library/Bluetooth'")
      ;(error as NodeJS.ErrnoException).code = "EPERM"
      throw error
    }
  )) as ToolMessage

  assert.equal(result.name, "grep")
  assert.equal(result.tool_call_id, "tool-call-1")
  assert.equal(result.status, "error")
  assert.match(String(result.content), /EPERM: operation not permitted, scandir '\/Library\/Bluetooth'/)
})

test("filesystem tool error middleware preserves graph interrupts", async () => {
  const middleware = createFilesystemToolErrorMiddleware()
  const interrupt = new GraphInterrupt([])

  await assert.rejects(
    async () =>
      middleware.wrapToolCall!(createToolCallRequest("write_file") as never, async () => {
        throw interrupt
      }),
    (error) => error === interrupt
  )
})

test("filesystem tool error middleware does not handle non-filesystem tools", async () => {
  const middleware = createFilesystemToolErrorMiddleware()

  await assert.rejects(
    async () =>
      middleware.wrapToolCall!(createToolCallRequest("web_search") as never, async () => {
        throw new Error("network unavailable")
      }),
    /network unavailable/
  )
})
