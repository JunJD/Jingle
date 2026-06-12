import assert from "node:assert/strict"
import test from "node:test"
import { shouldGoHomeFromComposerKeyDown } from "../../src/renderer/src/ai-core/composer-keyboard"
import { isLauncherAiInputEventTarget } from "../../src/renderer/src/ai-core/useLauncherAiActions"

const plainEvent = {
  altKey: false,
  ctrlKey: false,
  key: "Backspace",
  metaKey: false,
  shiftKey: false
} as const

test("empty composer delete shortcut goes home", () => {
  assert.equal(
    shouldGoHomeFromComposerKeyDown({
      attachmentCount: 0,
      composerText: "",
      event: plainEvent
    }),
    true
  )

  assert.equal(
    shouldGoHomeFromComposerKeyDown({
      attachmentCount: 0,
      composerText: "   ",
      event: {
        ...plainEvent,
        key: "Delete"
      }
    }),
    true
  )
})

test("composer delete shortcut does not go home when visible content remains", () => {
  assert.equal(
    shouldGoHomeFromComposerKeyDown({
      attachmentCount: 0,
      composerText:
        "[@apple-reminders](openwork-extension-source://apple-reminders/appleReminders)",
      event: {
        ...plainEvent,
        key: "Delete"
      }
    }),
    false
  )

  assert.equal(
    shouldGoHomeFromComposerKeyDown({
      attachmentCount: 1,
      composerText: "",
      event: plainEvent
    }),
    false
  )
})

test("launcher AI input target includes composer descendants", () => {
  const child = {} as EventTarget
  const outside = {} as EventTarget
  const root = {
    contains: (target: EventTarget) => target === child
  } as unknown as HTMLElement
  const input = {
    blur: () => {},
    focus: () => {},
    getElement: () => root,
    getModelText: () => "",
    getRefs: () => [],
    insertText: () => {}
  }

  assert.equal(isLauncherAiInputEventTarget(root, input), true)
  assert.equal(isLauncherAiInputEventTarget(child, input), true)
  assert.equal(isLauncherAiInputEventTarget(outside, input), false)
})
