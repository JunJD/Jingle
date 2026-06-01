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
  parseExtensionAiCapability,
  resolveExtensionToolPermission
} from "../../src/shared/extension-sources"
import { z } from "../../src/main/agent/tool-input-schema"
import {
  buildExtensionAiCapabilityGuide,
  buildExtensionInstructions,
  createExtensionAiMiddleware
} from "../../src/main/agent/extension-ai-middleware"
import {
  createExtensionAiRuntime,
  createExtensionAiSession
} from "../../src/main/agent/extension-ai-runtime"
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

test("extension AI capability schema accepts connection ids", () => {
  const capability = parseExtensionAiCapability({
    connectionId: "default",
    guide: "Use this capability in tests.",
    id: "mockSource",
    title: "Mock Source",
    toolNames: []
  })

  assert.equal(capability?.connectionId, "default")
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

test("extension AI session replaces stale bindings when a capability is reloaded", () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool()])

  const session = createExtensionAiSession({
    aiCapabilities: [createAiCapability()],
    registry
  })
  assert.deepEqual(
    session.getAllToolBindings().map((binding) => binding.agentToolName),
    ["ext__mockSource__profile_1__searchItems"]
  )

  session.loadAiCapability(
    createAiCapability({
      authStatus: "missing",
      enabledToolNames: [],
      toolExposures: []
    })
  )

  assert.deepEqual(session.getAllToolBindings(), [])
  assert.deepEqual(session.getVisibleToolBindings(), [])
  assert.equal(session.getAiCapabilities()[0]?.authStatus, "missing")
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
  assert.deepEqual(context.extensionPreferences, {})
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

test("extension tool executor injects resolved extension preferences", async () => {
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
  const executor = new ExtensionToolExecutor({
    bindings: [binding],
    getExtensionPreferences: (extensionName) => ({
      extensionName,
      token: "secret-token"
    })
  })

  await executor.executeAgentTool({
    agentToolName: "ext__mockSource__profile_1__searchItems",
    args: {
      query: "alpha"
    },
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  const context = observedContext as ExtensionToolContext | null
  assert.ok(context)
  assert.deepEqual(context.extensionPreferences, {
    extensionName: "mockExtension",
    token: "secret-token"
  })
})

test("extension tool executor prefers execution context over preference fallback", async () => {
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
  const executor = new ExtensionToolExecutor({
    bindings: [binding],
    getExtensionExecutionContext: (extensionName) => ({
      connection: {
        connectionId: "default",
        extensionName,
        missingSecretNames: [],
        provider: "mock",
        publicConfig: {
          apiBaseUrl: "https://mock.example.test"
        },
        status: "connected"
      },
      extensionName,
      extensionPreferences: {
        token: "context-token"
      }
    }),
    getExtensionPreferences: () => ({
      token: "fallback-token"
    })
  })

  await executor.executeAgentTool({
    agentToolName: binding.agentToolName,
    args: {
      query: "alpha"
    },
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  const context = observedContext as ExtensionToolContext | null
  assert.ok(context)
  assert.equal(context.connection?.status, "connected")
  assert.deepEqual(context.extensionPreferences, {
    token: "context-token"
  })
})

test("extension AI middleware injects loaded guides and executes through stable tools", async () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool()])

  const aiCapability = createAiCapability()
  const session = createExtensionAiSession({
    aiCapabilities: [aiCapability],
    registry
  })
  const middleware = createExtensionAiMiddleware({
    aiCapabilityCatalog: [],
    session,
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  const tools = middleware.tools ?? []
  const callExtensionTool = tools[1]
  assert.ok(callExtensionTool)
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["loadExtension", "callExtensionTool"]
  )

  const toolOutput = await callExtensionTool.invoke({
    args: {
      query: "beta"
    },
    extensionName: "mockExtension",
    toolName: "searchItems"
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
              args: {
                query: "beta"
              },
              extensionName: "mockExtension",
              toolName: "searchItems"
            },
            id: "tool-call-1",
            name: "callExtensionTool",
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

test("loaded extension stays callable while catalog only lists unloaded extensions", async () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool()])

  const session = createExtensionAiSession({
    aiCapabilities: [createAiCapability()],
    registry
  })
  const middleware = createExtensionAiMiddleware({
    aiCapabilityCatalog: [
      {
        description: "Mock source for tests.",
        extensionName: "mockExtension",
        sourceId: "mockSource",
        title: "Mock Source"
      },
      {
        description: "Another source for tests.",
        extensionName: "otherExtension",
        sourceId: "otherSource",
        title: "Other Source"
      }
    ],
    session,
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  assert.deepEqual(
    middleware.tools?.map((tool) => tool.name),
    ["loadExtension", "callExtensionTool"]
  )
  const loadExtensionTool = middleware.tools?.find((candidate) => candidate.name === "loadExtension")
  const loadExtensionSchema = (
    loadExtensionTool?.schema as { toJSONSchema?: () => { properties?: Record<string, unknown> } }
  )?.toJSONSchema?.()
  assert.deepEqual(loadExtensionSchema?.properties?.extensionName, {
    minLength: 1,
    type: "string"
  })
  assert.match(
    await loadExtensionTool!.invoke({
      extensionName: "mockExtension"
    }),
    /Extension already loaded: Mock Source/
  )

  const callExtensionTool = middleware.tools?.find(
    (candidate) => candidate.name === "callExtensionTool"
  )
  assert.ok(callExtensionTool)
  const toolOutput = await callExtensionTool.invoke({
    args: {
      query: "loaded"
    },
    extensionName: "mockExtension",
    toolName: "searchItems"
  })
  assert.equal(toolOutput, '{\n  "result": "loaded"\n}')

  let observedSystemPrompt = ""
  await middleware.wrapModelCall!(
    {
      messages: [],
      systemPrompt: "base prompt",
      tools: middleware.tools
    } as never,
    async (request) => {
      observedSystemPrompt = request.systemPrompt ?? ""
      assert.strictEqual(
        request.tools?.find((candidate) => candidate.name === "loadExtension"),
        loadExtensionTool
      )
      return {} as never
    }
  )

  assert.match(observedSystemPrompt, /### Extension AI Capability Guides/)
  assert.match(observedSystemPrompt, /### Extension Instructions/)
  assert.match(observedSystemPrompt, /### Available Extensions/)
  assert.doesNotMatch(observedSystemPrompt, /Mock Source \(mockExtension\)/)
  assert.match(observedSystemPrompt, /Other Source \(otherExtension\)/)
})

test("extension AI middleware keeps model tools stable after all catalog extensions are loaded", async () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool()])

  const session = createExtensionAiSession({
    aiCapabilities: [createAiCapability()],
    registry
  })
  const middleware = createExtensionAiMiddleware({
    aiCapabilityCatalog: [
      {
        description: "Mock source for tests.",
        extensionName: "mockExtension",
        sourceId: "mockSource",
        title: "Mock Source"
      }
    ],
    session,
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  const registeredTools = middleware.tools ?? []
  let observedTools: string[] = []
  let observedToolRefs: unknown[] = []
  let observedSystemPrompt = ""
  await middleware.wrapModelCall!(
    {
      messages: [],
      systemPrompt: "base prompt",
      tools: middleware.tools
    } as never,
    async (request) => {
      observedSystemPrompt = request.systemPrompt ?? ""
      observedToolRefs = request.tools
      observedTools = request.tools.flatMap((tool) =>
        typeof tool.name === "string" ? [tool.name] : []
      )
      return {} as never
    }
  )

  assert.deepEqual(observedTools, ["loadExtension", "callExtensionTool"])
  assert.equal(observedToolRefs[0], registeredTools[0])
  assert.equal(observedToolRefs[1], registeredTools[1])
  assert.doesNotMatch(observedSystemPrompt, /### Available Extensions/)
  assert.match(observedSystemPrompt, /### Extension AI Capability Guides/)
})

test("extension AI middleware persists loaded capabilities using runtime run id fallback", async () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["mockExtension"]
  })
  registry.registerExtensionTools("mockExtension", [createSearchTool()])

  const session = createExtensionAiSession({
    aiCapabilities: [],
    registry
  })
  const changes: Array<{
    aiCapabilities: ResolvedExtensionAiCapability[]
    runId: string
  }> = []
  const middleware = createExtensionAiMiddleware({
    aiCapabilityCatalog: [
      {
        description: "Mock source for tests.",
        extensionName: "mockExtension",
        sourceId: "mockSource",
        title: "Mock Source"
      }
    ],
    getAiCapabilityByExtensionName: (extensionName) =>
      extensionName === "mockExtension" ? createAiCapability() : null,
    onLoadedAiCapabilitiesChanged: (change) => {
      changes.push({
        aiCapabilities: change.aiCapabilities,
        runId: change.runId
      })
    },
    runId: "run-from-runtime",
    session,
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  const loadExtensionTool = middleware.tools?.find((candidate) => candidate.name === "loadExtension")
  assert.ok(loadExtensionTool)

  await loadExtensionTool.invoke({
    extensionName: "mockExtension"
  })

  assert.equal(changes.length, 1)
  assert.equal(changes[0]?.runId, "run-from-runtime")
  assert.equal(changes[0]?.aiCapabilities[0]?.extensionName, "mockExtension")
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
  assert.deepEqual(
    runtime.middleware.tools?.map((tool) => tool.name),
    ["loadExtension", "callExtensionTool"]
  )
})
