import assert from "node:assert/strict"
import test, { mock } from "node:test"
import { AIMessage } from "@langchain/core/messages"
import type {
  ExtensionSourceBinding,
  ExtensionToolContext,
  ExtensionToolDefinition,
  SourceProfile
} from "../../src/shared/extension-sources"
import {
  assertExtensionAgentToolName,
  readSourceProfilesSnapshotFromMetadata,
  resolveExtensionToolPermission,
  RUN_SOURCE_PROFILES_SNAPSHOT_METADATA_KEY
} from "../../src/shared/extension-sources"
import { z } from "../../src/main/agent/tool-input-schema"
import {
  buildExtensionSourceGuide,
  createExtensionSourcesMiddleware
} from "../../src/main/agent/extension-sources-middleware"
import { createExtensionSourceRuntime } from "../../src/main/agent/extension-source-runtime"
import { createExtensionToolApprovalPolicyProvider } from "../../src/main/extension-tools/permission"
import { ExtensionToolExecutor } from "../../src/main/extension-tools/executor"
import { ExtensionToolRegistry } from "../../src/main/extension-tools/registry"

const createdAt = "2026-04-30T00:00:00.000Z"

function createProfile(overrides: Partial<SourceProfile> = {}): SourceProfile {
  const enabledToolNames = overrides.enabledToolNames ?? ["searchItems"]
  return {
    authStatus: "connected",
    createdAt,
    defaultPermissionMode: "ask-to-edit",
    displayName: "Mock Profile",
    enabled: true,
    enabledTools: enabledToolNames.map((toolName) => ({
      agentToolName: `ext__mockSource__${overrides.id ?? "profile_1"}__${toolName}`,
      display: {
        description: `${toolName} for ${overrides.displayName ?? "Mock Profile"}.`,
        title: `${toolName} (${overrides.displayName ?? "Mock Profile"})`
      },
      toolName
    })),
    enabledToolNames,
    extensionName: "mockExtension",
    id: "profile-1",
    publicConfig: {},
    sourceId: "mockSource",
    updatedAt: createdAt,
    ...overrides
  }
}

function createSourceBinding(profile: SourceProfile = createProfile()): ExtensionSourceBinding {
  return {
    profile,
    source: {
      defaultToolNames: ["searchItems"],
      description: "Mock source for tests.",
      extensionName: "mockExtension",
      guide: "Use this source for mock work items.",
      id: "mockSource",
      title: "Mock Source",
      writeToolNames: ["createItem"]
    }
  }
}

function createSearchTool(
  handler: ExtensionToolDefinition<{ query: string }, { result: string }>["handler"] = (
    _ctx,
    input
  ) => ({
    result: input.query
  })
): ExtensionToolDefinition<{ query: string }, { result: string }> {
  return {
    access: "read",
    description: "Search mock work items.",
    handler,
    inputSchema: z.object({
      query: z.string().trim().min(1)
    }),
    name: "searchItems",
    title: "Search Items"
  }
}

test("extension source agent tool names are externally provided and validated", () => {
  assert.doesNotThrow(() => assertExtensionAgentToolName("ext__mockSource__profile_1__searchItems"))
  assert.throws(() => assertExtensionAgentToolName("web_search"), /must start/)
  assert.throws(() => assertExtensionAgentToolName("ext__mock-source__searchItems"), /segment/)
})

test("extension permission mode resolves read, write, and external tools", () => {
  assert.equal(
    resolveExtensionToolPermission({
      access: "read",
      mode: "explore"
    }).disposition,
    "allow"
  )
  assert.equal(
    resolveExtensionToolPermission({
      access: "write",
      mode: "explore"
    }).disposition,
    "deny"
  )
  assert.equal(
    resolveExtensionToolPermission({
      access: "write",
      mode: "ask-to-edit"
    }).disposition,
    "require_approval"
  )
  assert.equal(
    resolveExtensionToolPermission({
      access: "write",
      mode: "ask-to-edit"
    }).disposition,
    "require_approval"
  )
  assert.equal(
    resolveExtensionToolPermission({
      access: "external",
      mode: "auto"
    }).disposition,
    "allow"
  )
  assert.equal(
    resolveExtensionToolPermission({
      access: "write",
      mode: "auto"
    }).disposition,
    "allow"
  )
})

test("source profile snapshot reader distinguishes missing snapshot from empty snapshot", () => {
  assert.equal(readSourceProfilesSnapshotFromMetadata(JSON.stringify({})), null)
  assert.deepEqual(
    readSourceProfilesSnapshotFromMetadata(
      JSON.stringify({
        [RUN_SOURCE_PROFILES_SNAPSHOT_METADATA_KEY]: []
      })
    ),
    []
  )
})

test("extension tool registry rejects duplicate extension tool names", () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool()])

  assert.throws(
    () => registry.registerExtensionTools("mockExtension", [createSearchTool()]),
    /duplicate tool/
  )
})

test("extension source binding allows same source tool through distinct profile tool ids", () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool()])

  const bindings = registry.createSourceToolBindings([
    createSourceBinding(createProfile({ displayName: "Personal", id: "personal" })),
    createSourceBinding(createProfile({ displayName: "Work", id: "work" }))
  ])

  assert.deepEqual(
    bindings.map((binding) => binding.agentToolName),
    ["ext__mockSource__personal__searchItems", "ext__mockSource__work__searchItems"]
  )
  assert.deepEqual(
    bindings.map((binding) => binding.display.title),
    ["searchItems (Personal)", "searchItems (Work)"]
  )
})

test("extension source binding rejects duplicate externally provided agent tool ids", () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool()])

  assert.throws(
    () =>
      registry.createSourceToolBindings([
        createSourceBinding(createProfile({ id: "profile_1" })),
        createSourceBinding(createProfile({ id: "profile_1" }))
      ]),
    /not unique/
  )
})

test("extension source binding skips stale enabled tool names", () => {
  const consoleWarn = mock.method(console, "warn", () => {})
  try {
    const registry = new ExtensionToolRegistry({
      knownExtensionNames: ["mockExtension"]
    })
    registry.registerExtensionTools("mockExtension", [createSearchTool()])

    const sourceBinding = createSourceBinding(
      createProfile({ enabledToolNames: ["searchItems", "removedTool"] })
    )
    const bindings = registry.createSourceToolBindings([sourceBinding])

    assert.deepEqual(
      bindings.map((binding) => binding.agentToolName),
      ["ext__mockSource__profile_1__searchItems"]
    )
    const guide = buildExtensionSourceGuide([sourceBinding], undefined, bindings)
    assert.match(guide, /Callable tools: searchItems \(Mock Profile\)/)
    assert.doesNotMatch(guide, /removedTool/)
  } finally {
    consoleWarn.mock.restore()
  }
})

test("extension tool executor validates input and passes source context to handlers", async () => {
  let observedContext: ExtensionToolContext | null = null
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [
    createSearchTool((ctx, input) => {
      observedContext = ctx
      return {
        result: input.query
      }
    })
  ])

  const [binding] = registry.createSourceToolBindings([createSourceBinding()])
  const executor = new ExtensionToolExecutor({ bindings: [binding] })

  const output = await executor.executeAgentTool({
    agentToolName: "ext__mockSource__profile_1__searchItems",
    args: {
      query: "  alpha  "
    },
    runId: "run-1",
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  assert.equal(output, '{\n  "result": "alpha"\n}')
  const context = observedContext as ExtensionToolContext | null
  assert.ok(context)
  assert.equal(context.agentToolName, "ext__mockSource__profile_1__searchItems")
  assert.equal(context.sourceProfileId, "profile-1")
  await assert.rejects(
    executor.executeAgentTool({
      agentToolName: "ext__mockSource__profile_1__searchItems",
      args: {
        query: "   "
      },
      threadId: "thread-1",
      workspacePath: "/workspace"
    }),
    /input validation failed/
  )
})

test("extension source middleware injects guides and exposes mock tools", async () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool()])

  const sourceBinding = createSourceBinding()
  const sourceToolBindings = registry.createSourceToolBindings([sourceBinding])
  const middleware = createExtensionSourcesMiddleware({
    sourceBindings: [sourceBinding],
    sourceToolBindings,
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  const tools = middleware.tools ?? []
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, "ext__mockSource__profile_1__searchItems")

  const toolOutput = await tools[0].invoke({
    query: "beta"
  })
  assert.equal(toolOutput, '{\n  "result": "beta"\n}')

  let observedSystemPrompt = ""
  await middleware.wrapModelCall!(
    {
      messages: [],
      systemPrompt: "base prompt",
      tools
    } as never,
    async (request) => {
      observedSystemPrompt = request.systemPrompt ?? ""
      return {} as never
    }
  )

  assert.match(observedSystemPrompt, /### Source Guides/)
  assert.match(observedSystemPrompt, /Mock Source/)
  assert.match(observedSystemPrompt, /Use this source for mock work items/)

  const response = await middleware.wrapModelCall!(
    {
      messages: [],
      systemPrompt: "base prompt",
      tools
    } as never,
    async () =>
      new AIMessage({
        content: "",
        tool_calls: [
          {
            args: {
              query: "beta"
            },
            id: "tool-call-1",
            name: "ext__mockSource__profile_1__searchItems",
            type: "tool_call"
          }
        ]
      }) as never
  )

  const toolCall = (response as AIMessage).tool_calls?.[0] as unknown as {
    display: unknown
    presentation: unknown
  }

  assert.deepEqual(toolCall.display, {
    description: "searchItems for Mock Profile.",
    title: "searchItems (Mock Profile)"
  })
  assert.deepEqual(toolCall.presentation, {
    access: "read",
    kind: "extension",
    profileTitle: "Mock Profile",
    sourceTitle: "Mock Source"
  })
})

test("extension source guide keeps missing auth non-callable", () => {
  const guide = buildExtensionSourceGuide([
    createSourceBinding(
      createProfile({
        authStatus: "missing"
      })
    )
  ])

  assert.match(guide, /Callable tools: none; auth status is missing/)
})

test("extension source runtime exposes only read bindings in explore mode", async () => {
  const writeTool: ExtensionToolDefinition<{ title: string }, { id: string }> = {
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
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [writeTool])

  const runtime = createExtensionSourceRuntime({
    permissionMode: "explore",
    registry,
    sourceBindings: [createSourceBinding(createProfile({ enabledToolNames: ["createItem"] }))],
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  assert.equal(
    runtime.sourceToolBindings[0]?.agentToolName,
    "ext__mockSource__profile_1__createItem"
  )
  assert.deepEqual(runtime.visibleSourceToolBindings, [])
  assert.deepEqual(runtime.middleware.tools, [])
  assert.equal(
    runtime.approvalPolicyProvider.getPolicy("ext__mockSource__profile_1__createItem")?.decision
      .disposition,
    "deny"
  )
})

test("extension tool approval policy provider maps generated names to permission decisions", () => {
  const writeTool: ExtensionToolDefinition<{ title: string }, { id: string }> = {
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
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool(), writeTool])

  const [binding] = registry.createSourceToolBindings([
    createSourceBinding(createProfile({ enabledToolNames: ["createItem"] }))
  ])
  const provider = createExtensionToolApprovalPolicyProvider({
    bindings: [binding],
    permissionMode: "ask-to-edit"
  })
  const policy = provider.getPolicy("ext__mockSource__profile_1__createItem")

  assert.equal(policy?.decision.disposition, "require_approval")
  assert.equal(
    provider.getReview("ext__mockSource__profile_1__createItem", { title: "Ship it" })?.kind,
    "extension_tool"
  )
  const review = provider.getReview("ext__mockSource__profile_1__createItem", { title: "Ship it" })
  assert.equal(review?.kind, "extension_tool")
  assert.equal(review.toolTitle, "createItem (Mock Profile)")
  assert.equal(provider.getPolicy("web_search"), null)
})
