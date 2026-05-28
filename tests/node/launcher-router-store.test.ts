import assert from "node:assert/strict"
import test from "node:test"
import { AI_CHAT_COMMAND_NAME, AI_LAUNCHER_PLUGIN_ID } from "../../src/shared/launcher-ai"
import { createLauncherRouterStore } from "../../src/renderer/src/launcher-shell/hooks/launcher-router-store-core"
import type {
  LauncherBuiltInCommandAddress,
  LauncherExtensionCommandAddress
} from "../../src/renderer/src/launcher-shell/pages/types"

const BUILT_IN_ADDRESS: LauncherBuiltInCommandAddress = {
  builtInId: AI_LAUNCHER_PLUGIN_ID,
  commandName: AI_CHAT_COMMAND_NAME,
  kind: "built-in-command"
}

const EXTENSION_ADDRESS: LauncherExtensionCommandAddress = {
  commandName: "open-panel",
  extensionName: "test-extension",
  kind: "extension-command"
}

test("openCommand enters the command route and fills default options", () => {
  const store = createLauncherRouterStore()

  store.getState().openCommand(BUILT_IN_ADDRESS)
  const state = store.getState()

  assert.equal(state.navigationDirection, "forward")
  assert.deepEqual(state.route, {
    ...BUILT_IN_ADDRESS,
    initialAction: "focus",
    seedQuery: ""
  })
  assert.equal(
    state.routeKey,
    `built-in-command:${AI_LAUNCHER_PLUGIN_ID}:${AI_CHAT_COMMAND_NAME}:focus::`
  )
})

test("openCommand preserves explicit options in the route key", () => {
  const store = createLauncherRouterStore()

  store.getState().openCommand(EXTENSION_ADDRESS, {
    initialAction: "submit",
    launchProps: {
      arguments: {
        text: "Captured text"
      },
      launchContext: {
        defaults: {
          pageId: "page-1"
        }
      }
    },
    seedQuery: "docs"
  })
  const state = store.getState()

  assert.deepEqual(state.route, {
    ...EXTENSION_ADDRESS,
    initialAction: "submit",
    launchProps: {
      arguments: {
        text: "Captured text"
      },
      launchContext: {
        defaults: {
          pageId: "page-1"
        }
      }
    },
    seedQuery: "docs"
  })
  assert.equal(
    state.routeKey,
    'extension-command:test-extension:open-panel:submit:docs:{"arguments":{"text":"Captured text"},"launchContext":{"defaults":{"pageId":"page-1"}}}'
  )
})

test("closeActivePlugin returns to home and flips navigation direction backward", () => {
  const store = createLauncherRouterStore()

  store.getState().openCommand(BUILT_IN_ADDRESS, {
    initialAction: "submit",
    seedQuery: "hello"
  })
  store.getState().closeActivePlugin()
  const state = store.getState()

  assert.equal(state.navigationDirection, "backward")
  assert.deepEqual(state.route, { id: "home" })
  assert.equal(state.routeKey, "home")
})

test("subscribe only notifies when router state actually changes", () => {
  const store = createLauncherRouterStore()
  let callCount = 0
  const unsubscribe = store.subscribe(() => {
    callCount += 1
  })

  store.getState().closeActivePlugin()
  store.getState().openCommand(BUILT_IN_ADDRESS)
  store.getState().closeActivePlugin()
  unsubscribe()
  store.getState().openCommand(EXTENSION_ADDRESS)

  assert.equal(callCount, 3)
})
