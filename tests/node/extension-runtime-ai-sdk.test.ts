import assert from "node:assert/strict"
import test from "node:test"
import { AI } from "@openwork/extension-api"
import {
  createExtensionRuntimeNavigation,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeHostRequestInput
} from "@openwork/extension-api/host-runtime"
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
        modelId: "openai:gpt-test",
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
        modelId: "openai:gpt-test",
        prompt: "hello",
        system: "Translate.",
        temperature: 0
      }
    }
  ])
})

function createLaunchContext(): ExtensionRuntimeLaunchContext {
  return {
    commandName: "translate",
    commandPreferences: {},
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
