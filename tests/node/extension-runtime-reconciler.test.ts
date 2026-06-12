import assert from "node:assert/strict"
import test from "node:test"
import { createElement, useEffect, useRef, useState, type ReactElement } from "react"
import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Detail,
  Form,
  Icon,
  Image,
  Keyboard,
  List,
  confirmAlert,
  createNativeExtensionClient,
  defineNativeExtensionClientMethod,
  getPreferenceValues,
  open,
  openNativeCommandSettings,
  openNativeExtensionSettings,
  showToast,
  useNavigation,
  type LaunchProps,
  type RuntimeFormFieldProps
} from "@openwork/extension-api"
import {
  ExtensionRuntimeNavigationProvider,
  createExtensionRuntimeLaunchProps,
  createExtensionRuntimeNavigation,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeHostRequestInput,
  type ExtensionRuntimeSdkContextValue,
  type RuntimeSubmitFormValues
} from "@openwork/extension-api/host-runtime"
import { createExtensionRuntimeRenderer } from "../../src/extension-runtime/reconciler/render"
import {
  useCachedPromise,
  useFetch,
  useForm,
  useLocalStorage
} from "../../packages/extension-utils/src"
import type {
  ExtensionDetailSurfaceSnapshot,
  ExtensionFormSurfaceSnapshot,
  ExtensionHostRequest,
  ExtensionListSurfaceSnapshot
} from "../../src/shared/extension-runtime-protocol"
import type { PaginationLoader } from "../../packages/extension-utils/src"
import { resolveRuntimeVisualImageSource } from "../../src/renderer/src/extension-runtime/runtime-visual-assets"

type TestRendererParams = Parameters<typeof createExtensionRuntimeRenderer>[1]
type TestHostRequestHandler = ExtensionRuntimeSdkContextValue["requestHost"]
type _RuntimeFixtureListAccessory = List.Item.Accessory
type _RuntimeFixtureQuicklink = Action.CreateQuicklink.Props["quicklink"]
type _RuntimeFixtureLaunchProps = LaunchProps<{ text?: string }>
type _RuntimeFixtureFormValue = Form.Value
type _RuntimeFixtureFormValues = Form.Values
type _RuntimeFixtureFormDatePickerType = Form.DatePickerType
type _RuntimeFixtureFormItemProps = Form.ItemProps<string>

const runtimeFixtureTypeContract: {
  accessory: _RuntimeFixtureListAccessory
  datePickerType: _RuntimeFixtureFormDatePickerType
  formFieldProps: Pick<RuntimeFormFieldProps, "description" | "error" | "info" | "title">
  formItemProps: _RuntimeFixtureFormItemProps
  formValue: _RuntimeFixtureFormValue
  formValues: _RuntimeFixtureFormValues
  launchProps: _RuntimeFixtureLaunchProps
  quicklink: _RuntimeFixtureQuicklink
} = {
  accessory: {
    tag: {
      color: Color.Green,
      value: "Done"
    }
  },
  datePickerType: Form.DatePicker.Type.DateTime,
  formFieldProps: {
    title: "Title"
  },
  formItemProps: {
    id: "title",
    onChange: () => {},
    value: ""
  },
  formValue: "Untitled",
  formValues: {
    title: "Untitled"
  },
  launchProps: {
    arguments: {
      text: "Captured text"
    }
  },
  quicklink: {
    link: "https://www.notion.so",
    name: "Notion"
  }
}

void runtimeFixtureTypeContract

function createTestRenderer(params?: TestRendererParams) {
  return createExtensionRuntimeRenderer(
    {
      commandName: "counter",
      extensionName: "runtime-fixture"
    },
    params
  )
}

function assertListSnapshot(
  snapshot: ReturnType<ReturnType<typeof createTestRenderer>["getSnapshot"]>
): asserts snapshot is ExtensionListSurfaceSnapshot {
  assert.ok(snapshot)
  assert.equal(snapshot.kind, "list")
}

function assertDetailSnapshot(
  snapshot: ReturnType<ReturnType<typeof createTestRenderer>["getSnapshot"]>
): asserts snapshot is ExtensionDetailSurfaceSnapshot {
  assert.ok(snapshot)
  assert.equal(snapshot.kind, "detail")
}

function assertFormSnapshot(
  snapshot: ReturnType<ReturnType<typeof createTestRenderer>["getSnapshot"]>
): asserts snapshot is ExtensionFormSurfaceSnapshot {
  assert.ok(snapshot)
  assert.equal(snapshot.kind, "form")
}

function runWithTestRuntimePreferences<T>(
  extensionPreferences: Record<string, unknown>,
  commandPreferences: Record<string, unknown>,
  callback: () => T
): Promise<T> {
  return runWithExtensionRuntimeSdk(
    {
      commandName: "counter",
      commandPreferences,
      extensionName: "runtime-fixture",
      extensionPreferences,
      initialAction: "open",
      locale: "zh-CN",
      mode: "view",
      navigation: createExtensionRuntimeNavigation({
        requestHost: async () => ({
          id: "host-response",
          ok: true as const,
          result: null
        })
      }),
      requestHost: async () => ({
        id: "host-response",
        ok: true as const,
        result: null
      }),
      seedQuery: ""
    },
    callback
  )
}

function withRuntimeProvider(
  element: ReactElement,
  requestHost: TestHostRequestHandler = async () => ({
    id: "host-response",
    ok: true as const,
    result: null
  })
): ReactElement {
  return createElement(
    ExtensionRuntimeNavigationProvider,
    {
      value: {
        commandName: "counter",
        commandPreferences: {},
        extensionName: "runtime-fixture",
        extensionPreferences: {},
        initialAction: "open",
        locale: "zh-CN",
        mode: "view",
        requestHost,
        seedQuery: ""
      }
    },
    element
  )
}

test("runtime reconciler snapshots a list and applies action state updates", async () => {
  function CounterList() {
    const [count, setCount] = useState(0)

    return createElement(
      List,
      {
        navigationTitle: "Counter"
      },
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () => setCount((current) => current + 1),
            title: "Increment"
          })
        ),
        id: "counter",
        title: `Count ${count}`
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(CounterList))
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertListSnapshot(firstSnapshot)
  assert.equal(firstSnapshot.navigationTitle, "Counter")
  assert.equal(firstSnapshot.sections[0]?.items[0]?.title, "Count 0")

  const actionId = firstSnapshot.sections[0]?.items[0]?.actions[0]?.id
  assert.ok(actionId)
  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      revision: firstSnapshot.revision,
      type: "action.execute"
    }),
    true
  )

  const nextSnapshot = renderer.getSnapshot()
  assertListSnapshot(nextSnapshot)
  assert.equal(nextSnapshot.sections[0]?.items[0]?.title, "Count 1")
})

test("runtime reconciler waits for asynchronous action handlers", async () => {
  const events: string[] = []

  function AsyncActionList() {
    return createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: async () => {
              events.push("start")
              await Promise.resolve()
              events.push("after-await")
            },
            title: "Run Async"
          })
        ),
        id: "async",
        title: "Async"
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(AsyncActionList))
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const actionId = snapshot.sections[0]?.items[0]?.actions[0]?.id
  assert.ok(actionId)

  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )
  assert.deepEqual(events, ["start", "after-await"])
})

test("runtime reconciler executes registered toast actions", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const renderer = createTestRenderer()

  function ToastActionList() {
    const [opened, setOpened] = useState(false)

    return createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () =>
              showToast({
                primaryAction: {
                  onAction: () => setOpened(true),
                  shortcut: Keyboard.Shortcut.Common.New,
                  title: "Open Page"
                },
                style: "success",
                title: "Page created"
              }),
            title: "Create Page"
          })
        ),
        id: "page",
        title: opened ? "Opened" : "Ready"
      })
    )
  }

  renderer.render(
    createElement(
      ExtensionRuntimeNavigationProvider,
      {
        value: {
          commandName: "counter",
          commandPreferences: {},
          extensionName: "runtime-fixture",
          extensionPreferences: {},
          initialAction: "open",
          locale: "zh-CN",
          mode: "view",
          registerToastAction: renderer.registerToastAction,
          requestHost: async (request) => {
            requests.push(request)
            return {
              id: "host-response",
              ok: true,
              result: null
            }
          },
          seedQuery: ""
        }
      },
      createElement(ToastActionList)
    )
  )
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertListSnapshot(firstSnapshot)
  const createActionId = firstSnapshot.sections[0]?.items[0]?.actions[0]?.id
  assert.ok(createActionId)
  assert.equal(
    await renderer.dispatchEvent({
      actionId: createActionId,
      revision: firstSnapshot.revision,
      type: "action.execute"
    }),
    true
  )

  const toastRequest = requests.find((request) => request.capability === "toast")
  assert.ok(toastRequest)
  assert.equal(toastRequest.capability, "toast")
  assert.equal(toastRequest.payload.primaryAction?.id, "toast-action-0")
  assert.deepEqual(toastRequest.payload.primaryAction?.shortcut, {
    key: "n",
    modifiers: ["cmd"]
  })
  assert.equal(
    await renderer.dispatchEvent({
      actionId: "toast-action-0",
      type: "toast.action.execute"
    }),
    true
  )

  const nextSnapshot = renderer.getSnapshot()
  assertListSnapshot(nextSnapshot)
  assert.equal(nextSnapshot.sections[0]?.items[0]?.title, "Opened")
})

test("runtime SDK client is available to first passive effects", async () => {
  const client = createNativeExtensionClient("runtime-fixture", ["ping"], {
    ping: defineNativeExtensionClientMethod<Record<string, never>, string>()
  })
  const calls: string[] = []
  const errors: string[] = []
  const renderer = createTestRenderer()

  function EffectClientList() {
    useEffect(() => {
      void client
        .ping({})
        .then((result) => {
          calls.push(result)
        })
        .catch((error) => {
          errors.push(error instanceof Error ? error.message : String(error))
        })
    }, [])

    return createElement(
      List,
      null,
      createElement(List.Item, {
        id: "ready",
        title: "Ready"
      })
    )
  }

  renderer.render(
    createElement(
      ExtensionRuntimeNavigationProvider,
      {
        value: {
          commandName: "counter",
          commandPreferences: {},
          extensionName: "runtime-fixture",
          extensionPreferences: {},
          initialAction: "open",
          locale: "zh-CN",
          mode: "view",
          requestHost: async () => ({
            id: "effect-response",
            ok: true as const,
            result: "pong"
          }),
          seedQuery: ""
        }
      },
      createElement(EffectClientList)
    )
  )
  await renderer.flushSnapshots()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(calls, ["pong"])
  assert.deepEqual(errors, [])
})

test("runtime SDK exposes merged command preference values", async () => {
  const observedPreferences: Array<Record<string, unknown>> = []

  function PreferenceList() {
    observedPreferences.push(getPreferenceValues<Record<string, unknown>>())

    return createElement(
      List,
      null,
      createElement(List.Item, {
        id: "ready",
        title: "Ready"
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      ExtensionRuntimeNavigationProvider,
      {
        value: {
          commandName: "counter",
          commandPreferences: {
            open_in: "browser",
            primaryAction: "open"
          },
          extensionName: "runtime-fixture",
          extensionPreferences: {
            workspace_id: "workspace-1",
            open_in: "notion"
          },
          initialAction: "open",
          locale: "zh-CN",
          mode: "view",
          requestHost: async () => ({
            id: "host-response",
            ok: true as const,
            result: null
          }),
          seedQuery: ""
        }
      },
      createElement(PreferenceList)
    )
  )
  await renderer.flushSnapshots()

  assert.deepEqual(observedPreferences[0], {
    open_in: "browser",
    primaryAction: "open",
    workspace_id: "workspace-1"
  })
})

test("runtime SDK preference object reads the active context lazily", async () => {
  const preferences = getPreferenceValues<Record<string, unknown>>()

  const firstValue = await runWithTestRuntimePreferences(
    {
      open_in: "notion"
    },
    {
      primaryAction: "open"
    },
    () => preferences.open_in
  )
  const secondValue = await runWithTestRuntimePreferences(
    {
      open_in: "browser"
    },
    {
      primaryAction: "preview"
    },
    () => preferences.open_in
  )
  const secondKeys = await runWithTestRuntimePreferences(
    {
      open_in: "browser"
    },
    {
      primaryAction: "preview"
    },
    () => Object.keys(preferences)
  )

  assert.equal(firstValue, "notion")
  assert.equal(secondValue, "browser")
  assert.deepEqual(secondKeys, ["open_in", "primaryAction"])
})

test("runtime SDK creates launch props", () => {
  const launchProps = createExtensionRuntimeLaunchProps({
    launchProps: {
      arguments: {
        text: "Captured text"
      },
      draftValues: {
        page: "page-1"
      },
      fallbackText: "Fallback",
      launchContext: {
        defaults: {
          captureAs: "url"
        }
      }
    }
  })

  assert.deepEqual(launchProps, {
    arguments: {
      text: "Captured text"
    },
    draftValues: {
      page: "page-1"
    },
    fallbackText: "Fallback",
    launchContext: {
      defaults: {
        captureAs: "url"
      }
    }
  })
})

test("runtime command component can render with launch props", async () => {
  function LaunchPropsDetail(props: LaunchProps<{ arguments: { text?: string } }>) {
    return createElement(Detail, {
      markdown: props.arguments.text ?? "missing"
    })
  }

  const renderer = createTestRenderer()
  renderer.render(
    withRuntimeProvider(
      createElement(
        LaunchPropsDetail,
        createExtensionRuntimeLaunchProps({
          launchProps: {
            arguments: {
              text: "Captured text"
            }
          }
        }) as LaunchProps<{ arguments: { text?: string } }>
      )
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertDetailSnapshot(snapshot)
  assert.equal(snapshot.markdown, "Captured text")
})

test("runtime SDK open delegates URL targets to shell host capability", async () => {
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []

  function OpenList() {
    return createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () =>
              open("notion://www.notion.so/page-1", {
                bundleId: "notion.id",
                name: "Notion"
              }),
            title: "Open in App"
          })
        ),
        id: "page",
        title: "Page"
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(
    withRuntimeProvider(createElement(OpenList), async (request) => {
      hostRequests.push(request)
      return {
        id: "host-response",
        ok: true as const,
        result: null
      }
    })
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const action = snapshot.sections[0]?.items[0]?.actions[0]
  assert.ok(action)

  assert.equal(
    await renderer.dispatchEvent({
      actionId: action.id,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )

  assert.deepEqual(hostRequests, [
    {
      capability: "shell",
      method: "open-external",
      payload: {
        allowedUrlSchemes: ["notion"],
        application: {
          bundleId: "notion.id",
          name: "Notion"
        },
        url: "notion://www.notion.so/page-1"
      }
    }
  ])
})

test("runtime actions preserve keyboard shortcuts", async () => {
  function ShortcutList() {
    return createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(
            ActionPanel.Submenu,
            {
              shortcut: {
                macOS: { key: "p", modifiers: ["cmd", "shift"] },
                Windows: { key: "p", modifiers: ["ctrl", "shift"] }
              },
              title: "Edit Property"
            },
            createElement(Action, {
              onAction: () => {},
              shortcut: Keyboard.Shortcut.Common.New,
              title: "Create New Page"
            })
          )
        ),
        id: "page",
        title: "Page"
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(ShortcutList))
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  assert.deepEqual(snapshot.sections[0]?.items[0]?.actions[0]?.shortcut, {
    key: "p",
    modifiers: ["cmd", "shift"]
  })
  assert.deepEqual(snapshot.sections[0]?.items[0]?.actions[0]?.children?.[0]?.shortcut, {
    key: "n",
    modifiers: ["cmd"]
  })
})

test("runtime reconciler preserves action panel submenu hierarchy", async () => {
  let selected = ""

  function SubmenuList() {
    return createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () => {
              selected = "open"
            },
            title: "Open"
          }),
          createElement(
            ActionPanel.Section,
            {
              title: "Properties"
            },
            createElement(
              ActionPanel.Submenu,
              {
                title: "Set Status"
              },
              createElement(Action, {
                onAction: () => {
                  selected = "done"
                },
                title: "Done"
              })
            )
          )
        ),
        id: "page",
        title: "Page"
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(SubmenuList))
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const actions = snapshot.sections[0]?.items[0]?.actions ?? []
  assert.equal(actions[0]?.title, "Open")
  assert.equal(actions[1]?.title, "Set Status")
  assert.equal(actions[1]?.sectionTitle, "Properties")
  assert.deepEqual(
    actions[1]?.children?.map((action) => action.title),
    ["Done"]
  )

  const doneAction = actions[1]?.children?.[0]
  assert.ok(doneAction)
  assert.equal(
    await renderer.dispatchEvent({
      actionId: doneAction.id,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )
  assert.equal(selected, "done")
})

test("runtime reconciler batches multiple state updates into one snapshot", async () => {
  function BatchedCounterList() {
    const [count, setCount] = useState(0)

    return createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () => {
              setCount(1)
              setCount(2)
              setCount(3)
            },
            title: "Set Count"
          })
        ),
        id: "counter",
        title: `Count ${count}`
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(BatchedCounterList))
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertListSnapshot(firstSnapshot)
  const actionId = firstSnapshot.sections[0]?.items[0]?.actions[0]?.id
  assert.ok(actionId)

  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      revision: firstSnapshot.revision,
      type: "action.execute"
    }),
    true
  )

  const snapshots = renderer.getSnapshots()
  const nextSnapshot = renderer.getSnapshot()
  assertListSnapshot(nextSnapshot)
  assert.equal(snapshots.length, 2)
  assert.equal(nextSnapshot.sections[0]?.items[0]?.title, "Count 3")
})

test("runtime reconciler keeps action ids unique across list and item actions", async () => {
  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      List,
      {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () => {},
            title: "Refresh"
          })
        )
      },
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () => {},
            title: "Open"
          })
        ),
        id: "item",
        title: "Item"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const actionIds = [
    snapshot.actions[0]?.id,
    snapshot.sections[0]?.items[0]?.actions[0]?.id
  ].filter((id): id is string => Boolean(id))

  assert.deepEqual(actionIds, ["action-0", "action-1"])
  assert.equal(new Set(actionIds).size, actionIds.length)
})

test("runtime reconciler serializes JSX icon visuals", async () => {
  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      List,
      null,
      createElement(List.Item, {
        accessories: createElement("span", null, "Pinned"),
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            icon: createElement(
              "svg",
              {
                className: "action-icon",
                viewBox: "0 0 24 24"
              },
              createElement("path", {
                d: "M12 5v14",
                stroke: "currentColor",
                strokeWidth: 2
              })
            ),
            onAction: () => {},
            title: "Create"
          })
        ),
        icon: createElement(
          "svg",
          {
            className: "item-icon",
            viewBox: "0 0 24 24"
          },
          createElement("circle", {
            cx: 12,
            cy: 12,
            r: 8
          })
        ),
        id: "with-icon",
        title: "With Icon"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const item = snapshot.sections[0]?.items[0]
  assert.equal(item?.icon?.kind, "svg")
  assert.equal(item.icon.tagName, "svg")
  assert.equal(item.icon.props.className, "item-icon")
  assert.equal(item.icon.children[0]?.tagName, "circle")
  assert.equal(item.accessories[0]?.kind, "text")
  assert.equal(item.accessories[0]?.text, "Pinned")
  const actionIcon = item.actions[0]?.icon
  assert.equal(actionIcon?.kind, "svg")
  assert.equal(actionIcon.props.className, "action-icon")
  assert.equal(actionIcon.children[0]?.tagName, "path")
})

test("runtime reconciler serializes extension API icon and image-like visuals", async () => {
  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      List,
      null,
      createElement(List.Item, {
        accessories: [
          {
            icon: {
              mask: Image.Mask.Circle,
              source: "https://example.com/avatar.png"
            },
            text: "Edited"
          },
          {
            icon: "./icon/view_list.png",
            text: "List"
          },
          {
            tag: {
              color: Color.Green,
              value: "Done"
            }
          }
        ],
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            icon: {
              source: Icon.Trash,
              tintColor: Color.Red
            },
            onAction: () => {},
            title: "Delete"
          })
        ),
        icon: {
          tooltip: "Notion page",
          value: Icon.BlankDocument
        },
        id: "image-like",
        title: "Image-like Visuals"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const item = snapshot.sections[0]?.items[0]
  assert.equal(item?.icon?.kind, "svg")
  assert.equal(item.icon.children[0]?.tagName, "path")
  assert.equal(item.accessories[0]?.kind, "inline")
  assert.equal(item.accessories[1]?.kind, "inline")
  assert.equal(item.accessories[2]?.kind, "text")
  assert.equal(item.accessories[2]?.text, "Done")
  const actionIcon = item.actions[0]?.icon
  assert.ok(actionIcon)
  assert.notEqual(actionIcon.kind, "text")
})

test("runtime reconciler preserves JSX accessory arrays separately from plain accessory arrays", async () => {
  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      List,
      null,
      createElement(List.Item, {
        accessories: [
          createElement("span", { key: "one" }, "First"),
          createElement("span", { key: "two" }, "Second")
        ],
        icon: "notion-logo.png",
        id: "jsx-accessories",
        title: "JSX Accessories"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const item = snapshot.sections[0]?.items[0]
  assert.equal(item?.icon?.kind, "image")
  assert.equal(item.icon.source, "notion-logo.png")
  assert.equal(
    resolveRuntimeVisualImageSource({
      extensionName: snapshot.extensionName,
      source: item.icon.source
    }),
    "openwork-extension-asset://runtime-fixture/assets/notion-logo.png"
  )
  assert.equal(
    resolveRuntimeVisualImageSource({
      extensionName: snapshot.extensionName,
      source: "./icon/view_list.png"
    }),
    "openwork-extension-asset://runtime-fixture/assets/icon/view_list.png"
  )
  assert.equal(
    resolveRuntimeVisualImageSource({
      extensionName: snapshot.extensionName,
      source: "assets/icon/view_list.png"
    }),
    "openwork-extension-asset://runtime-fixture/assets/icon/view_list.png"
  )
  assert.equal(
    resolveRuntimeVisualImageSource({
      extensionName: snapshot.extensionName,
      source: "https://example.com/avatar.png"
    }),
    "https://example.com/avatar.png"
  )
  assert.equal(item.accessories.length, 2)
  assert.equal(item.accessories[0]?.kind, "text")
  assert.equal(item.accessories[0]?.text, "First")
  assert.equal(item.accessories[1]?.kind, "text")
  assert.equal(item.accessories[1]?.text, "Second")
})

test("runtime reconciler dispatches OpenInBrowser actions through host requests", async () => {
  const hostRequests: ExtensionHostRequest[] = []
  const renderer = createTestRenderer({
    onHostRequest: (request) => {
      hostRequests.push(request)
      return {
        id: request.id,
        ok: true,
        result: null
      }
    }
  })

  renderer.render(
    createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action.OpenInBrowser, {
            title: "Open Link in Browser",
            url: "https://example.com/item"
          })
        ),
        id: "item",
        title: "Item"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const action = snapshot.sections[0]?.items[0]?.actions[0]
  assert.ok(action)
  assert.equal(action.title, "Open Link in Browser")

  assert.equal(
    await renderer.dispatchEvent({
      actionId: action.id,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )

  assert.deepEqual(hostRequests, [
    {
      capability: "shell",
      id: "host-request-0",
      method: "open-external",
      payload: {
        url: "https://example.com/item"
      }
    }
  ])
})

test("runtime reconciler dispatches CopyToClipboard actions through host requests", async () => {
  const hostRequests: ExtensionHostRequest[] = []
  const renderer = createTestRenderer({
    onHostRequest: (request) => {
      hostRequests.push(request)
      return {
        id: request.id,
        ok: true,
        result: null
      }
    }
  })

  renderer.render(
    createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action.CopyToClipboard, {
            content: "Runtime clipboard text",
            title: "Copy Text"
          })
        ),
        id: "item",
        title: "Item"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const action = snapshot.sections[0]?.items[0]?.actions[0]
  assert.ok(action)
  assert.equal(action.title, "Copy Text")

  assert.equal(
    await renderer.dispatchEvent({
      actionId: action.id,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )

  assert.deepEqual(hostRequests, [
    {
      capability: "clipboard",
      id: "host-request-0",
      method: "write-text",
      payload: {
        text: "Runtime clipboard text"
      }
    }
  ])
})

test("runtime reconciler preserves formatted CopyToClipboard content", async () => {
  const hostRequests: ExtensionHostRequest[] = []
  const renderer = createTestRenderer({
    onHostRequest: (request) => {
      hostRequests.push(request)
      return {
        id: request.id,
        ok: true,
        result: null
      }
    }
  })

  renderer.render(
    createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action.CopyToClipboard, {
            content: {
              html: '<a href="https://www.notion.so/page">Runtime Notes</a>',
              text: "Runtime Notes"
            },
            title: "Copy Formatted URL"
          })
        ),
        id: "item",
        title: "Item"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const action = snapshot.sections[0]?.items[0]?.actions[0]
  assert.ok(action)

  assert.equal(
    await renderer.dispatchEvent({
      actionId: action.id,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )

  assert.deepEqual(hostRequests, [
    {
      capability: "clipboard",
      id: "host-request-0",
      method: "write-text",
      payload: {
        html: '<a href="https://www.notion.so/page">Runtime Notes</a>',
        text: "Runtime Notes"
      }
    }
  ])
})

test("runtime Action.CreateQuicklink registers a launcher quicklink", async () => {
  const hostRequests: ExtensionHostRequest[] = []
  const renderer = createTestRenderer({
    onHostRequest: (request) => {
      hostRequests.push(request)
      return {
        id: request.id,
        ok: true,
        result: null
      }
    }
  })

  renderer.render(
    createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action.CreateQuicklink, {
            quicklink: {
              link: "openwork://extensions/notion/create-database-page",
              name: "Create Notion page"
            },
            shortcut: {
              macOS: { key: "l", modifiers: ["cmd"] },
              Windows: { key: "l", modifiers: ["ctrl"] }
            }
          })
        ),
        id: "item",
        title: "Item"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const action = snapshot.sections[0]?.items[0]?.actions[0]
  assert.ok(action)
  assert.equal(action.title, "Create Quicklink")
  assert.deepEqual(action.shortcut, {
    key: "l",
    modifiers: ["cmd"]
  })

  assert.equal(
    await renderer.dispatchEvent({
      actionId: action.id,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )

  assert.deepEqual(hostRequests, [
    {
      capability: "quicklinks",
      id: "host-request-0",
      method: "register",
      payload: {
        extensionName: "runtime-fixture",
        link: "openwork://extensions/notion/create-database-page",
        name: "Create Notion page",
        shortcut: {
          key: "l",
          modifiers: ["cmd"],
          platform: "macOS"
        }
      }
    }
  ])
})

test("runtime reconciler dispatches Paste actions through host requests", async () => {
  const hostRequests: ExtensionHostRequest[] = []
  const renderer = createTestRenderer({
    onHostRequest: async (request) => {
      hostRequests.push(request)
      return {
        id: request.id,
        ok: true,
        result: null
      }
    }
  })

  renderer.render(
    createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action.Paste, {
            content: "https://www.notion.so/page-1",
            shortcut: Keyboard.Shortcut.Common.CopyPath,
            title: "Paste Page URL"
          })
        ),
        id: "item",
        title: "Item"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const action = snapshot.sections[0]?.items[0]?.actions[0]
  assert.ok(action)
  assert.equal(action.title, "Paste Page URL")
  assert.deepEqual(action.shortcut, {
    key: "c",
    modifiers: ["cmd", "opt"]
  })

  assert.equal(
    await renderer.dispatchEvent({
      actionId: action.id,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )

  assert.deepEqual(hostRequests, [
    {
      capability: "clipboard",
      id: "host-request-0",
      method: "paste-text",
      payload: {
        text: "https://www.notion.so/page-1"
      }
    }
  ])
})

test("runtime SDK confirmAlert delegates confirmation to dialog host capability", async () => {
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const results: boolean[] = []

  function ConfirmList() {
    return createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: async () => {
              results.push(
                await confirmAlert({
                  dismissAction: {
                    style: Alert.ActionStyle.Cancel,
                    title: "Cancel"
                  },
                  message: "This page can be restored from Notion trash.",
                  primaryAction: {
                    style: Alert.ActionStyle.Destructive,
                    title: "Delete Page"
                  },
                  title: "Delete Page"
                })
              )
            },
            style: Action.Style.Destructive,
            title: "Delete Page"
          })
        ),
        id: "page",
        title: "Page"
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(
    withRuntimeProvider(createElement(ConfirmList), async (request) => {
      hostRequests.push(request)
      return {
        id: "host-response",
        ok: true as const,
        result: true
      }
    })
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const action = snapshot.sections[0]?.items[0]?.actions[0]
  assert.ok(action)

  assert.equal(
    await renderer.dispatchEvent({
      actionId: action.id,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )

  assert.deepEqual(results, [true])
  assert.deepEqual(hostRequests, [
    {
      capability: "dialog",
      method: "confirm-alert",
      payload: {
        dismissAction: {
          style: "cancel",
          title: "Cancel"
        },
        message: "This page can be restored from Notion trash.",
        primaryAction: {
          style: "destructive",
          title: "Delete Page"
        },
        title: "Delete Page"
      }
    }
  ])
})

test("runtime reconciler dispatches list query changes to List handlers", async () => {
  function SearchList() {
    const [query, setQuery] = useState("")

    return createElement(
      List,
      {
        onSearchTextChange: setQuery,
        searchText: query
      },
      createElement(List.Item, {
        id: "query",
        title: `Query: ${query}`
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(SearchList))
  await renderer.flushSnapshots()

  assert.equal(
    await renderer.dispatchEvent({
      query: "ship runtime",
      type: "list.query.change"
    }),
    true
  )

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  assert.equal(snapshot.searchText, "ship runtime")
  assert.equal(snapshot.sections[0]?.items[0]?.title, "Query: ship runtime")
})

test("runtime reconciler treats object filtering config as remote filtering", async () => {
  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      List,
      {
        filtering: {
          keepSectionOrder: true
        }
      },
      createElement(List.Item, {
        id: "page",
        title: "Runtime Notes"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  assert.equal(snapshot.filtering, false)
})

test("runtime reconciler preserves List throttle in snapshots", async () => {
  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      List,
      {
        throttle: true
      },
      createElement(List.Item, {
        id: "page",
        title: "Runtime Notes"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  assert.equal(snapshot.throttle, true)
})

test("runtime reconciler dispatches form dropdown search changes", async () => {
  let submittedValues: RuntimeSubmitFormValues | null = null

  function SearchableForm() {
    const [query, setQuery] = useState("")
    const [selectedValue, setSelectedValue] = useState("initial")

    return createElement(
      Form,
      {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action.SubmitForm, {
            onSubmit: (values) => {
              submittedValues = values
            },
            title: "Submit"
          })
        )
      },
      createElement(
        Form.Dropdown,
        {
          id: "page",
          isLoading: query === "runtime",
          onChange: setSelectedValue,
          onSearchTextChange: setQuery,
          title: "Page",
          value: selectedValue
        },
        query
          ? createElement(Form.Dropdown.Item, {
              title: `Query: ${query}`,
              value: query
            })
          : createElement(Form.Dropdown.Item, {
              title: "Initial Page",
              value: "initial"
            })
      )
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(SearchableForm))
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertFormSnapshot(firstSnapshot)
  const firstField = firstSnapshot.fields[0]
  assert.equal(firstField?.kind, "dropdown")
  assert.equal(firstField?.kind === "dropdown" ? firstField.searchable : undefined, true)
  assert.equal(firstField?.kind === "dropdown" ? firstField.isLoading : undefined, false)
  assert.equal(firstField?.kind === "dropdown" ? firstField.value : undefined, "initial")
  assert.deepEqual(
    firstField?.kind === "dropdown"
      ? firstField.items.map((item) => ({ title: item.title, value: item.value }))
      : [],
    [
      {
        title: "Initial Page",
        value: "initial"
      }
    ]
  )

  assert.equal(
    await renderer.dispatchEvent({
      fieldId: firstField?.id ?? "",
      query: "runtime",
      type: "form.dropdown.search"
    }),
    true
  )

  const nextSnapshot = renderer.getSnapshot()
  assertFormSnapshot(nextSnapshot)
  const nextField = nextSnapshot.fields[0]
  assert.equal(nextField?.kind, "dropdown")
  assert.equal(nextField?.kind === "dropdown" ? nextField.isLoading : undefined, true)
  assert.equal(nextField?.kind === "dropdown" ? nextField.value : undefined, "initial")
  assert.deepEqual(
    nextField?.kind === "dropdown"
      ? nextField.items.map((item) => ({ title: item.title, value: item.value }))
      : [],
    [
      {
        title: "Query: runtime",
        value: "runtime"
      }
    ]
  )

  assert.equal(
    await renderer.dispatchEvent({
      changeId: "select-runtime",
      fieldId: "page",
      type: "form.field.change",
      value: "runtime"
    }),
    true
  )

  const selectedSnapshot = renderer.getSnapshot()
  assertFormSnapshot(selectedSnapshot)
  const selectedField = selectedSnapshot.fields[0]
  assert.equal(selectedField?.kind === "dropdown" ? selectedField.value : undefined, "runtime")

  const actionId = selectedSnapshot.actions[0]?.id
  assert.ok(actionId)
  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      revision: selectedSnapshot.revision,
      type: "action.execute"
    }),
    true
  )
  assert.deepEqual(submittedValues, {
    page: "runtime"
  })
})

test("runtime reconciler snapshots detail surfaces and navigates back", async () => {
  function DetailFlow() {
    const navigation = useNavigation()

    return createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () => {
              navigation.push(
                createElement(Detail, {
                  markdown: "# Detail",
                  metadata: createElement(
                    Detail.Metadata,
                    null,
                    createElement(Detail.Metadata.Label, {
                      icon: Icon.List,
                      text: "Inbox",
                      title: "List"
                    })
                  ),
                  navigationTitle: "Reminder"
                })
              )
            },
            title: "Open Detail"
          })
        ),
        id: "item",
        title: "Item"
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(withRuntimeProvider(createElement(DetailFlow)))
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertListSnapshot(firstSnapshot)
  const actionId = firstSnapshot.sections[0]?.items[0]?.actions[0]?.id
  assert.ok(actionId)

  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      revision: firstSnapshot.revision,
      type: "action.execute"
    }),
    true
  )

  const detailSnapshot = renderer.getSnapshot()
  assertDetailSnapshot(detailSnapshot)
  assert.equal(detailSnapshot.canPop, true)
  assert.equal(detailSnapshot.navigationTitle, "Reminder")
  assert.equal(detailSnapshot.metadata[0]?.title, "List")
  assert.equal(detailSnapshot.metadata[0]?.text, "Inbox")
  assert.equal(detailSnapshot.metadata[0]?.icon?.kind, "svg")

  assert.equal(
    await renderer.dispatchEvent({
      type: "navigation.pop"
    }),
    true
  )

  const nextSnapshot = renderer.getSnapshot()
  assertListSnapshot(nextSnapshot)
})

test("runtime reconciler serializes Detail metadata tag list items", async () => {
  const renderer = createTestRenderer()
  renderer.render(
    createElement(Detail, {
      markdown: "# Metadata",
      metadata: createElement(
        Detail.Metadata,
        null,
        createElement(
          Detail.Metadata.TagList,
          {
            title: "Tags"
          },
          createElement(Detail.Metadata.TagList.Item, {
            color: Color.Blue,
            text: "Migration"
          }),
          createElement(Detail.Metadata.TagList.Item, {
            icon: Icon.Person,
            text: "Alex Chen"
          })
        )
      )
    })
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertDetailSnapshot(snapshot)
  assert.deepEqual(snapshot.metadata, [
    {
      text: "Migration, Alex Chen",
      title: "Tags"
    }
  ])
})

test("runtime reconciler preserves Detail metadata link targets", async () => {
  const renderer = createTestRenderer()
  renderer.render(
    createElement(Detail, {
      markdown: "# Metadata",
      metadata: createElement(
        Detail.Metadata,
        null,
        createElement(Detail.Metadata.Link, {
          target: "https://www.notion.so/page-1",
          text: "Project Page",
          title: "URL"
        }),
        createElement(Detail.Metadata.Link, {
          target: "mailto:user@example.com",
          text: "user@example.com",
          title: "Email"
        }),
        createElement(Detail.Metadata.Link, {
          target: "tel:+15551234567",
          text: "+15551234567",
          title: "Phone"
        })
      )
    })
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertDetailSnapshot(snapshot)
  assert.deepEqual(snapshot.metadata, [
    {
      target: "https://www.notion.so/page-1",
      text: "Project Page",
      title: "URL"
    },
    {
      target: "mailto:user@example.com",
      text: "user@example.com",
      title: "Email"
    },
    {
      target: "tel:+15551234567",
      text: "+15551234567",
      title: "Phone"
    }
  ])
})

test("runtime Action.Push opens a detail surface through the navigation stack", async () => {
  function PushFlow() {
    return createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action.Push, {
            target: createElement(Detail, {
              markdown: "# Action Push",
              navigationTitle: "Pushed Detail"
            }),
            title: "Push Detail"
          })
        ),
        id: "item",
        title: "Item"
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(withRuntimeProvider(createElement(PushFlow)))
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertListSnapshot(firstSnapshot)
  const actionId = firstSnapshot.sections[0]?.items[0]?.actions[0]?.id
  assert.ok(actionId)

  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      revision: firstSnapshot.revision,
      type: "action.execute"
    }),
    true
  )

  const detailSnapshot = renderer.getSnapshot()
  assertDetailSnapshot(detailSnapshot)
  assert.equal(detailSnapshot.canPop, true)
  assert.equal(detailSnapshot.navigationTitle, "Pushed Detail")
  assert.equal(detailSnapshot.markdown, "# Action Push")
})

test("runtime reconciler snapshots form fields and syncs local input", async () => {
  function FormFlow() {
    const [title, setTitle] = useState("Buy milk")
    const [completed, setCompleted] = useState(false)
    const [dueDate, setDueDate] = useState("2026-05-26")
    const [tags, setTags] = useState<string[]>(["Work"])

    return createElement(
      Form,
      {
        isLoading: true,
        navigationTitle: "Create Reminder"
      },
      createElement(Form.TextField, {
        autoFocus: true,
        info: "Supports inline Markdown",
        onChange: setTitle,
        placeholder: "Reminder title",
        storeValue: true,
        title: "Title",
        value: title
      }),
      createElement(Form.Checkbox, {
        label: "Done",
        onChange: setCompleted,
        title: "Completed",
        value: completed
      }),
      createElement(Form.DatePicker, {
        onChange: setDueDate,
        storeValue: true,
        title: "Due",
        value: dueDate
      }),
      createElement(
        Form.TagPicker,
        {
          autoFocus: false,
          onChange: setTags,
          storeValue: true,
          title: "Tags",
          value: tags
        },
        createElement(Form.TagPicker.Item, {
          icon: Icon.Checkmark,
          title: "Work",
          value: "Work"
        }),
        createElement(Form.TagPicker.Item, {
          title: "Personal",
          value: "Personal"
        })
      )
    )
  }

  const renderer = createTestRenderer()
  renderer.render(withRuntimeProvider(createElement(FormFlow)))
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertFormSnapshot(firstSnapshot)
  assert.equal(firstSnapshot.navigationTitle, "Create Reminder")
  assert.equal(firstSnapshot.isLoading, true)
  const textField = firstSnapshot.fields.find(
    (
      field
    ): field is Extract<ExtensionFormSurfaceSnapshot["fields"][number], { kind: "text-field" }> =>
      field.kind === "text-field"
  )
  assert.ok(textField)
  assert.equal(textField.autoFocus, true)
  assert.equal(textField.value, "Buy milk")
  assert.equal(textField.info, "Supports inline Markdown")

  assert.equal(
    await renderer.dispatchEvent({
      changeId: "change-1",
      fieldId: firstSnapshot.fields[0]?.id ?? "",
      type: "form.field.change",
      value: "Walk the dog"
    }),
    true
  )

  const nextSnapshot = renderer.getSnapshot()
  assertFormSnapshot(nextSnapshot)
  const nextTextField = nextSnapshot.fields.find(
    (
      field
    ): field is Extract<ExtensionFormSurfaceSnapshot["fields"][number], { kind: "text-field" }> =>
      field.kind === "text-field"
  )
  assert.ok(nextTextField)
  assert.equal(nextTextField.value, "Walk the dog")

  assert.equal(
    await renderer.dispatchEvent({
      changeId: "change-2",
      fieldId: nextSnapshot.fields[1]?.id ?? "",
      type: "form.field.change",
      value: true
    }),
    true
  )

  const finalSnapshot = renderer.getSnapshot()
  assertFormSnapshot(finalSnapshot)
  const checkboxField = finalSnapshot.fields.find(
    (
      field
    ): field is Extract<ExtensionFormSurfaceSnapshot["fields"][number], { kind: "checkbox" }> =>
      field.kind === "checkbox"
  )
  assert.ok(checkboxField)
  assert.equal(checkboxField.value, true)

  const dateField = finalSnapshot.fields.find(
    (
      field
    ): field is Extract<ExtensionFormSurfaceSnapshot["fields"][number], { kind: "date-picker" }> =>
      field.kind === "date-picker"
  )
  assert.ok(dateField)
  assert.equal(dateField.autoFocus, false)
  assert.equal(dateField.value, "2026-05-26")

  assert.equal(
    await renderer.dispatchEvent({
      changeId: "change-3",
      fieldId: dateField.id,
      type: "form.field.change",
      value: "2026-06-01"
    }),
    true
  )

  const dateSnapshot = renderer.getSnapshot()
  assertFormSnapshot(dateSnapshot)
  assert.equal(
    dateSnapshot.fields.find((field) => field.kind === "date-picker")?.value,
    "2026-06-01"
  )

  const tagField = dateSnapshot.fields.find(
    (
      field
    ): field is Extract<ExtensionFormSurfaceSnapshot["fields"][number], { kind: "tag-picker" }> =>
      field.kind === "tag-picker"
  )
  assert.ok(tagField)
  assert.equal(tagField.autoFocus, false)
  assert.deepEqual(tagField.value, ["Work"])
  assert.ok(tagField.items[0]?.icon)
  assert.notEqual(tagField.items[0]?.icon?.kind, "text")
  assert.deepEqual(
    tagField.items.map((item) => ({ title: item.title, value: item.value })),
    [
      {
        title: "Work",
        value: "Work"
      },
      {
        title: "Personal",
        value: "Personal"
      }
    ]
  )

  assert.equal(
    await renderer.dispatchEvent({
      changeId: "change-4",
      fieldId: tagField.id,
      type: "form.field.change",
      value: ["Work", "Personal"]
    }),
    true
  )

  const tagSnapshot = renderer.getSnapshot()
  assertFormSnapshot(tagSnapshot)
  assert.deepEqual(tagSnapshot.fields.find((field) => field.kind === "tag-picker")?.value, [
    "Work",
    "Personal"
  ])
})

test("runtime Form storeValue hydrates empty values and persists changes", async () => {
  const storage = new Map<string, unknown>([
    ["form-field:title", "Stored title"],
    ["form-field:completed", true]
  ])
  const requests: ExtensionRuntimeHostRequestInput[] = []

  function StoredForm() {
    const [title, setTitle] = useState("")
    const [completed, setCompleted] = useState<boolean | undefined>(undefined)
    const [explicitTitle, setExplicitTitle] = useState("Explicit title")

    return createElement(
      Form,
      null,
      createElement(Form.TextField, {
        id: "title",
        onChange: setTitle,
        storeValue: true,
        title: "Title",
        value: title
      }),
      createElement(Form.Checkbox, {
        id: "completed",
        label: "Completed",
        onChange: setCompleted,
        storeValue: true,
        title: "Completed",
        value: completed as boolean
      }),
      createElement(Form.TextField, {
        id: "explicitTitle",
        onChange: setExplicitTitle,
        storeValue: true,
        title: "Explicit Title",
        value: explicitTitle
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(
    withRuntimeProvider(createElement(StoredForm), async (request) =>
      resolveStorageRequest(request, requests, storage)
    )
  )
  await renderer.flushSnapshots()
  await renderer.flushSnapshots()

  const hydratedSnapshot = renderer.getSnapshot()
  assertFormSnapshot(hydratedSnapshot)
  const hydratedTitleField = hydratedSnapshot.fields.find(
    (
      field
    ): field is Extract<ExtensionFormSurfaceSnapshot["fields"][number], { kind: "text-field" }> =>
      field.kind === "text-field" && field.id === "title"
  )
  assert.ok(hydratedTitleField)
  assert.equal(hydratedTitleField.value, "Stored title")
  const hydratedCompletedField = hydratedSnapshot.fields.find(
    (
      field
    ): field is Extract<ExtensionFormSurfaceSnapshot["fields"][number], { kind: "checkbox" }> =>
      field.kind === "checkbox" && field.id === "completed"
  )
  assert.ok(hydratedCompletedField)
  assert.equal(hydratedCompletedField.value, true)
  const hydratedExplicitTitleField = hydratedSnapshot.fields.find(
    (
      field
    ): field is Extract<ExtensionFormSurfaceSnapshot["fields"][number], { kind: "text-field" }> =>
      field.kind === "text-field" && field.id === "explicitTitle"
  )
  assert.ok(hydratedExplicitTitleField)
  assert.equal(hydratedExplicitTitleField.value, "Explicit title")
  assert.equal(storage.get("form-field:explicitTitle"), undefined)

  assert.equal(
    await renderer.dispatchEvent({
      changeId: "stored-title-change",
      fieldId: "title",
      type: "form.field.change",
      value: "Updated title"
    }),
    true
  )
  await renderer.flushSnapshots()

  assert.equal(storage.get("form-field:title"), "Updated title")
})

test("runtime List.Dropdown storeValue hydrates and persists command scoped values", async () => {
  const storage = new Map<string, unknown>([["list-dropdown", "created_time"]])
  const requests: ExtensionRuntimeHostRequestInput[] = []

  function StoredDropdownList() {
    const [sort, setSort] = useState("last_edited_time")

    return createElement(
      List,
      {
        searchBarAccessory: createElement(
          List.Dropdown,
          {
            onChange: setSort,
            storeValue: true,
            tooltip: "Sort by"
          },
          createElement(List.Dropdown.Item, {
            title: "Last Edited",
            value: "last_edited_time"
          }),
          createElement(List.Dropdown.Item, {
            title: "Created",
            value: "created_time"
          })
        )
      },
      createElement(List.Item, {
        id: "sort",
        title: `Sort ${sort}`
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(
    withRuntimeProvider(createElement(StoredDropdownList), async (request) =>
      resolveStorageRequest(request, requests, storage)
    )
  )
  await renderer.flushSnapshots()
  await renderer.flushSnapshots()

  const hydratedSnapshot = renderer.getSnapshot()
  assertListSnapshot(hydratedSnapshot)
  assert.equal(hydratedSnapshot.searchBarAccessory?.value, "created_time")
  assert.equal(hydratedSnapshot.sections[0]?.items[0]?.title, "Sort created_time")

  assert.equal(
    await renderer.dispatchEvent({
      type: "list.dropdown.change",
      value: "last_edited_time"
    }),
    true
  )
  await renderer.flushSnapshots()

  const updatedSnapshot = renderer.getSnapshot()
  assertListSnapshot(updatedSnapshot)
  assert.equal(updatedSnapshot.searchBarAccessory?.value, "last_edited_time")
  assert.equal(updatedSnapshot.sections[0]?.items[0]?.title, "Sort last_edited_time")
  assert.equal(storage.get("list-dropdown"), "last_edited_time")
})

test("runtime List.Dropdown storeValue persists the first change without an existing value", async () => {
  const storage = new Map<string, unknown>()
  const requests: ExtensionRuntimeHostRequestInput[] = []

  function StoredDropdownList() {
    const [sort, setSort] = useState("last_edited_time")

    return createElement(
      List,
      {
        searchBarAccessory: createElement(
          List.Dropdown,
          {
            onChange: setSort,
            storeValue: true,
            tooltip: "Sort by"
          },
          createElement(List.Dropdown.Item, {
            title: "Last Edited",
            value: "last_edited_time"
          }),
          createElement(List.Dropdown.Item, {
            title: "Created",
            value: "created_time"
          })
        )
      },
      createElement(List.Item, {
        id: "sort",
        title: `Sort ${sort}`
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(
    withRuntimeProvider(createElement(StoredDropdownList), async (request) =>
      resolveStorageRequest(request, requests, storage)
    )
  )
  await renderer.flushSnapshots()
  await renderer.flushSnapshots()

  assert.equal(
    await renderer.dispatchEvent({
      type: "list.dropdown.change",
      value: "created_time"
    }),
    true
  )
  await renderer.flushSnapshots()

  assert.equal(storage.get("list-dropdown"), "created_time")
})

test("runtime Action.SubmitForm passes current form values to onSubmit", async () => {
  const dueDate = new Date(2026, 5, 1)
  let submittedValues: RuntimeSubmitFormValues | null = null

  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      Form,
      {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action.SubmitForm, {
            onSubmit: (values) => {
              submittedValues = values
            },
            title: "Submit"
          })
        )
      },
      createElement(Form.TextField, {
        id: "title",
        onChange: () => {},
        title: "Title",
        value: "Buy milk"
      }),
      createElement(Form.Checkbox, {
        id: "completed",
        onChange: () => {},
        title: "Completed",
        value: true
      }),
      createElement(Form.DatePicker, {
        id: "due",
        onChange: () => {},
        title: "Due",
        value: dueDate
      }),
      createElement(
        Form.Dropdown,
        {
          id: "list",
          onChange: () => {},
          title: "List",
          value: "inbox"
        },
        createElement(Form.Dropdown.Item, {
          title: "Inbox",
          value: "inbox"
        })
      ),
      createElement(
        Form.TagPicker,
        {
          id: "tags",
          onChange: () => {},
          title: "Tags",
          value: ["Work", "Personal"]
        },
        createElement(Form.TagPicker.Item, {
          title: "Work",
          value: "Work"
        }),
        createElement(Form.TagPicker.Item, {
          title: "Personal",
          value: "Personal"
        })
      )
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertFormSnapshot(snapshot)
  const actionId = snapshot.actions[0]?.id
  assert.ok(actionId)

  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )

  assert.deepEqual(submittedValues, {
    completed: true,
    due: dueDate,
    list: "inbox",
    tags: ["Work", "Personal"],
    title: "Buy milk"
  })
  assert.equal(Form.DatePicker.isFullDay(dueDate), true)
})

test("runtime Form.Dropdown submits the first item when uncontrolled", async () => {
  let selectedDatabaseId = ""
  let submittedValues: RuntimeSubmitFormValues | null = null

  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      Form,
      {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action.SubmitForm, {
            onSubmit: (values) => {
              submittedValues = values
            },
            title: "Submit"
          })
        )
      },
      createElement(
        Form.Dropdown,
        {
          id: "database",
          onChange: (value) => {
            selectedDatabaseId = value
          },
          title: "Database"
        },
        createElement(Form.Dropdown.Item, {
          title: "Roadmap",
          value: "database-1"
        }),
        createElement(Form.Dropdown.Item, {
          title: "Archive",
          value: "database-2"
        })
      )
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertFormSnapshot(snapshot)
  const databaseField = snapshot.fields.find((field) => field.id === "database")
  assert.equal(databaseField?.kind === "dropdown" ? databaseField.value : undefined, "database-1")
  assert.equal(selectedDatabaseId, "")

  const actionId = snapshot.actions[0]?.id
  assert.ok(actionId)
  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )

  assert.deepEqual(submittedValues, {
    database: "database-1"
  })
})

test("runtime searchable Form.Dropdown does not treat search results as selected values", async () => {
  let submittedValues: RuntimeSubmitFormValues | null = null

  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      Form,
      {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action.SubmitForm, {
            onSubmit: (values) => {
              submittedValues = values
            },
            title: "Submit"
          })
        )
      },
      createElement(
        Form.Dropdown,
        {
          id: "page",
          onChange: () => {},
          onSearchTextChange: () => {},
          title: "Page"
        },
        createElement(Form.Dropdown.Item, {
          title: "Runtime Notes",
          value: "page-1"
        })
      )
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertFormSnapshot(snapshot)
  const pageField = snapshot.fields.find((field) => field.id === "page")
  assert.equal(pageField?.kind === "dropdown" ? pageField.searchable : undefined, true)
  assert.equal(pageField?.kind === "dropdown" ? pageField.value : undefined, "")

  const actionId = snapshot.actions[0]?.id
  assert.ok(actionId)
  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )
  assert.deepEqual(submittedValues, {
    page: ""
  })
})

test("runtime Action.SubmitForm prefers event form values from the renderer", async () => {
  let submittedValues: RuntimeSubmitFormValues | null = null
  const dueDate = new Date(2026, 5, 1)

  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      Form,
      {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action.SubmitForm, {
            onSubmit: (values) => {
              submittedValues = values
            },
            title: "Submit"
          })
        )
      },
      createElement(Form.TextField, {
        id: "title",
        onChange: () => {},
        title: "Title",
        value: "Stale title"
      }),
      createElement(Form.DatePicker, {
        id: "due",
        onChange: () => {},
        title: "Due",
        value: dueDate
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertFormSnapshot(snapshot)
  const actionId = snapshot.actions[0]?.id
  assert.ok(actionId)

  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      formValues: {
        title: "Current renderer title"
      },
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )

  assert.deepEqual(submittedValues, {
    due: dueDate,
    title: "Current renderer title"
  })
})

test("runtime Action.SubmitForm keeps raw form values when renderer only overrides changed fields", async () => {
  const dueDate = new Date(2026, 5, 1)
  let submittedValues: RuntimeSubmitFormValues | null = null

  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      Form,
      {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action.SubmitForm, {
            onSubmit: (values) => {
              submittedValues = values
            },
            title: "Submit"
          })
        )
      },
      createElement(Form.DatePicker, {
        id: "due",
        onChange: () => {},
        title: "Due",
        value: dueDate
      }),
      createElement(
        Form.Dropdown,
        {
          id: "page",
          onChange: () => {},
          onSearchTextChange: () => {},
          title: "Page",
          value: ""
        },
        createElement(Form.Dropdown.Item, {
          title: "Runtime Notes",
          value: "page-1"
        })
      )
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertFormSnapshot(snapshot)
  const actionId = snapshot.actions[0]?.id
  assert.ok(actionId)

  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      formValues: {
        page: "page-1"
      },
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )

  assert.deepEqual(submittedValues, {
    due: dueDate,
    page: "page-1"
  })
})

test("runtime Form.DatePicker preserves date-time values", async () => {
  function FormFlow() {
    const [dueDate, setDueDate] = useState(new Date(2026, 5, 1, 9, 30))

    return createElement(
      Form,
      null,
      createElement(Form.DatePicker, {
        id: "due",
        onChange: (value) => {
          setDueDate(value instanceof Date ? value : new Date(String(value)))
        },
        title: "Due",
        type: Form.DatePicker.Type.DateTime,
        value: dueDate
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(FormFlow))
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertFormSnapshot(snapshot)
  const dateField = snapshot.fields.find((field) => field.kind === "date-picker")
  assert.equal(dateField?.kind, "date-picker")
  assert.equal(dateField?.kind === "date-picker" ? dateField.type : undefined, "datetime")
  assert.equal(dateField?.kind === "date-picker" ? dateField.value : undefined, "2026-06-01T09:30")
  assert.equal(Form.DatePicker.isFullDay(new Date(2026, 5, 1, 9, 30)), false)
})

test("runtime reconciler snapshots form messages", async () => {
  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      Form,
      null,
      createElement(Form.Message, {
        id: "form-message",
        text: "Choose both source and target branches.",
        tone: "critical"
      }),
      createElement(Form.TextField, {
        id: "title",
        onChange: () => {},
        title: "Title",
        value: ""
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertFormSnapshot(snapshot)
  assert.deepEqual(snapshot.fields[0], {
    id: "form-message",
    kind: "message",
    text: "Choose both source and target branches.",
    tone: "critical"
  })
  assert.equal(snapshot.fields[1]?.id, "title")
})

test("runtime SDK Form.Description renders as an informational form message", async () => {
  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      Form,
      null,
      createElement(Form.Description, {
        id: "description",
        text: "Add to Runtime Notes"
      }),
      createElement(Form.TextArea, {
        autoFocus: true,
        enableMarkdown: true,
        id: "content",
        onChange: () => {},
        title: "Content",
        value: ""
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertFormSnapshot(snapshot)
  assert.deepEqual(snapshot.fields[0], {
    id: "description",
    kind: "message",
    text: "Add to Runtime Notes",
    tone: "info"
  })
  const contentField = snapshot.fields[1]
  assert.equal(contentField?.kind, "text-area")
  assert.equal(contentField?.kind === "text-area" ? contentField.autoFocus : undefined, true)
  assert.equal(contentField?.kind === "text-area" ? contentField.enableMarkdown : undefined, true)
})

test("useForm exposes itemProps object, reset, and focus controls", async () => {
  function FormFlow() {
    const { focus, itemProps, reset } = useForm({
      initialValues: {
        title: "Draft title"
      }
    })

    return createElement(
      Form,
      {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () => {
              reset({ title: "Reset title" })
              focus("title")
            },
            title: "Reset"
          })
        )
      },
      createElement(Form.TextField, {
        title: "Title",
        ...itemProps.title
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(withRuntimeProvider(createElement(FormFlow)))
  await renderer.flushSnapshots()

  const initialSnapshot = renderer.getSnapshot()
  assertFormSnapshot(initialSnapshot)
  assert.equal(initialSnapshot.fields[0]?.kind, "text-field")
  assert.equal(
    initialSnapshot.fields.find((field) => field.kind === "text-field")?.value,
    "Draft title"
  )

  assert.equal(
    await renderer.dispatchEvent({
      changeId: "change-title",
      fieldId: "title",
      type: "form.field.change",
      value: "Edited title"
    }),
    true
  )

  const editedSnapshot = renderer.getSnapshot()
  assertFormSnapshot(editedSnapshot)
  assert.equal(
    editedSnapshot.fields.find((field) => field.kind === "text-field")?.value,
    "Edited title"
  )

  const actionId = editedSnapshot.actions[0]?.id
  assert.ok(actionId)
  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      revision: editedSnapshot.revision,
      type: "action.execute"
    }),
    true
  )

  const resetSnapshot = renderer.getSnapshot()
  assertFormSnapshot(resetSnapshot)
  const resetTitleField = resetSnapshot.fields.find((field) => field.kind === "text-field")
  assert.equal(resetTitleField?.value, "Reset title")
  assert.equal(resetTitleField?.autoFocus, false)
  assert.equal(resetTitleField?.focusRequestId, 1)

  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      revision: resetSnapshot.revision,
      type: "action.execute"
    }),
    true
  )

  const repeatedFocusSnapshot = renderer.getSnapshot()
  assertFormSnapshot(repeatedFocusSnapshot)
  assert.notEqual(repeatedFocusSnapshot.revision, resetSnapshot.revision)
  const repeatedFocusTitleField = repeatedFocusSnapshot.fields.find(
    (field) => field.kind === "text-field"
  )
  assert.equal(repeatedFocusTitleField?.autoFocus, false)
  assert.equal(repeatedFocusTitleField?.focusRequestId, 2)
})

test("runtime SDK opens extension settings through host requests", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const renderer = createTestRenderer()

  function SettingsList() {
    return createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () =>
              openNativeExtensionSettings({
                commandName: "my-issues",
                extensionName: "github"
              }),
            title: "Open Settings"
          })
        ),
        id: "settings",
        title: "Settings"
      })
    )
  }

  renderer.render(
    withRuntimeProvider(createElement(SettingsList), async (request) => {
      requests.push(request)
      return {
        id: "settings-response",
        ok: true,
        result: null
      }
    })
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const action = snapshot.sections[0]?.items[0]?.actions[0]
  assert.ok(action)

  assert.equal(
    await renderer.dispatchEvent({
      actionId: action.id,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    true
  )

  assert.deepEqual(requests, [
    {
      capability: "settings",
      method: "open-extension",
      payload: {
        commandName: "my-issues",
        extensionName: "github"
      }
    }
  ])
})

test("runtime SDK opens native extension and command settings", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const renderer = createTestRenderer()

  function PreferencesList() {
    return createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () => openNativeExtensionSettings({}),
            title: "Open Extension Preferences"
          }),
          createElement(Action, {
            onAction: openNativeCommandSettings,
            title: "Open Command Preferences"
          })
        ),
        id: "preferences",
        title: "Preferences"
      })
    )
  }

  renderer.render(
    createElement(
      ExtensionRuntimeNavigationProvider,
      {
        value: {
          commandName: "search-page",
          commandPreferences: {},
          extensionName: "notion",
          extensionPreferences: {},
          initialAction: "open",
          locale: "zh-CN",
          mode: "view",
          requestHost: async (request) => {
            requests.push(request)
            return {
              id: "settings-response",
              ok: true,
              result: null
            }
          },
          seedQuery: ""
        }
      },
      createElement(PreferencesList)
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const actions = snapshot.sections[0]?.items[0]?.actions ?? []
  assert.equal(actions.length, 2)

  for (const action of actions) {
    assert.equal(
      await renderer.dispatchEvent({
        actionId: action.id,
        revision: snapshot.revision,
        type: "action.execute"
      }),
      true
    )
  }

  assert.deepEqual(requests, [
    {
      capability: "settings",
      method: "open-extension",
      payload: {
        extensionName: "notion"
      }
    },
    {
      capability: "settings",
      method: "open-extension",
      payload: {
        commandName: "search-page",
        extensionName: "notion"
      }
    }
  ])
})

test("runtime reconciler rejects stale action events from an old snapshot revision", async () => {
  let latestActionExecutions = 0

  function SwitchingActionsList(props: { onLatestAction: () => void }) {
    const [mode, setMode] = useState<"first" | "latest">("first")

    return createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          mode === "first"
            ? createElement(Action, {
                onAction: () => setMode("latest"),
                title: "Advance"
              })
            : createElement(Action, {
                onAction: props.onLatestAction,
                title: "Latest Action"
              })
        ),
        id: "item",
        title: mode
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(
    createElement(SwitchingActionsList, {
      onLatestAction: () => {
        latestActionExecutions += 1
      }
    })
  )
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertListSnapshot(firstSnapshot)
  const staleActionId = firstSnapshot.sections[0]?.items[0]?.actions[0]?.id
  assert.ok(staleActionId)

  assert.equal(
    await renderer.dispatchEvent({
      actionId: staleActionId,
      revision: firstSnapshot.revision,
      type: "action.execute"
    }),
    true
  )

  const latestSnapshot = renderer.getSnapshot()
  assertListSnapshot(latestSnapshot)
  assert.equal(latestSnapshot.revision, firstSnapshot.revision + 1)
  assert.equal(latestSnapshot.sections[0]?.items[0]?.actions[0]?.id, staleActionId)
  assert.equal(latestSnapshot.sections[0]?.items[0]?.actions[0]?.title, "Latest Action")

  assert.equal(
    await renderer.dispatchEvent({
      actionId: staleActionId,
      revision: firstSnapshot.revision,
      type: "action.execute"
    }),
    false
  )
  assert.equal(latestActionExecutions, 0)

  assert.equal(
    await renderer.dispatchEvent({
      actionId: staleActionId,
      revision: latestSnapshot.revision,
      type: "action.execute"
    }),
    true
  )
  assert.equal(latestActionExecutions, 1)
})

test("runtime reconciler rejects disabled action events", async () => {
  let executionCount = 0
  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      List,
      null,
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            disabled: true,
            onAction: () => {
              executionCount += 1
            },
            title: "Disabled Action"
          })
        ),
        id: "item",
        title: "Item"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assertListSnapshot(snapshot)
  const action = snapshot.sections[0]?.items[0]?.actions[0]
  assert.ok(action)
  assert.equal(action.disabled, true)

  assert.equal(
    await renderer.dispatchEvent({
      actionId: action.id,
      revision: snapshot.revision,
      type: "action.execute"
    }),
    false
  )
  assert.equal(executionCount, 0)
})

test("runtime reconciler preserves keyed item order across reorder and removal", async () => {
  function ReorderableList() {
    const [reordered, setReordered] = useState(false)
    const items = reordered
      ? [
          { id: "c", title: "Gamma" },
          { id: "a", title: "Alpha" }
        ]
      : [
          { id: "a", title: "Alpha" },
          { id: "b", title: "Beta" },
          { id: "c", title: "Gamma" }
        ]

    return createElement(
      List,
      {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () => setReordered(true),
            title: "Reorder"
          })
        )
      },
      items.map((item) =>
        createElement(List.Item, {
          id: item.id,
          key: item.id,
          title: item.title
        })
      )
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(ReorderableList))
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertListSnapshot(firstSnapshot)
  assert.deepEqual(
    firstSnapshot.sections[0]?.items.map((item) => item.id),
    ["a", "b", "c"]
  )
  const actionId = firstSnapshot.actions[0]?.id
  assert.ok(actionId)

  assert.equal(
    await renderer.dispatchEvent({
      actionId,
      revision: firstSnapshot.revision,
      type: "action.execute"
    }),
    true
  )

  const nextSnapshot = renderer.getSnapshot()
  assertListSnapshot(nextSnapshot)
  assert.deepEqual(
    nextSnapshot.sections[0]?.items.map((item) => item.id),
    ["c", "a"]
  )
  assert.deepEqual(
    nextSnapshot.sections[0]?.items.map((item) => item.title),
    ["Gamma", "Alpha"]
  )
})

test("runtime reconciler clears the host container when the root unmounts", async () => {
  const renderer = createTestRenderer()
  renderer.render(
    createElement(
      List,
      null,
      createElement(List.Item, {
        id: "item",
        title: "Item"
      })
    )
  )
  await renderer.flushSnapshots()
  assertListSnapshot(renderer.getSnapshot())

  renderer.render(null)
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assert.ok(snapshot)
  assert.equal(snapshot.kind, "error")
  assert.equal(snapshot.title, "No renderable surface")
})

test("runtime reconciler snapshots list pagination and dispatches load more", async () => {
  function PaginatedList() {
    const [items, setItems] = useState(["Alpha"])
    const hasMore = items.length < 2

    return createElement(
      List,
      {
        pagination: {
          hasMore,
          isLoading: false,
          onLoadMore: () => {
            setItems((current) => [...current, "Beta"])
          }
        }
      },
      items.map((item) =>
        createElement(List.Item, {
          id: item.toLowerCase(),
          key: item,
          title: item
        })
      )
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(PaginatedList))
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertListSnapshot(firstSnapshot)
  assert.deepEqual(
    firstSnapshot.sections[0]?.items.map((item) => item.title),
    ["Alpha"]
  )
  assert.deepEqual(firstSnapshot.pagination, {
    hasMore: true,
    isLoading: false
  })

  assert.equal(
    await renderer.dispatchEvent({
      type: "list.pagination.load-more"
    }),
    true
  )

  const nextSnapshot = renderer.getSnapshot()
  assertListSnapshot(nextSnapshot)
  assert.deepEqual(
    nextSnapshot.sections[0]?.items.map((item) => item.title),
    ["Alpha", "Beta"]
  )
  assert.deepEqual(nextSnapshot.pagination, {
    hasMore: false,
    isLoading: false
  })
})

test("useCachedPromise exposes pagination to runtime lists", async () => {
  const loadPages =
    (query: string): PaginationLoader<string[]> =>
    async ({ cursor }) => {
      if (cursor === "next") {
        return {
          data: [`${query} Beta`],
          hasMore: false
        }
      }

      return {
        cursor: "next",
        data: [`${query} Alpha`],
        hasMore: true
      }
    }

  function PaginatedHookList() {
    const { data, pagination } = useCachedPromise(loadPages, ["Page"])

    return createElement(
      List,
      {
        isLoading: !data,
        pagination
      },
      (data ?? []).map((item) =>
        createElement(List.Item, {
          id: item,
          key: item,
          title: item
        })
      )
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(PaginatedHookList))
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertListSnapshot(firstSnapshot)
  assert.deepEqual(
    firstSnapshot.sections[0]?.items.map((item) => item.title),
    ["Page Alpha"]
  )
  assert.equal(firstSnapshot.pagination?.hasMore, true)

  assert.equal(
    await renderer.dispatchEvent({
      type: "list.pagination.load-more"
    }),
    true
  )

  const nextSnapshot = renderer.getSnapshot()
  assertListSnapshot(nextSnapshot)
  assert.deepEqual(
    nextSnapshot.sections[0]?.items.map((item) => item.title),
    ["Page Alpha", "Page Beta"]
  )
  assert.equal(nextSnapshot.pagination?.hasMore, false)
})

test("useCachedPromise reports loading before the first promise resolves", async () => {
  let resolveItems: ((items: string[]) => void) | undefined

  function LoadingList() {
    const { data, isLoading } = useCachedPromise(
      () =>
        new Promise<string[]>((resolve) => {
          resolveItems = resolve
        })
    )

    return createElement(
      List,
      {
        isLoading
      },
      (data ?? []).map((item) =>
        createElement(List.Item, {
          id: item,
          key: item,
          title: item
        })
      )
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(LoadingList))
  await renderer.flushSnapshots()

  const loadingSnapshot = renderer.getSnapshot()
  assertListSnapshot(loadingSnapshot)
  assert.equal(loadingSnapshot.isLoading, true)

  assert.ok(resolveItems)
  resolveItems(["Loaded Item"])
  await renderer.flushSnapshots()
  await renderer.flushSnapshots()

  const loadedSnapshot = renderer.getSnapshot()
  assertListSnapshot(loadedSnapshot)
  assert.equal(loadedSnapshot.isLoading, false)
  assert.deepEqual(
    loadedSnapshot.sections[0]?.items.map((item) => item.title),
    ["Loaded Item"]
  )
})

test("useCachedPromise supports initialData and data/error callbacks", async () => {
  const receivedData: string[][] = []
  const receivedErrors: string[] = []
  let resolveItems: ((items: string[]) => void) | undefined
  let shouldFail = false

  function CallbackList() {
    const { data, error, isLoading, revalidate } = useCachedPromise(
      async () => {
        if (shouldFail) {
          throw new Error("Failed to load")
        }

        return new Promise<string[]>((resolve) => {
          resolveItems = resolve
        })
      },
      [],
      {
        initialData: ["Initial Item"],
        onData: (nextData) => {
          receivedData.push(nextData)
        },
        onError: (nextError) => {
          receivedErrors.push(nextError.message)
        }
      }
    )

    return createElement(
      List,
      {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () => {
              shouldFail = true
              void revalidate()
            },
            title: "Reload With Error"
          })
        ),
        isLoading
      },
      createElement(List.Item, {
        id: "status",
        title: error?.message ?? data?.[0] ?? "Empty"
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(CallbackList))
  await renderer.flushSnapshots()

  const initialSnapshot = renderer.getSnapshot()
  assertListSnapshot(initialSnapshot)
  assert.equal(initialSnapshot.isLoading, true)
  assert.equal(initialSnapshot.sections[0]?.items[0]?.title, "Initial Item")

  assert.ok(resolveItems)
  resolveItems(["Loaded Item"])
  await renderer.flushSnapshots()
  await renderer.flushSnapshots()

  const loadedSnapshot = renderer.getSnapshot()
  assertListSnapshot(loadedSnapshot)
  assert.equal(loadedSnapshot.isLoading, false)
  assert.equal(loadedSnapshot.sections[0]?.items[0]?.title, "Loaded Item")
  assert.deepEqual(receivedData, [["Loaded Item"]])

  const action = loadedSnapshot.actions[0]
  assert.ok(action)
  assert.equal(
    await renderer.dispatchEvent({
      actionId: action.id,
      revision: loadedSnapshot.revision,
      type: "action.execute"
    }),
    true
  )
  await renderer.flushSnapshots()
  await renderer.flushSnapshots()

  const errorSnapshot = renderer.getSnapshot()
  assertListSnapshot(errorSnapshot)
  assert.equal(errorSnapshot.sections[0]?.items[0]?.title, "Failed to load")
  assert.deepEqual(receivedErrors, ["Failed to load"])
})

test("useCachedPromise exposes abortable controllers", async () => {
  const observedSignals: AbortSignal[] = []
  let resolveSecondQuery: ((items: string[]) => void) | undefined

  function AbortableList() {
    const abortable = useRef<AbortController | null>(null)
    const [query, setQuery] = useState("first")
    const { data } = useCachedPromise(
      (currentQuery: string) =>
        new Promise<string[]>((resolve) => {
          const signal = abortable.current?.signal
          assert.ok(signal)
          observedSignals.push(signal)

          if (currentQuery === "second") {
            resolveSecondQuery = resolve
          }
        }),
      [query],
      {
        abortable
      }
    )

    return createElement(
      List,
      {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () => setQuery("second"),
            title: "Search Again"
          })
        )
      },
      createElement(List.Item, {
        id: "query",
        title: data?.[0] ?? query
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(createElement(AbortableList))
  await renderer.flushSnapshots()
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertListSnapshot(firstSnapshot)
  const action = firstSnapshot.actions[0]
  assert.ok(action)

  assert.equal(
    await renderer.dispatchEvent({
      actionId: action.id,
      revision: firstSnapshot.revision,
      type: "action.execute"
    }),
    true
  )
  await renderer.flushSnapshots()

  assert.equal(observedSignals.length, 2)
  assert.equal(observedSignals[0]?.aborted, true)
  assert.equal(observedSignals[1]?.aborted, false)

  assert.ok(resolveSecondQuery)
  resolveSecondQuery(["Second Result"])
  await renderer.flushSnapshots()
  await renderer.flushSnapshots()

  const secondSnapshot = renderer.getSnapshot()
  assertListSnapshot(secondSnapshot)
  assert.equal(secondSnapshot.sections[0]?.items[0]?.title, "Second Result")
  assert.equal(observedSignals[1]?.aborted, false)
})

test("useFetch loads JSON data and applies mapResult callbacks", async () => {
  const originalFetch = globalThis.fetch
  const receivedData: string[][] = []
  const requestedUrls: string[] = []
  let resolveFetch: (() => void) | undefined
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrls.push(String(input))
    await new Promise<void>((resolve) => {
      resolveFetch = resolve
    })
    return new Response(
      JSON.stringify({
        results: [{ title: "Spec" }]
      }),
      {
        headers: {
          "content-type": "application/json"
        },
        status: 200
      }
    )
  }) as typeof fetch

  try {
    function FetchList() {
      const { data, isLoading } = useFetch<{ results: Array<{ title: string }> }, string[]>(
        "https://api.notion.test/search",
        {
          initialData: ["Loading Seed"],
          mapResult: (result) => ({
            data: result.results.map((item) => item.title)
          }),
          onData: (nextData) => {
            receivedData.push(nextData)
          }
        }
      )

      return createElement(
        List,
        {
          isLoading
        },
        (data ?? []).map((item) =>
          createElement(List.Item, {
            id: item,
            key: item,
            title: item
          })
        )
      )
    }

    const renderer = createTestRenderer()
    renderer.render(createElement(FetchList))
    await renderer.flushSnapshots()

    const initialSnapshot = renderer.getSnapshot()
    assertListSnapshot(initialSnapshot)
    assert.equal(initialSnapshot.isLoading, true)
    assert.deepEqual(
      initialSnapshot.sections[0]?.items.map((item) => item.title),
      ["Loading Seed"]
    )

    assert.ok(resolveFetch)
    resolveFetch()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const loadedSnapshot = renderer.getSnapshot()
    assertListSnapshot(loadedSnapshot)
    assert.equal(loadedSnapshot.isLoading, false)
    assert.deepEqual(
      loadedSnapshot.sections[0]?.items.map((item) => item.title),
      ["Spec"]
    )
    assert.deepEqual(receivedData, [["Spec"]])
    assert.deepEqual(requestedUrls, ["https://api.notion.test/search"])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("useFetch exposes pagination", async () => {
  const originalFetch = globalThis.fetch
  const requestedUrls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    requestedUrls.push(url)
    const isNextPage = url.includes("cursor=next")

    return new Response(
      JSON.stringify({
        nextCursor: isNextPage ? null : "next",
        results: [isNextPage ? "Beta" : "Alpha"]
      }),
      {
        headers: {
          "content-type": "application/json"
        },
        status: 200
      }
    )
  }) as typeof fetch

  try {
    function PaginatedFetchList() {
      const { data, pagination } = useFetch<
        { nextCursor: string | null; results: string[] },
        string[]
      >(({ cursor }) => `https://api.notion.test/search${cursor ? `?cursor=${cursor}` : ""}`, {
        mapResult: (result) => ({
          cursor: result.nextCursor,
          data: result.results,
          hasMore: Boolean(result.nextCursor)
        })
      })

      return createElement(
        List,
        {
          pagination
        },
        (data ?? []).map((item) =>
          createElement(List.Item, {
            id: item,
            key: item,
            title: item
          })
        )
      )
    }

    const renderer = createTestRenderer()
    renderer.render(createElement(PaginatedFetchList))
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const firstSnapshot = renderer.getSnapshot()
    assertListSnapshot(firstSnapshot)
    assert.deepEqual(
      firstSnapshot.sections[0]?.items.map((item) => item.title),
      ["Alpha"]
    )
    assert.equal(firstSnapshot.pagination?.hasMore, true)

    assert.equal(
      await renderer.dispatchEvent({
        type: "list.pagination.load-more"
      }),
      true
    )

    const secondSnapshot = renderer.getSnapshot()
    assertListSnapshot(secondSnapshot)
    assert.deepEqual(
      secondSnapshot.sections[0]?.items.map((item) => item.title),
      ["Alpha", "Beta"]
    )
    assert.equal(secondSnapshot.pagination?.hasMore, false)
    assert.deepEqual(requestedUrls, [
      "https://api.notion.test/search",
      "https://api.notion.test/search?cursor=next"
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("useFetch reports failed requests through failure toasts by default", async () => {
  const originalFetch = globalThis.fetch
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  globalThis.fetch = (async () =>
    new Response("Unauthorized", {
      status: 401
    })) as typeof fetch

  try {
    function FailedFetchList() {
      useFetch("https://api.notion.test/search", {
        failureToastOptions: {
          title: "Could not load Notion"
        }
      })

      return createElement(List, null)
    }

    const renderer = createTestRenderer()
    renderer.render(
      withRuntimeProvider(createElement(FailedFetchList), async (request) => {
        hostRequests.push(request)
        return {
          id: "host-response",
          ok: true,
          result: null
        }
      })
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.deepEqual(hostRequests, [
      {
        capability: "toast",
        method: "show",
        payload: {
          message: "Request failed with status 401",
          primaryAction: undefined,
          secondaryAction: undefined,
          style: "failure",
          title: "Could not load Notion"
        }
      }
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("useLocalStorage reads and writes extension-scoped storage", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>([["visibleProperties", ["status"]]])

  function StorageBackedList() {
    const { isLoading, removeValue, setValue, value } = useLocalStorage<string[]>(
      "visibleProperties",
      ["done"]
    )

    return createElement(
      List,
      {
        isLoading
      },
      createElement(List.Item, {
        actions: createElement(
          ActionPanel,
          null,
          createElement(Action, {
            onAction: () => void setValue((current) => [...(current ?? []), "tags"]),
            title: "Add Tags"
          }),
          createElement(Action, {
            onAction: () => void removeValue(),
            title: "Reset"
          })
        ),
        id: "properties",
        title: (value ?? []).join(",")
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(
    withRuntimeProvider(createElement(StorageBackedList), async (request) =>
      resolveStorageRequest(request, requests, storage)
    )
  )
  await renderer.flushSnapshots()
  await renderer.flushSnapshots()

  const loadedSnapshot = renderer.getSnapshot()
  assertListSnapshot(loadedSnapshot)
  assert.equal(loadedSnapshot.sections[0]?.items[0]?.title, "status")

  const addAction = loadedSnapshot.sections[0]?.items[0]?.actions.find(
    (action) => action.title === "Add Tags"
  )
  assert.ok(addAction)
  assert.equal(
    await renderer.dispatchEvent({
      actionId: addAction.id,
      revision: loadedSnapshot.revision,
      type: "action.execute"
    }),
    true
  )
  await renderer.flushSnapshots()

  const updatedSnapshot = renderer.getSnapshot()
  assertListSnapshot(updatedSnapshot)
  assert.equal(updatedSnapshot.sections[0]?.items[0]?.title, "status,tags")
  assert.deepEqual(storage.get("visibleProperties"), ["status", "tags"])

  const resetAction = updatedSnapshot.sections[0]?.items[0]?.actions.find(
    (action) => action.title === "Reset"
  )
  assert.ok(resetAction)
  assert.equal(
    await renderer.dispatchEvent({
      actionId: resetAction.id,
      revision: updatedSnapshot.revision,
      type: "action.execute"
    }),
    true
  )
  await renderer.flushSnapshots()

  const resetSnapshot = renderer.getSnapshot()
  assertListSnapshot(resetSnapshot)
  assert.equal(resetSnapshot.sections[0]?.items[0]?.title, "done")
  assert.equal(storage.has("visibleProperties"), false)
  assert.deepEqual(
    requests.map((request) => ({
      method: request.method,
      payload: request.payload
    })),
    [
      {
        method: "get",
        payload: {
          key: "visibleProperties",
          scope: "extension"
        }
      },
      {
        method: "set",
        payload: {
          key: "visibleProperties",
          scope: "extension",
          value: ["status", "tags"]
        }
      },
      {
        method: "remove",
        payload: {
          key: "visibleProperties",
          scope: "extension"
        }
      }
    ]
  )
})

function resolveStorageRequest(
  request: ExtensionRuntimeHostRequestInput,
  requests: ExtensionRuntimeHostRequestInput[],
  storage: Map<string, unknown>
) {
  requests.push(request)

  if (request.capability === "storage") {
    if (request.method === "get") {
      return {
        id: "storage-response",
        ok: true as const,
        result: storage.get(request.payload.key)
      }
    }

    if (request.method === "set") {
      storage.set(request.payload.key, request.payload.value)
      return {
        id: "storage-response",
        ok: true as const,
        result: null
      }
    }

    if (request.method === "remove") {
      storage.delete(request.payload.key)
      return {
        id: "storage-response",
        ok: true as const,
        result: null
      }
    }
  }

  return {
    error: {
      code: "unexpected_request",
      message: `Unexpected ${request.capability} request`
    },
    id: "unexpected-response",
    ok: false as const
  }
}
