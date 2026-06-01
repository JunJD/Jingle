import assert from "node:assert/strict"
import test from "node:test"
import { getPreferenceValues, runWithExtensionRuntimeSdk } from "@openwork/extension-api"
import {
  createExtensionRuntimeNavigation,
  getActiveExtensionRuntimeSdk,
  type ExtensionRuntimeSdkContextValue
} from "@openwork/extension-api/host-runtime"
import { z } from "../../src/main/agent/tool-input-schema"
import { ExtensionToolExecutor } from "../../src/main/extension-tools/executor"
import { ExtensionToolRegistry } from "../../src/main/extension-tools/registry"
import type { ExtensionToolDefinition } from "../../src/shared/extension-sources"
import type { ExtensionHostResponse } from "../../src/shared/extension-runtime-protocol"

interface TestPreferenceValues {
  accessToken?: string
  commandOnly?: string
}

test("extension API facade reads the active SDK context through the real package alias", async () => {
  const context = createLaunchContext("facade-sdk", {
    commandPreferences: {
      commandOnly: "yes"
    },
    extensionPreferences: {
      accessToken: "secret-token"
    }
  })

  const observed = await runWithExtensionRuntimeSdk(context, () => ({
    accessToken: getPreferenceValues<TestPreferenceValues>().accessToken,
    commandOnly: getPreferenceValues<TestPreferenceValues>().commandOnly
  }))

  assert.deepEqual(observed, {
    accessToken: "secret-token",
    commandOnly: "yes"
  })
})

test("agent extension tool SDK context is isolated across concurrent executor calls", async () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["alpha", "beta"]
  })
  registry.registerExtensionTools("alpha", [createPreferenceEchoTool()])
  registry.registerExtensionTools("beta", [createPreferenceEchoTool()])

  const bindings = registry.createAiCapabilityToolBindings([
    createResolvedCapability("alpha", "alpha-token"),
    createResolvedCapability("beta", "beta-token")
  ])
  const executor = new ExtensionToolExecutor({
    bindings,
    getExtensionPreferences: (extensionName) => ({
      accessToken: `${extensionName}-token`
    })
  })

  const [alphaOutput, betaOutput] = await Promise.all([
    executor.executeAgentTool({
      agentToolName: "ext__alpha__echoPreference",
      args: {
        delayMs: 10
      },
      threadId: "thread-1",
      workspacePath: "/workspace"
    }),
    executor.executeAgentTool({
      agentToolName: "ext__beta__echoPreference",
      args: {
        delayMs: 0
      },
      threadId: "thread-1",
      workspacePath: "/workspace"
    })
  ])

  assert.equal(alphaOutput, '{\n  "accessToken": "alpha-token",\n  "extensionName": "alpha"\n}')
  assert.equal(betaOutput, '{\n  "accessToken": "beta-token",\n  "extensionName": "beta"\n}')
})

test("imperative runtime SDK context restores the outer async run after nested runs", async () => {
  const outerContext = createLaunchContext("outer-sdk")
  const innerContext = createLaunchContext("inner-sdk")

  const observedNames = await runWithExtensionRuntimeSdk(outerContext, async () => {
    const before = getActiveExtensionRuntimeSdk().extensionName
    const inner = await runWithExtensionRuntimeSdk(
      innerContext,
      () => getActiveExtensionRuntimeSdk().extensionName
    )
    const after = getActiveExtensionRuntimeSdk().extensionName

    return [before, inner, after]
  })

  assert.deepEqual(observedNames, ["outer-sdk", "inner-sdk", "outer-sdk"])
})

function createPreferenceEchoTool(): ExtensionToolDefinition<
  { delayMs: number },
  { accessToken: unknown; extensionName: string }
> {
  return {
    access: "read",
    description: "Read active preference values through the extension API facade.",
    inputSchema: z.object({
      delayMs: z.number().int().min(0)
    }),
    name: "echoPreference",
    title: "Echo Preference",
    async handler(ctx, input) {
      return runWithExtensionRuntimeSdk(createLaunchContext(ctx.extensionName, ctx), async () => {
        await new Promise((resolve) => setTimeout(resolve, input.delayMs))
        return {
          accessToken: getPreferenceValues<TestPreferenceValues>().accessToken,
          extensionName: getActiveExtensionRuntimeSdk().extensionName
        }
      })
    }
  }
}

function createResolvedCapability(extensionName: string, accessToken: string) {
  return {
    authStatus: "connected" as const,
    capability: {
      guide: `Use ${extensionName}.`,
      id: extensionName,
      title: extensionName,
      toolNames: ["echoPreference"]
    },
    displayName: extensionName,
    enabled: true,
    enabledToolNames: ["echoPreference"],
    extensionName,
    permissionMode: "ask-to-edit" as const,
    publicConfig: {
      accessToken
    },
    toolExposures: [
      {
        agentToolName: `ext__${extensionName}__echoPreference`,
        display: {
          description: `Read ${extensionName} preference.`,
          title: "Echo Preference"
        },
        toolName: "echoPreference"
      }
    ]
  }
}

function createLaunchContext(
  extensionName: string,
  options: {
    commandPreferences?: Record<string, unknown>
    extensionPreferences?: Record<string, unknown>
  } = {}
): ExtensionRuntimeSdkContextValue {
  const requestHost = async (): Promise<ExtensionHostResponse> => ({
    id: "test-host-request",
    ok: true,
    result: null
  })

  return {
    commandName: "index",
    commandPreferences: options.commandPreferences ?? {},
    extensionName,
    extensionPreferences: options.extensionPreferences ?? {},
    initialAction: "open",
    locale: "zh-CN",
    mode: "no-view",
    navigation: createExtensionRuntimeNavigation({
      requestHost
    }),
    requestHost,
    seedQuery: ""
  }
}
