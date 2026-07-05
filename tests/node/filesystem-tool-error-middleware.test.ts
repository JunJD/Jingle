import assert from "node:assert/strict"
import test from "node:test"
import { ToolMessage } from "@langchain/core/messages"
import { GraphInterrupt } from "@langchain/langgraph"
import { createFilesystemToolErrorMiddleware } from "@jingle/langchain-agent-harness/transitional"
import {
  createJingleFilesystemMiddleware,
  type JingleFilesystemBackend
} from "../../packages/langchain-agent-harness/src/harness-runtime/filesystem"

interface InvokableTool {
  invoke(input: unknown, config: unknown): Promise<unknown>
}

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

function createFilesystemBackend(
  overrides: Partial<JingleFilesystemBackend>
): JingleFilesystemBackend {
  return {
    edit: () => ({ occurrences: 0, path: "/tmp/file.txt" }),
    globInfo: () => [],
    grepRaw: () => [],
    lsInfo: () => [],
    read: () => "",
    write: () => ({ path: "/tmp/file.txt" }),
    ...overrides
  }
}

function getInvokableTool(
  middleware: ReturnType<typeof createJingleFilesystemMiddleware>,
  name: string
): InvokableTool {
  const candidate = middleware.tools?.find((tool) => tool.name === name)
  assert.ok(candidate)
  return candidate as InvokableTool
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

test("write_file backend errors are surfaced as error tool messages", async () => {
  const middleware = createJingleFilesystemMiddleware({
    backend: createFilesystemBackend({
      write: () => ({ error: "Cannot write existing file." })
    })
  })
  const writeTool = getInvokableTool(middleware, "write_file")

  const result = await writeTool.invoke(
    {
      content: "new",
      file_path: "/tmp/existing.txt"
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-write",
        name: "write_file",
        type: "tool_call"
      }
    }
  )

  assert.equal(ToolMessage.isInstance(result), true)
  const message = result as ToolMessage
  assert.equal(message.name, "write_file")
  assert.equal(message.status, "error")
  assert.equal(message.tool_call_id, "tool-call-write")
  assert.equal(message.content, "Cannot write existing file.")
})

test("edit_file backend errors are surfaced as error tool messages", async () => {
  const middleware = createJingleFilesystemMiddleware({
    backend: createFilesystemBackend({
      edit: () => ({ error: "Could not find exact string." })
    })
  })
  const editTool = getInvokableTool(middleware, "edit_file")

  const result = await editTool.invoke(
    {
      file_path: "/tmp/file.txt",
      new_string: "new",
      old_string: "old",
      replace_all: false
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-edit",
        name: "edit_file",
        type: "tool_call"
      }
    }
  )

  assert.equal(ToolMessage.isInstance(result), true)
  const message = result as ToolMessage
  assert.equal(message.name, "edit_file")
  assert.equal(message.status, "error")
  assert.equal(message.tool_call_id, "tool-call-edit")
  assert.equal(message.content, "Could not find exact string.")
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
