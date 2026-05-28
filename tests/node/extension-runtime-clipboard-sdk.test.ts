import assert from "node:assert/strict"
import test from "node:test"
import {
  Clipboard,
  createExtensionRuntimeNavigation,
  getSelectedText,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeHostRequestInput
} from "../../src/extension-runtime/sdk"
import type {
  ExtensionHostResponse,
  ExtensionRuntimeLaunchContext
} from "../../src/shared/extension-runtime-protocol"

test("Clipboard reads and writes text through runtime clipboard host requests", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const responses = ["Clipboard text from runtime", null]
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, requests, responses)
  })

  await runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(),
      navigation,
      requestHost: async (request) => resolveRuntimeRequest(request, requests, responses)
    },
    async () => {
      assert.equal(await Clipboard.readText(), "Clipboard text from runtime")
      await Clipboard.copy("Copied by Clipboard facade")
    }
  )

  assert.deepEqual(requests, [
    {
      capability: "clipboard",
      method: "read-text"
    },
    {
      capability: "clipboard",
      method: "write-text",
      payload: {
        text: "Copied by Clipboard facade"
      }
    }
  ])
})

test("getSelectedText reads launch fallback text before host requests", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, requests, [])
  })

  await runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(),
      launchProps: {
        fallbackText: "Selected text from launch"
      },
      navigation,
      requestHost: async (request) => resolveRuntimeRequest(request, requests, [])
    },
    async () => {
      assert.equal(await getSelectedText(), "Selected text from launch")
    }
  )

  assert.deepEqual(requests, [])
})

test("getSelectedText requests selected text from the host", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const responses = ["Selected text from host"]
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, requests, responses)
  })

  await runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(),
      navigation,
      requestHost: async (request) => resolveRuntimeRequest(request, requests, responses)
    },
    async () => {
      assert.equal(await getSelectedText(), "Selected text from host")
    }
  )

  assert.deepEqual(requests, [
    {
      capability: "clipboard",
      method: "read-selected-text"
    }
  ])
})

function createLaunchContext(): ExtensionRuntimeLaunchContext {
  return {
    commandName: "search-page",
    commandPreferences: {},
    extensionName: "notion",
    extensionPreferences: {},
    initialAction: "open",
    locale: "zh-CN",
    mode: "view",
    seedQuery: ""
  }
}

function resolveRuntimeRequest(
  request: ExtensionRuntimeHostRequestInput,
  requests: ExtensionRuntimeHostRequestInput[],
  responses: unknown[]
): ExtensionHostResponse {
  requests.push(request)
  return {
    id: "test-host-request",
    ok: true,
    result: responses.shift()
  }
}
