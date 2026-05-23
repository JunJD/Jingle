import assert from "node:assert/strict"
import test from "node:test"
import { shouldGoHomeFromComposerKeyDown } from "../../src/renderer/src/ai-core/composer-keyboard"

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
