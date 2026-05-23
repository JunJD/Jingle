import assert from "node:assert/strict"
import test, { mock } from "node:test"
import { AIMessage } from "@langchain/core/messages"
import type {
  ExtensionAiCapabilityTool,
  ExtensionToolContext,
  ExtensionToolDefinition,
  ResolvedExtensionAiCapability
} from "../../src/shared/extension-sources"
import {
  assertExtensionAgentToolName,
  LEGACY_SOURCE_PROFILES_SNAPSHOT_METADATA_KEY,
  readLegacySourceProfilesSnapshotFromMetadata,
  resolveExtensionToolPermission
} from "../../src/shared/extension-sources"
import { z } from "../../src/main/agent/tool-input-schema"
import {
  buildExtensionAiCapabilityGuide,
  buildExtensionInstructions,
  createExtensionAiMiddleware
} from "../../src/main/agent/extension-ai-middleware"
import { createExtensionAiRuntime } from "../../src/main/agent/extension-ai-runtime"
import { createExtensionToolApprovalPolicyProvider } from "../../src/main/extension-tools/permission"
import { ExtensionToolExecutor } from "../../src/main/extension-tools/executor"
import { ExtensionToolRegistry } from "../../src/main/extension-tools/registry"
import { defineNativeExtensionManifest } from "../../src/shared/native-extensions"

type MockResolvedCapabilityInput = {
  authStatus?: ResolvedExtensionAiCapability["authStatus"]
  displayName?: string
  enabled?: boolean
  enabledToolNames?: string[]
  id?: string
  permissionMode?: ResolvedExtensionAiCapability["permissionMode"]
  publicConfig?: Record<string, unknown>
  toolExposures?: ExtensionAiCapabilityTool[]
}

function createAiCapability(
  overrides: MockResolvedCapabilityInput = {}
): ResolvedExtensionAiCapability {
  const enabledToolNames = overrides.enabledToolNames ?? ["searchItems"]
  const displayName = overrides.displayName ?? "Mock Profile"
  const exposureId = overrides.id ?? "profile_1"
  const toolExposures =
    overrides.toolExposures ??
    enabledToolNames.map((toolName) => ({
      agentToolName: `ext__mockSource__${exposureId}__${toolName}`,
      display: {
        description: `${toolName} for ${displayName}.`,
        title: `${toolName} (${displayName})`
      },
      toolName
    }))

  return {
    authStatus: overrides.authStatus ?? "connected",
    capability: {
      description: "Mock source for tests.",
      guide: "Use this source for mock work items.",
      id: "mockSource",
      instructions: ["Use the Mock extension for tests."],
      title: "Mock Source",
      toolNames: ["searchItems", "createItem"]
    },
    displayName,
    enabled: overrides.enabled ?? true,
    enabledToolNames,
    extensionName: "mockExtension",
    permissionMode: overrides.permissionMode ?? "ask-to-edit",
    publicConfig: structuredClone(overrides.publicConfig ?? {}),
    toolExposures: structuredClone(toolExposures)
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

test("native extension manifest rejects legacy ai configuration", () => {
  assert.throws(
    () =>
      defineNativeExtensionManifest({
        ai: {
          instructions: ["Use the legacy field."]
        },
        capabilities: [],
        commands: [],
        name: "legacy-ai",
        title: "Legacy AI"
      }),
    /aiCapability, not ai/
  )
})

test("legacy source profile snapshot reader distinguishes missing snapshot from empty snapshot", () => {
  assert.equal(readLegacySourceProfilesSnapshotFromMetadata(JSON.stringify({})), null)
  assert.deepEqual(
    readLegacySourceProfilesSnapshotFromMetadata(
      JSON.stringify({
        [LEGACY_SOURCE_PROFILES_SNAPSHOT_METADATA_KEY]: []
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

test("extension AI capability binding allows same tool through distinct resolved tool ids", () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool()])

  const bindings = registry.createAiCapabilityToolBindings([
    createAiCapability({ displayName: "Personal", id: "personal" }),
    createAiCapability({ displayName: "Work", id: "work" })
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

test("extension AI capability binding rejects duplicate externally provided agent tool ids", () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool()])

  assert.throws(
    () =>
      registry.createAiCapabilityToolBindings([
        createAiCapability({ id: "profile_1" }),
        createAiCapability({ id: "profile_1" })
      ]),
    /not unique/
  )
})

test("extension AI capability binding skips stale enabled tool names", () => {
  const consoleWarn = mock.method(console, "warn", () => {})
  try {
    const registry = new ExtensionToolRegistry({
      knownExtensionNames: ["mockExtension"]
    })
    registry.registerExtensionTools("mockExtension", [createSearchTool()])

    const aiCapability = createAiCapability({ enabledToolNames: ["searchItems", "removedTool"] })
    const bindings = registry.createAiCapabilityToolBindings([aiCapability])

    assert.deepEqual(
      bindings.map((binding) => binding.agentToolName),
      ["ext__mockSource__profile_1__searchItems"]
    )
    const guide = buildExtensionAiCapabilityGuide([aiCapability], undefined, bindings)
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

  const [binding] = registry.createAiCapabilityToolBindings([createAiCapability()])
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
  assert.equal(context.capabilityId, "mockSource")
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

test("extension AI middleware injects guides and exposes mock tools", async () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool()])

  const aiCapability = createAiCapability()
  const aiToolBindings = registry.createAiCapabilityToolBindings([aiCapability])
  const middleware = createExtensionAiMiddleware({
    aiCapabilities: [aiCapability],
    aiToolBindings,
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

  assert.match(observedSystemPrompt, /### Extension AI Capability Guides/)
  assert.match(observedSystemPrompt, /### Extension Instructions/)
  assert.match(observedSystemPrompt, /Use the Mock extension for tests/)
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
    capabilityDisplayName: "Mock Profile",
    capabilityTitle: "Mock Source",
    kind: "extension"
  })
})

test("extension instructions are separate from source guides", () => {
  const aiCapability = createAiCapability()
  const instructions = buildExtensionInstructions([aiCapability])
  const guide = buildExtensionAiCapabilityGuide([aiCapability])

  assert.match(instructions, /### Extension Instructions/)
  assert.match(instructions, /Use the Mock extension for tests/)
  assert.doesNotMatch(instructions, /Use this source for mock work items/)
  assert.match(guide, /### Extension AI Capability Guides/)
  assert.match(guide, /Use this source for mock work items/)
  assert.doesNotMatch(guide, /Use the Mock extension for tests/)
})

test("extension AI capability guide keeps missing auth non-callable", () => {
  const missingCapability = createAiCapability({
    authStatus: "missing",
    enabled: true
  })
  const guide = buildExtensionAiCapabilityGuide([missingCapability])

  assert.match(guide, /Callable tools: none; auth status is missing/)
})

test("missing auth still injects extension instructions and source guide", () => {
  const missingCapability = createAiCapability({
    authStatus: "missing",
    enabled: true,
    enabledToolNames: [],
    toolExposures: []
  })

  assert.match(buildExtensionInstructions([missingCapability]), /Use the Mock extension for tests/)
  assert.match(
    buildExtensionAiCapabilityGuide([missingCapability]),
    /Use this source for mock work items/
  )
})

test("extension AI runtime exposes only read bindings in explore mode", async () => {
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

  const runtime = createExtensionAiRuntime({
    aiCapabilities: [createAiCapability({ enabledToolNames: ["createItem"] })],
    permissionMode: "explore",
    registry,
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  assert.equal(runtime.aiToolBindings[0]?.agentToolName, "ext__mockSource__profile_1__createItem")
  assert.deepEqual(runtime.visibleAiToolBindings, [])
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

  const [binding] = registry.createAiCapabilityToolBindings([
    createAiCapability({ enabledToolNames: ["createItem"] })
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
