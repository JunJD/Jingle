import assert from "node:assert/strict"
import test from "node:test"
import {
  LocalStorage,
  createExtensionRuntimeNavigation,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeHostRequestInput
} from "../../src/extension-runtime/sdk"
import type {
  ExtensionHostResponse,
  ExtensionRuntimeLaunchContext
} from "../../src/shared/extension-runtime-protocol"

test("LocalStorage uses extension-scoped runtime storage host requests", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const responses = [
    "stored page",
    null,
    {
      recentPage: "page-1"
    },
    null,
    null
  ]
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
      assert.equal(await LocalStorage.getItem<string>("recentPage"), "stored page")
      await LocalStorage.setItem("recentPage", "page-2")
      assert.deepEqual(await LocalStorage.allItems(), {
        recentPage: "page-1"
      })
      await LocalStorage.removeItem("recentPage")
      await LocalStorage.clear()
    }
  )

  assert.deepEqual(requests, [
    {
      capability: "storage",
      method: "get",
      payload: {
        key: "recentPage",
        scope: "extension"
      }
    },
    {
      capability: "storage",
      method: "set",
      payload: {
        key: "recentPage",
        scope: "extension",
        value: "page-2"
      }
    },
    {
      capability: "storage",
      method: "all-items",
      payload: {
        scope: "extension"
      }
    },
    {
      capability: "storage",
      method: "remove",
      payload: {
        key: "recentPage",
        scope: "extension"
      }
    },
    {
      capability: "storage",
      method: "clear",
      payload: {
        scope: "extension"
      }
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
