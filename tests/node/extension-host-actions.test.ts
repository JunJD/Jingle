import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { ActionMarker, ActionPanelMarker, collectActions } from "../../src/renderer/src/extension-host/actions"

test("native extension host action collector preserves disabled action state", () => {
  const actions = collectActions(
    createElement(
      ActionPanelMarker,
      null,
      createElement(ActionMarker, {
        disabled: true,
        onAction: () => {},
        title: "Create Page"
      })
    ),
    {
      nextId: () => "action-1"
    }
  )

  assert.equal(actions.length, 1)
  assert.equal(actions[0]?.disabled, true)
})
