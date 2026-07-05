import assert from "node:assert/strict"
import test from "node:test"
import type { ShortcutScope } from "../../src/shared/shortcuts/model"
import type { ResolvedShortcutBinding, ShortcutSettings } from "../../src/shared/shortcuts/settings"
import { createShortcutSystemStore } from "../../src/renderer/src/shortcuts/shortcut-system-store"

function createBindings(scope: ShortcutScope): ResolvedShortcutBinding[] {
  return [
    {
      chord: {
        key: "K",
        modifiers: ["meta"]
      },
      commandId: `command:${scope}`,
      scope,
      source: "default"
    }
  ]
}

function createSettings(label: string): ShortcutSettings {
  return {
    overrides: [
      {
        chord: {
          key: label,
          modifiers: ["meta"]
        },
        commandId: `override:${label}`
      }
    ]
  }
}

test("registerScopeLayer prepends custom scopes ahead of default window scopes", () => {
  const store = createShortcutSystemStore({
    bootstrapState: {
      bindings: createBindings("window"),
      settings: { overrides: [] }
    },
    loadResolvedBindings: async () => ({
      bindings: createBindings("launcher"),
      settings: { overrides: [] }
    }),
    resolveBindings: (settings) =>
      settings.overrides.length > 0 ? createBindings("launcher.ai") : createBindings("window"),
    windowKind: "launcher"
  })

  const cleanupSearch = store.registerScopeLayer(["launcher.home", "chat"])
  const cleanupList = store.registerScopeLayer(["launcher.list"])

  assert.deepEqual(store.getState().runtimeContext.activeScopes, [
    "launcher.list",
    "launcher.home",
    "chat",
    "launcher",
    "window"
  ])

  cleanupList()
  cleanupSearch()

  assert.deepEqual(store.getState().runtimeContext.activeScopes, ["launcher", "window"])
})

test("applySettings recomputes bindings and invalidates stale refreshes", async () => {
  let finishLoad!: (value: {
    bindings: ResolvedShortcutBinding[]
    settings: ShortcutSettings
  }) => void
  const store = createShortcutSystemStore({
    bootstrapState: {
      bindings: createBindings("window"),
      settings: { overrides: [] }
    },
    loadResolvedBindings: () =>
      new Promise((resolve) => {
        finishLoad = resolve
      }),
    resolveBindings: (settings) =>
      settings.overrides.length > 0 ? createBindings("settings") : createBindings("window"),
    windowKind: "settings"
  })

  const refreshPromise = store.refreshBindings()
  store.applySettings(createSettings("N"))
  finishLoad({
    bindings: createBindings("global"),
    settings: createSettings("Z")
  })
  await refreshPromise

  assert.deepEqual(store.getState().bindings, createBindings("settings"))
  assert.deepEqual(store.getState().settings, createSettings("N"))
})

test("setComposing and setTextInputFocus update runtime context and notify subscribers", () => {
  const store = createShortcutSystemStore({
    bootstrapState: {
      bindings: createBindings("window"),
      settings: { overrides: [] }
    },
    loadResolvedBindings: async () => ({
      bindings: createBindings("window"),
      settings: { overrides: [] }
    }),
    resolveBindings: () => createBindings("window"),
    windowKind: "main"
  })

  let notifications = 0
  const unsubscribe = store.subscribe(() => {
    notifications += 1
  })

  store.setComposing(true)
  store.setTextInputFocus(true)
  unsubscribe()
  store.setComposing(false)

  assert.equal(notifications, 2)
  assert.equal(store.getState().runtimeContext.isComposing, false)
  assert.equal(store.getState().runtimeContext.textInputFocus, true)
})

test("no-op runtime context writes do not notify subscribers", () => {
  const store = createShortcutSystemStore({
    bootstrapState: {
      bindings: createBindings("window"),
      settings: { overrides: [] }
    },
    loadResolvedBindings: async () => ({
      bindings: createBindings("window"),
      settings: { overrides: [] }
    }),
    resolveBindings: () => createBindings("window"),
    windowKind: "main"
  })

  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })

  store.setComposing(false)
  store.setTextInputFocus(false)

  assert.equal(notifications, 0)
})
