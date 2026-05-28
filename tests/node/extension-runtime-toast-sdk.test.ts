import assert from "node:assert/strict"
import test from "node:test"
import {
  PopToRootType,
  Toast,
  closeMainWindow,
  createExtensionRuntimeNavigation,
  runWithExtensionRuntimeSdk,
  showToast,
  type ExtensionRuntimeHostRequestInput
} from "../../src/extension-runtime/sdk"
import { showFailureToast } from "../../packages/extension-utils/src"
import type {
  ExtensionHostResponse,
  ExtensionRuntimeLaunchContext
} from "../../src/shared/extension-runtime-protocol"

test("showToast sends toast payloads through the runtime toast host request", async () => {
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
    async () => {
      await showToast({
        message: "Page title",
        primaryAction: {
          onAction: () => undefined,
          title: "Copy URL"
        },
        style: Toast.Style.Success,
        title: "Page created"
      })
    }
  )

  assert.deepEqual(requests, [
    {
      capability: "toast",
      method: "show",
      payload: {
        message: "Page title",
        primaryAction: {
          title: "Copy URL"
        },
        secondaryAction: undefined,
        style: "success",
        title: "Page created"
      }
    }
  ])
})

test("showFailureToast maps errors to failure toast host requests", async () => {
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
    async () => {
      await showFailureToast(new Error("Notion request failed"), {
        title: "Could not load page"
      })
      await showFailureToast("Missing token", {
        message: "Connect Notion in Settings"
      })
    }
  )

  assert.deepEqual(requests, [
    {
      capability: "toast",
      method: "show",
      payload: {
        message: "Notion request failed",
        primaryAction: undefined,
        secondaryAction: undefined,
        style: "failure",
        title: "Could not load page"
      }
    },
    {
      capability: "toast",
      method: "show",
      payload: {
        message: "Connect Notion in Settings",
        primaryAction: undefined,
        secondaryAction: undefined,
        style: "failure",
        title: "Something went wrong"
      }
    }
  ])
})

test("closeMainWindow maps to the runtime hide-launcher navigation request", async () => {
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
    async () => {
      await closeMainWindow({
        popToRootType: PopToRootType.Suspended
      })
    }
  )

  assert.deepEqual(requests, [
    {
      capability: "navigation",
      method: "hide-launcher"
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
  requests: ExtensionRuntimeHostRequestInput[]
): ExtensionHostResponse {
  requests.push(request)
  return {
    id: "test-host-request",
    ok: true,
    result: null
  }
}
