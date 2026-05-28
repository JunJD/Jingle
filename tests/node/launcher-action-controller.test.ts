import assert from "node:assert/strict"
import test from "node:test"
import {
  findFirstExecutableLauncherAction,
  hasLauncherActionPanelEntries,
  matchesLauncherActionShortcut,
  resolveActionPanelShortcutOpenState,
  resolveLauncherActionShortcutMatch
} from "../../src/renderer/src/features/launcher-actions/controller-core"
import type { LauncherActionDescriptor } from "../../src/renderer/src/features/launcher-actions/model"
import { toLauncherActionShortcut } from "../../src/renderer/src/extension-runtime/runtime-action-shortcuts"

test("action panel shortcut toggles open state when actions are available", () => {
  assert.equal(resolveActionPanelShortcutOpenState(false, true), true)
  assert.equal(resolveActionPanelShortcutOpenState(true, true), false)
})

test("action panel shortcut keeps the panel closed when actions are unavailable", () => {
  assert.equal(resolveActionPanelShortcutOpenState(false, false), false)
  assert.equal(resolveActionPanelShortcutOpenState(true, false), false)
})

test("launcher action shortcuts match structured action chords", () => {
  assert.equal(
    matchesLauncherActionShortcut(
      {
        key: "n",
        modifiers: ["meta"]
      },
      {
        altKey: false,
        ctrlKey: false,
        key: "N",
        metaKey: true,
        shiftKey: false
      }
    ),
    true
  )
  assert.equal(
    matchesLauncherActionShortcut(
      {
        key: "Backspace",
        modifiers: ["ctrl"]
      },
      {
        altKey: false,
        ctrlKey: true,
        key: "Backspace",
        metaKey: false,
        shiftKey: false
      }
    ),
    true
  )
  assert.equal(
    matchesLauncherActionShortcut(
      {
        key: "n",
        modifiers: ["meta"]
      },
      {
        altKey: false,
        ctrlKey: true,
        key: "n",
        metaKey: false,
        shiftKey: false
      }
    ),
    false
  )
})

test("launcher action shortcut resolver ignores disabled actions", () => {
  const actions: LauncherActionDescriptor[] = [
    {
      disabled: true,
      id: "disabled-new",
      onAction: () => {},
      shortcutChord: {
        key: "n",
        modifiers: ["meta"]
      },
      title: "Disabled New"
    },
    {
      id: "enabled-new",
      onAction: () => {},
      shortcutChord: {
        key: "n",
        modifiers: ["meta"]
      },
      title: "Enabled New"
    }
  ]

  assert.equal(
    resolveLauncherActionShortcutMatch(actions, {
      altKey: false,
      ctrlKey: false,
      key: "n",
      metaKey: true,
      shiftKey: false
    })?.id,
    "enabled-new"
  )
})

test("launcher action shortcut resolver descends into submenu actions", () => {
  const actions: LauncherActionDescriptor[] = [
    {
      children: [
        {
          id: "set-done",
          onAction: () => {},
          shortcutChord: {
            key: "d",
            modifiers: ["meta"]
          },
          title: "Done"
        }
      ],
      id: "set-status",
      onAction: () => {},
      shortcutChord: {
        key: "p",
        modifiers: ["meta", "shift"]
      },
      title: "Set Status"
    }
  ]

  assert.equal(
    resolveLauncherActionShortcutMatch(actions, {
      altKey: false,
      ctrlKey: false,
      key: "d",
      metaKey: true,
      shiftKey: false
    })?.id,
    "set-done"
  )
  assert.equal(
    resolveLauncherActionShortcutMatch(actions, {
      altKey: false,
      ctrlKey: false,
      key: "p",
      metaKey: true,
      shiftKey: true
    }),
    null
  )
})

test("launcher action primary fallback resolves the first executable submenu child", () => {
  const actions: LauncherActionDescriptor[] = [
    {
      children: [
        {
          disabled: true,
          id: "disabled-child",
          onAction: () => {},
          title: "Disabled"
        },
        {
          id: "enabled-child",
          onAction: () => {},
          title: "Enabled"
        }
      ],
      id: "submenu",
      onAction: () => {},
      title: "Submenu"
    }
  ]

  assert.equal(findFirstExecutableLauncherAction(actions)?.id, "enabled-child")
  assert.equal(hasLauncherActionPanelEntries(actions), true)
})

test("runtime action shortcuts convert to launcher shortcut chords", () => {
  assert.deepEqual(
    toLauncherActionShortcut({
      key: "backspace",
      modifiers: ["cmd", "opt", "shift"]
    }),
    {
      key: "Backspace",
      modifiers: ["meta", "alt", "shift"]
    }
  )
})
