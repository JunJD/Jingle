import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage, HumanMessage } from "@langchain/core/messages"
import { createJingleWorkspaceFileContextMiddleware } from "@jingle/langchain-agent-harness/transitional"
import { createWorkspaceFileContextResolver } from "../../src/main/agent/workspace-file-context-resolver"
import type { WorkspaceService } from "../../src/main/workspace/service"

function createWorkspaceService(readFile: WorkspaceService["readFile"]): WorkspaceService {
  return {
    readFile
  } as WorkspaceService
}

function createJingleWorkspaceFileContextMiddlewareForTest(options: {
  threadId: string
  workspaceService: WorkspaceService
}) {
  return createJingleWorkspaceFileContextMiddleware({
    resolveContext: createWorkspaceFileContextResolver(options)
  })
}

test("workspace file context middleware injects referenced workspace file content", async () => {
  const workspaceService = createWorkspaceService(async ({ filePath, threadId }) => {
    assert.equal(filePath, "src/main/agent/service.ts")
    assert.equal(threadId, "thread-1")
    return {
      content: "export const agentService = true\n",
      modified_at: "2026-06-07T00:00:00.000Z",
      path: filePath,
      size: 33,
      success: true
    }
  })
  const middleware = createJingleWorkspaceFileContextMiddlewareForTest({
    threadId: "thread-1",
    workspaceService
  })
  const userMessage = new HumanMessage({
    additional_kwargs: {
      refs: [
        {
          name: "service.ts",
          path: "src/main/agent/service.ts",
          type: "file"
        }
      ]
    },
    content:
      "Review [@src/main/agent/service.ts](jingle-workspace-file://src%2Fmain%2Fagent%2Fservice.ts)"
  })

  let observedContent: unknown = null
  let observedAdditionalKwargs: unknown = null
  await middleware.wrapModelCall!(
    {
      messages: [userMessage]
    } as never,
    async (request) => {
      const observedMessage = request.messages[0] as HumanMessage
      observedContent = observedMessage.content
      observedAdditionalKwargs = observedMessage.additional_kwargs
      return new AIMessage("done")
    }
  )

  assert.equal(typeof observedContent, "string")
  assert.match(observedContent as string, /Referenced workspace files:/)
  assert.match(observedContent as string, /<file path="src\/main\/agent\/service.ts">/)
  assert.match(observedContent as string, /export const agentService = true/)
  assert.deepEqual(observedAdditionalKwargs, userMessage.additional_kwargs)
})

test("workspace file context middleware ignores attachment-only file refs", async () => {
  let readCount = 0
  const workspaceService = createWorkspaceService(async () => {
    readCount += 1
    return {
      content: "should not be read\n",
      modified_at: "2026-06-07T00:00:00.000Z",
      path: "spec.pdf",
      size: 19,
      success: true
    }
  })
  const middleware = createJingleWorkspaceFileContextMiddlewareForTest({
    threadId: "thread-1",
    workspaceService
  })
  const userMessage = new HumanMessage({
    additional_kwargs: {
      refs: [
        {
          name: "spec.pdf",
          path: "spec.pdf",
          type: "file"
        }
      ]
    },
    content: "Attached files:\n- spec.pdf"
  })

  let observedMessage: unknown = null
  await middleware.wrapModelCall!(
    {
      messages: [userMessage]
    } as never,
    async (request) => {
      observedMessage = request.messages[0] as HumanMessage
      return new AIMessage("done")
    }
  )

  assert.equal(readCount, 0)
  assert.equal(observedMessage, userMessage)
})

test("workspace file context middleware only expands refs from the latest human message", async () => {
  let readCount = 0
  const workspaceService = createWorkspaceService(async () => {
    readCount += 1
    return {
      content: "old context should not be used\n",
      modified_at: "2026-06-07T00:00:00.000Z",
      size: 31,
      success: true
    }
  })
  const middleware = createJingleWorkspaceFileContextMiddlewareForTest({
    threadId: "thread-1",
    workspaceService
  })
  const oldUserMessage = new HumanMessage({
    additional_kwargs: {
      refs: [
        {
          name: "service.ts",
          path: "src/main/agent/service.ts",
          type: "file"
        }
      ]
    },
    content:
      "Review [@src/main/agent/service.ts](jingle-workspace-file://src%2Fmain%2Fagent%2Fservice.ts)"
  })
  const latestUserMessage = new HumanMessage("Now answer without file context")

  let observedMessages: unknown[] = []
  await middleware.wrapModelCall!(
    {
      messages: [oldUserMessage, new AIMessage("done"), latestUserMessage]
    } as never,
    async (request) => {
      observedMessages = request.messages
      return new AIMessage("done")
    }
  )

  assert.equal(readCount, 0)
  assert.equal(observedMessages[2], latestUserMessage)
})

test("workspace file context middleware escapes file context attributes", async () => {
  const workspaceService = createWorkspaceService(async ({ filePath }) => {
    assert.equal(filePath, 'src/"quoted".ts')
    return {
      error: 'missing "quoted" file',
      success: false
    }
  })
  const middleware = createJingleWorkspaceFileContextMiddlewareForTest({
    threadId: "thread-1",
    workspaceService
  })
  const userMessage = new HumanMessage({
    additional_kwargs: {
      refs: [
        {
          name: '"quoted".ts',
          path: 'src/"quoted".ts',
          type: "file"
        }
      ]
    },
    content: 'Review [@src/"quoted".ts](jingle-workspace-file://src%2F%22quoted%22.ts)'
  })

  let observedContent: unknown = null
  await middleware.wrapModelCall!(
    {
      messages: [userMessage]
    } as never,
    async (request) => {
      observedContent = (request.messages[0] as HumanMessage).content
      return new AIMessage("done")
    }
  )

  assert.equal(typeof observedContent, "string")
  assert.match(
    observedContent as string,
    /<file path="src\/&quot;quoted&quot;\.ts" error="missing &quot;quoted&quot; file" \/>/
  )
})
