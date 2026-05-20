import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import { ToolMessage } from "@langchain/core/messages"
import { GraphInterrupt } from "@langchain/langgraph"
import { createToolApprovalMiddleware } from "../../src/main/agent/tool-approval-middleware"
import { resolveFileMutationChangeType } from "../../src/main/agent/tool-permission-runtime"
import { createToolPermissionRuntime } from "../../src/main/agent/tool-permission-runtime"
import { createExtensionToolApprovalPolicyProvider } from "../../src/main/extension-tools/permission"
import { ExtensionToolRegistry } from "../../src/main/extension-tools/registry"
import { withExecuteCommandPolicy } from "../../src/shared/execute-command-policy"
import type { ExtensionSourceBinding, PermissionModeName } from "../../src/shared/extension-sources"
import { z } from "../../src/main/agent/tool-input-schema"

const middleware = createToolApprovalMiddleware()

function createApprovalRequiredRuntime() {
  return {
    async evaluate(request: { args: unknown }) {
      return {
        args:
          typeof request.args === "object" && request.args !== null && !Array.isArray(request.args)
            ? (request.args as Record<string, unknown>)
            : {},
        disposition: "require_approval" as const,
        review: null
      }
    }
  }
}

function createToolCallRequest(input: { id: string; name?: string }) {
  return {
    toolCall: {
      args: {
        title: input.id
      },
      id: input.id,
      name: input.name ?? "write_file",
      type: "tool_call"
    }
  }
}

function createExtensionApprovalPolicyProvider(permissionMode: PermissionModeName) {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [
    {
      access: "write",
      description: "Create a mock item.",
      handler: () => ({
        id: "item-1"
      }),
      inputSchema: z.object({
        title: z.string()
      }),
      name: "createItem",
      title: "Create Item"
    }
  ])

  const sourceBinding: ExtensionSourceBinding = {
    profile: {
      authStatus: "connected",
      createdAt: "2026-04-30T00:00:00.000Z",
      defaultPermissionMode: permissionMode,
      displayName: "Mock Profile",
      enabled: true,
      enabledTools: [
        {
          agentToolName: "ext__mockSource__profile_1__createItem",
          display: {
            description: "Create a mock item for Mock Profile.",
            title: "Create Item"
          },
          toolName: "createItem"
        }
      ],
      enabledToolNames: ["createItem"],
      extensionName: "mockExtension",
      id: "profile-1",
      publicConfig: {},
      sourceId: "mockSource",
      updatedAt: "2026-04-30T00:00:00.000Z"
    },
    source: {
      defaultToolNames: [],
      description: "Mock source.",
      extensionName: "mockExtension",
      guide: "Use mock items.",
      id: "mockSource",
      title: "Mock Source",
      writeToolNames: ["createItem"]
    }
  }

  return createExtensionToolApprovalPolicyProvider({
    bindings: registry.createSourceToolBindings([sourceBinding])
  })
}

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

test("auto mode allows predictable mutating execute commands without approval", async () => {
  const permissionRuntime = createToolPermissionRuntime({
    permissionMode: "auto"
  })

  const decision = await permissionRuntime.evaluate({
    args: withExecuteCommandPolicy(
      { command: "node -e \"require('fs').writeFileSync('demo.txt', 'hello')\"" },
      {
        command: "node -e \"require('fs').writeFileSync('demo.txt', 'hello')\"",
        commands: ["node"],
        disposition: "require_approval",
        profile: "predictable_mutation",
        reason: "node inline code execution requires mutation prediction and approval.",
        summary: "Command may modify workspace files and requires approval (node)."
      }
    ),
    toolName: "execute"
  })

  assert.equal(decision.disposition, "allow")
})

test("explore mode denies predictable mutating execute commands", async () => {
  const permissionRuntime = createToolPermissionRuntime({
    permissionMode: "explore"
  })

  const decision = await permissionRuntime.evaluate({
    args: withExecuteCommandPolicy(
      { command: "node -e \"require('fs').writeFileSync('demo.txt', 'hello')\"" },
      {
        command: "node -e \"require('fs').writeFileSync('demo.txt', 'hello')\"",
        commands: ["node"],
        disposition: "require_approval",
        profile: "predictable_mutation",
        reason: "node inline code execution requires mutation prediction and approval.",
        summary: "Command may modify workspace files and requires approval (node)."
      }
    ),
    toolName: "execute"
  })

  assert.equal(decision.disposition, "deny")
})

test("allowlisted desktop automation tools bypass approval and continue to the handler", async () => {
  const middleware = createToolApprovalMiddleware({
    getAgentConfig: () => ({
      desktopAutomationAllowlist: ["com.apple.finder"],
      locale: "zh-CN",
      memorySources: [],
      skillSources: []
    })
  })

  let handlerCalls = 0
  const request = {
    toolCall: {
      args: {
        bundleId: "com.apple.finder"
      },
      id: "tool-call-allowlisted",
      name: "open_application",
      type: "tool_call"
    }
  }

  const result = (await middleware.wrapToolCall!(request as never, async () => {
    handlerCalls += 1
    return new ToolMessage({
      content: "finder opened",
      name: "open_application",
      tool_call_id: "tool-call-allowlisted"
    })
  })) as ToolMessage

  assert.equal(handlerCalls, 1)
  assert.equal(result.content, "finder opened")
})

test("non-allowlisted desktop automation tools return an error without approval", async () => {
  const middleware = createToolApprovalMiddleware({
    getAgentConfig: () => ({
      desktopAutomationAllowlist: ["com.apple.finder"],
      locale: "zh-CN",
      memorySources: [],
      skillSources: []
    })
  })

  let handlerCalls = 0
  const request = {
    toolCall: {
      args: {
        bundleId: "com.netease.163music"
      },
      id: "tool-call-denied",
      name: "open_application",
      type: "tool_call"
    }
  }

  const result = (await middleware.wrapToolCall!(request as never, async () => {
    handlerCalls += 1
    return new ToolMessage({
      content: "should not run",
      name: "open_application",
      tool_call_id: "tool-call-denied"
    })
  })) as ToolMessage

  assert.equal(handlerCalls, 0)
  assert.equal(result.status, "error")
  assert.match(typeof result.content === "string" ? result.content : "", /not allowlisted/i)
})

test("auto-mode extension write tools bypass approval and continue to the handler", async () => {
  const middleware = createToolApprovalMiddleware({
    extensionToolPolicyProvider: createExtensionApprovalPolicyProvider("auto")
  })

  let handlerCalls = 0
  const request = {
    toolCall: {
      args: {
        title: "Ship it"
      },
      id: "tool-call-extension-allow",
      name: "ext__mockSource__profile_1__createItem",
      type: "tool_call"
    }
  }

  const result = (await middleware.wrapToolCall!(request as never, async () => {
    handlerCalls += 1
    return new ToolMessage({
      content: "created",
      name: "ext__mockSource__profile_1__createItem",
      tool_call_id: "tool-call-extension-allow"
    })
  })) as ToolMessage

  assert.equal(handlerCalls, 1)
  assert.equal(result.content, "created")
})

test("ask-to-edit extension write tools require approval", async () => {
  const permissionRuntime = createToolPermissionRuntime({
    extensionToolPolicyProvider: createExtensionApprovalPolicyProvider("ask-to-edit")
  })

  const decision = await permissionRuntime.evaluate({
    args: {
      title: "Ship it"
    },
    toolName: "ext__mockSource__profile_1__createItem"
  })

  assert.equal(decision.disposition, "require_approval")
  assert.equal(decision.review?.kind, "extension_tool")
  if (decision.review?.kind !== "extension_tool") {
    throw new Error("Expected extension tool approval review.")
  }
  assert.equal(decision.review.permissionMode, "ask-to-edit")
})

test("explore-mode extension write tools return an error without reaching the handler", async () => {
  const middleware = createToolApprovalMiddleware({
    extensionToolPolicyProvider: createExtensionApprovalPolicyProvider("explore")
  })

  let handlerCalls = 0
  const request = {
    toolCall: {
      args: {
        title: "Ship it"
      },
      id: "tool-call-extension-deny",
      name: "ext__mockSource__profile_1__createItem",
      type: "tool_call"
    }
  }

  const result = (await middleware.wrapToolCall!(request as never, async () => {
    handlerCalls += 1
    return new ToolMessage({
      content: "should not run",
      name: "ext__mockSource__profile_1__createItem",
      tool_call_id: "tool-call-extension-deny"
    })
  })) as ToolMessage

  assert.equal(handlerCalls, 0)
  assert.equal(result.status, "error")
  assert.match(
    typeof result.content === "string" ? result.content : "",
    /read-only extension tools only/i
  )
})

test("app-targeted desktop route calls require target metadata for allowlist checks", async () => {
  const middleware = createToolApprovalMiddleware({
    getAgentConfig: () => ({
      desktopAutomationAllowlist: ["com.netease.163music"],
      locale: "zh-CN",
      memorySources: [],
      skillSources: []
    })
  })

  let handlerCalls = 0
  const request = {
    toolCall: {
      args: {
        url: "orpheus://songrcmd?autoplay=1"
      },
      id: "tool-call-route-without-target",
      name: "open_desktop_route",
      type: "tool_call"
    }
  }

  const result = (await middleware.wrapToolCall!(request as never, async () => {
    handlerCalls += 1
    return new ToolMessage({
      content: "should not run",
      name: "open_desktop_route",
      tool_call_id: "tool-call-route-without-target"
    })
  })) as ToolMessage

  assert.equal(handlerCalls, 0)
  assert.equal(result.status, "error")
  assert.match(
    typeof result.content === "string" ? result.content : "",
    /requires a target application/i
  )
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

test("only one approval-required tool call is consumed within one tool node step", async () => {
  let releaseFirstApproval!: () => void
  const firstApproval = new Promise<void>((resolve) => {
    releaseFirstApproval = resolve
  })
  const approvalRequests: string[] = []
  const handlerCalls: string[] = []
  const middleware = createToolApprovalMiddleware({
    permissionRuntime: createApprovalRequiredRuntime(),
    requestToolApproval: async (request) => {
      approvalRequests.push(request.toolCallId)
      if (request.toolCallId === "tool-call-1") {
        await firstApproval
      }
      return {
        type: "approve"
      }
    }
  })

  const first = middleware.wrapToolCall!(
    createToolCallRequest({ id: "tool-call-1" }) as never,
    async () => {
      handlerCalls.push("tool-call-1")
      return new ToolMessage({
        content: "first",
        name: "write_file",
        tool_call_id: "tool-call-1"
      })
    }
  )
  const second = middleware.wrapToolCall!(
    createToolCallRequest({ id: "tool-call-2" }) as never,
    async () => {
      handlerCalls.push("tool-call-2")
      return new ToolMessage({
        content: "second",
        name: "write_file",
        tool_call_id: "tool-call-2"
      })
    }
  )

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(approvalRequests, ["tool-call-1"])
  assert.deepEqual(handlerCalls, [])

  releaseFirstApproval()
  const [firstResult, secondResult] = (await Promise.all([first, second])) as ToolMessage[]
  assert.deepEqual(approvalRequests, ["tool-call-1"])
  assert.deepEqual(handlerCalls, ["tool-call-1"])
  assert.equal(firstResult.content, "first")
  assert.equal(secondResult.status, "error")
  assert.match(typeof secondResult.content === "string" ? secondResult.content : "", /skipped/i)

  let thirdHandlerCalled = false
  const thirdResult = (await middleware.wrapToolCall!(
    createToolCallRequest({ id: "tool-call-3" }) as never,
    async () => {
      thirdHandlerCalled = true
      return new ToolMessage({
        content: "third",
        name: "write_file",
        tool_call_id: "tool-call-3"
      })
    }
  )) as ToolMessage
  assert.deepEqual(approvalRequests, ["tool-call-1", "tool-call-3"])
  assert.equal(thirdHandlerCalled, true)
  assert.equal(thirdResult.content, "third")
})

test("graph interrupt keeps later concurrent approval requests from surfacing", async () => {
  const approvalRequests: string[] = []
  const middleware = createToolApprovalMiddleware({
    permissionRuntime: createApprovalRequiredRuntime(),
    requestToolApproval: async (request) => {
      approvalRequests.push(request.toolCallId)
      throw new GraphInterrupt([
        {
          value: {
            kind: "tool-approval",
            toolCallId: request.toolCallId
          }
        }
      ])
    }
  })

  const first = middleware.wrapToolCall!(
    createToolCallRequest({ id: "tool-call-interrupt-1" }) as never,
    async () => {
      throw new Error("handler should not run")
    }
  )
  void middleware.wrapToolCall!(
    createToolCallRequest({ id: "tool-call-interrupt-2" }) as never,
    async () => {
      throw new Error("handler should not run")
    }
  )

  await assert.rejects(Promise.resolve(first), /tool-approval/)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(approvalRequests, ["tool-call-interrupt-1"])
})

test("auto mode allows file mutation tools without approval", async () => {
  const permissionRuntime = createToolPermissionRuntime({
    permissionMode: "auto"
  })

  const decision = await permissionRuntime.evaluate({
    args: {
      content: "hello",
      path: "/tmp/demo.txt"
    },
    toolName: "write_file"
  })

  assert.equal(decision.disposition, "allow")
})

test("explore mode denies file mutation tools without approval", async () => {
  const permissionRuntime = createToolPermissionRuntime({
    permissionMode: "explore"
  })

  const decision = await permissionRuntime.evaluate({
    args: {
      content: "hello",
      path: "/tmp/demo.txt"
    },
    toolName: "write_file"
  })

  assert.equal(decision.disposition, "deny")
})

test("click_screen_point requires an allowlisted target application", async () => {
  const middleware = createToolApprovalMiddleware({
    getAgentConfig: () => ({
      desktopAutomationAllowlist: ["com.netease.163music"],
      locale: "zh-CN",
      memorySources: [],
      skillSources: []
    })
  })

  let handlerCalls = 0
  const request = {
    toolCall: {
      args: {
        x: 100,
        y: 200
      },
      id: "tool-call-click-without-target",
      name: "click_screen_point",
      type: "tool_call"
    }
  }

  const result = (await middleware.wrapToolCall!(request as never, async () => {
    handlerCalls += 1
    return new ToolMessage({
      content: "should not run",
      name: "click_screen_point",
      tool_call_id: "tool-call-click-without-target"
    })
  })) as ToolMessage

  assert.equal(handlerCalls, 0)
  assert.equal(result.status, "error")
  assert.match(
    typeof result.content === "string" ? result.content : "",
    /requires a target application/i
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
