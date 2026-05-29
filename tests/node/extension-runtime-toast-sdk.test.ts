import assert from "node:assert/strict"
import test from "node:test"
import {
  LaunchType,
  PopToRootType,
  Toast,
  closeMainWindow,
  createExtensionRuntimeNavigation,
  launchCommand,
  runWithExtensionRuntimeSdk,
  showHUD,
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
  const toastActions: Array<() => Promise<void> | void> = []
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, requests)
  })

  await runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(),
      navigation,
      registerToastAction: (handler) => {
        const id = `toast-action-${toastActions.length}`
        toastActions.push(handler)
        return { id }
      },
      requestHost: async (request) => resolveRuntimeRequest(request, requests)
    },
    async () => {
      await showToast({
        message: "Page title",
        primaryAction: {
          onAction: () => undefined,
          shortcut: {
            macOS: { key: "o", modifiers: ["cmd"] },
            Windows: { key: "o", modifiers: ["ctrl"] }
          },
          title: "Open Page"
        },
        secondaryAction: {
          onAction: () => undefined,
          shortcut: {
            macOS: { key: "c", modifiers: ["cmd", "shift"] },
            Windows: { key: "c", modifiers: ["ctrl", "shift"] }
          },
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
          id: "toast-action-0",
          shortcut: {
            key: "o",
            modifiers: ["cmd"]
          },
          title: "Open Page"
        },
        secondaryAction: {
          id: "toast-action-1",
          shortcut: {
            key: "c",
            modifiers: ["cmd", "shift"]
          },
          title: "Copy URL"
        },
        style: "success",
        title: "Page created"
      }
    }
  ])
  assert.equal(toastActions.length, 2)
})

test("showToast drops toast actions without executable handlers", async () => {
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
        primaryAction: {
          shortcut: {
            macOS: { key: "o", modifiers: ["cmd"] },
            Windows: { key: "o", modifiers: ["ctrl"] }
          },
          title: "Open Page"
        },
        secondaryAction: {
          onAction: () => undefined,
          title: "Copy URL"
        },
        title: "Page created"
      })
    }
  )

  assert.deepEqual(requests, [
    {
      capability: "toast",
      method: "show",
      payload: {
        message: undefined,
        primaryAction: undefined,
        secondaryAction: undefined,
        style: undefined,
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

test("showHUD maps to a success toast host request", async () => {
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
      await showHUD("Done")
    }
  )

  assert.deepEqual(requests, [
    {
      capability: "toast",
      method: "show",
      payload: {
        message: undefined,
        primaryAction: undefined,
        secondaryAction: undefined,
        style: "success",
        title: "Done"
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

test("launchCommand maps command launch options to runtime navigation", async () => {
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
      await launchCommand({
        arguments: {
          text: "Captured"
        },
        context: {
          defaults: {
            pageId: "page-1"
          }
        },
        extensionName: "notion",
        fallbackText: "https://example.com/article",
        name: "quick-capture",
        ownerOrAuthorName: "openwork",
        type: LaunchType.UserInitiated
      })
    }
  )

  assert.deepEqual(requests, [
    {
      capability: "navigation",
      method: "open-command",
      payload: {
        commandName: "quick-capture",
        extensionName: "notion",
        launchProps: {
          arguments: {
            text: "Captured"
          },
          fallbackText: "https://example.com/article",
          launchContext: {
            defaults: {
              pageId: "page-1"
            }
          }
        },
        showLauncher: true
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
  requests: ExtensionRuntimeHostRequestInput[]
): ExtensionHostResponse {
  requests.push(request)
  return {
    id: "test-host-request",
    ok: true,
    result: null
  }
}
