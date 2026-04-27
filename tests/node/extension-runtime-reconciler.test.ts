import assert from "node:assert/strict"
import test from "node:test"
import { createElement, useState } from "react"
import { createExtensionRuntimeRenderer } from "../../src/extension-runtime/reconciler/render"
import { Action, ActionPanel, List } from "../../src/extension-runtime/sdk"
import type { ExtensionListSurfaceSnapshot } from "../../src/shared/extension-runtime-protocol"

function createTestRenderer() {
  return createExtensionRuntimeRenderer({
    commandName: "counter",
    extensionName: "runtime-fixture"
  })
}

function assertListSnapshot(
  snapshot: ReturnType<ReturnType<typeof createTestRenderer>["getSnapshot"]>
): asserts snapshot is ExtensionListSurfaceSnapshot {
  assert.ok(snapshot)
  assert.equal(snapshot.kind, "list")
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
