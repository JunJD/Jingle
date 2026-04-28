import assert from "node:assert/strict"
import test from "node:test"
import { resolveActionPanelShortcutOpenState } from "../../src/renderer/src/features/launcher-actions/controller-core"

test("action panel shortcut toggles open state when actions are available", () => {
  assert.equal(resolveActionPanelShortcutOpenState(false, true), true)
  assert.equal(resolveActionPanelShortcutOpenState(true, true), false)
})

test("action panel shortcut keeps the panel closed when actions are unavailable", () => {
  assert.equal(resolveActionPanelShortcutOpenState(false, false), false)
  assert.equal(resolveActionPanelShortcutOpenState(true, false), false)
})
