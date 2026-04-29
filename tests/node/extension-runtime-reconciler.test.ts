import assert from "node:assert/strict"
import test from "node:test"
import { createElement, useEffect, useState, type ReactElement } from "react"
import { createExtensionRuntimeRenderer } from "../../src/extension-runtime/reconciler/render"
import {
  Action,
  ActionPanel,
  Detail,
  ExtensionRuntimeNavigationProvider,
  Form,
  List,
  createNativeExtensionClient,
  defineNativeExtensionClientMethod,
  useNativeExtensionNavigation
} from "../../src/extension-runtime/sdk"
import type {
  ExtensionDetailSurfaceSnapshot,
  ExtensionFormSurfaceSnapshot,
  ExtensionHostRequest,
  ExtensionListSurfaceSnapshot
} from "../../src/shared/extension-runtime-protocol"

type TestRendererParams = Parameters<typeof createExtensionRuntimeRenderer>[1]

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

function withRuntimeProvider(element: ReactElement): ReactElement {
  return createElement(
    ExtensionRuntimeNavigationProvider,
    {
      value: {
        commandName: "counter",
        commandPreferences: {},
        extensionName: "runtime-fixture",
        extensionPreferences: {},
        initialAction: "open",
        mode: "view",
        requestHost: async () => ({
          id: "host-response",
          ok: true as const,
          result: null
        }),
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

test("runtime reconciler snapshots detail surfaces and navigates back", async () => {
  function DetailFlow() {
    const navigation = useNativeExtensionNavigation()

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

  assert.equal(
    await renderer.dispatchEvent({
      type: "navigation.pop"
    }),
    true
  )

  const nextSnapshot = renderer.getSnapshot()
  assertListSnapshot(nextSnapshot)
})

test("runtime reconciler snapshots form fields and syncs local input", async () => {
  function FormFlow() {
    const [title, setTitle] = useState("Buy milk")
    const [completed, setCompleted] = useState(false)

    return createElement(
      Form,
      {
        navigationTitle: "Create Reminder"
      },
      createElement(Form.TextField, {
        onChange: setTitle,
        placeholder: "Reminder title",
        title: "Title",
        value: title
      }),
      createElement(Form.Checkbox, {
        label: "Done",
        onChange: setCompleted,
        title: "Completed",
        value: completed
      })
    )
  }

  const renderer = createTestRenderer()
  renderer.render(withRuntimeProvider(createElement(FormFlow)))
  await renderer.flushSnapshots()

  const firstSnapshot = renderer.getSnapshot()
  assertFormSnapshot(firstSnapshot)
  assert.equal(firstSnapshot.navigationTitle, "Create Reminder")
  const textField = firstSnapshot.fields.find(
    (
      field
    ): field is Extract<ExtensionFormSurfaceSnapshot["fields"][number], { kind: "text-field" }> =>
      field.kind === "text-field"
  )
  assert.ok(textField)
  assert.equal(textField.value, "Buy milk")

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
