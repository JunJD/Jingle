import assert from "node:assert/strict"
import test from "node:test"
import { AI } from "@jingle/extension-api"
import {
  createExtensionRuntimeNavigation,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeHostRequestInput
} from "@jingle/extension-api/host-runtime"
import type {
  ExtensionHostResponse,
  ExtensionRuntimeLaunchContext
} from "../../src/shared/extension-runtime-protocol"

test("AI.ask sends an ai ask host request and resolves text", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, requests)
  })

  const text = await runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(),
      navigation,
      requestHost: async (request) => resolveRuntimeRequest(request, requests)
    },
    () =>
      AI.ask({
        modelPreference: "fast",
        prompt: "hello",
        system: "Translate.",
        temperature: 0
      })
  )

  assert.equal(text, "你好")
  assert.deepEqual(requests, [
    {
      capability: "ai",
      method: "ask",
      payload: {
        modelPreference: "fast",
        prompt: "hello",
        system: "Translate.",
        temperature: 0
      }
    }
  ])
})

test("AI.ask string form sends an explicit default model policy", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, requests)
  })

  await runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(),
      navigation,
      requestHost: async (request) => resolveRuntimeRequest(request, requests)
    },
    () => AI.ask("hello")
  )

  assert.deepEqual(requests, [
    {
      capability: "ai",
      method: "ask",
      payload: { modelPreference: "default", prompt: "hello" }
    }
  ])
})

test("AI.ask validates its public payload before sending a host request", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, requests)
  })
  const context = {
    ...createLaunchContext(),
    navigation,
    requestHost: async (request: ExtensionRuntimeHostRequestInput) =>
      resolveRuntimeRequest(request, requests)
  }

  await assert.rejects(
    runWithExtensionRuntimeSdk(context, () =>
      AI.ask({ modelId: "openai:gpt-test", prompt: "hello" } as never)
    ),
    /unsupported property "modelId"/
  )
  await assert.rejects(
    runWithExtensionRuntimeSdk(context, () =>
      AI.ask({ modelPreference: "balanced", prompt: "hello" } as never)
    ),
    /modelPreference must be "default" or "fast"/
  )
  await assert.rejects(
    runWithExtensionRuntimeSdk(context, () => AI.ask({ prompt: "hello" } as never)),
    /modelPreference must be "default" or "fast"/
  )
  await assert.rejects(
    runWithExtensionRuntimeSdk(context, () =>
      AI.ask({ modelPreference: "fast", prompt: "hello", temperature: 2.1 })
    ),
    /temperature must be between 0 and 2/
  )
  await assert.rejects(
    runWithExtensionRuntimeSdk(context, () => AI.ask(" ")),
    /prompt must be a non-empty string/
  )
  await assert.rejects(
    runWithExtensionRuntimeSdk(context, () => AI.ask("x".repeat(200_001))),
    /prompt must not exceed 200000 characters/
  )
  await assert.rejects(
    runWithExtensionRuntimeSdk(context, () =>
      AI.ask({ modelPreference: "fast", prompt: "hello", system: "x".repeat(40_001) })
    ),
    /system must not exceed 40000 characters/
  )
  await assert.rejects(
    runWithExtensionRuntimeSdk(context, () =>
      AI.ask({ modelPreference: "fast", prompt: "hello", temperature: Number.NaN })
    ),
    /must contain only finite numbers/
  )
  assert.deepEqual(requests, [])
})

function createLaunchContext(): ExtensionRuntimeLaunchContext {
  return {
    commandName: "translate",
    commandPreferences: {},
    dataIdentity: { kind: "unavailable" },
    extensionName: "translate",
    extensionPreferences: {},
    initialAction: "open",
    locale: "zh-CN",
    mode: "view",
    seedQuery: ""
  }
}

function resolveRuntimeRequest(
  request: ExtensionRuntimeHostRequestInput,
  requests: ExtensionRuntimeHostRequestInput[]
): ExtensionHostResponse {
  requests.push(request)
  return {
    id: "test-host-request",
    ok: true,
    result: "你好"
  }
}
