import assert from "node:assert/strict"
import test from "node:test"
import { LocalStorage } from "@openwork/extension-api"
import {
  createExtensionRuntimeNavigation,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeHostRequestInput
} from "@openwork/extension-api/host-runtime"
import { loadPages, storePages } from "../../extensions/figma-files/src/cache"
import type {
  ExtensionHostResponse,
  ExtensionRuntimeLaunchContext
} from "../../src/shared/extension-runtime-protocol"

test("figma page cache invalidates when file last_modified changes", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const responses: unknown[] = [null, { lastModified: "2026-06-05T10:00:00Z", pages: [{ id: "1", name: "Page A" }] }, { lastModified: "2026-06-05T10:00:00Z", pages: [{ id: "1", name: "Page A" }] }]
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
      await storePages("file-1", "2026-06-05T10:00:00Z", [{ id: "1", name: "Page A" }])

      assert.deepEqual(await loadPages("file-1", "2026-06-05T10:00:00Z"), [
        { id: "1", name: "Page A" }
      ])
      assert.equal(await loadPages("file-1", "2026-06-05T11:00:00Z"), undefined)
    }
  )
})

test("figma page cache ignores legacy array-shaped cache entries", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const responses: unknown[] = [null, [{ id: "1", name: "Legacy Page" }]]
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
      await LocalStorage.setItem("figma-pages:file-1", [{ id: "1", name: "Legacy Page" }])
      assert.equal(await loadPages("file-1", "2026-06-05T10:00:00Z"), undefined)
    }
  )
})

function createLaunchContext(): ExtensionRuntimeLaunchContext {
  return {
    commandName: "index",
    commandPreferences: {},
    extensionName: "figma-files",
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
