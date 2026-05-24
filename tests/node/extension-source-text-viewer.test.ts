import assert from "node:assert/strict"
import test from "node:test"
import { parseExtensionSourceTextForViewer } from "../../src/renderer/src/components/chat/ExtensionSourceTextViewer"

test("extension source viewer parses schema markdown into inline tokens", () => {
  assert.deepEqual(
    parseExtensionSourceTextForViewer(
      "Use [@apple-reminders](openwork-extension-source://apple-reminders/appleReminders) today"
    ),
    [
      {
        text: "Use ",
        type: "text"
      },
      {
        extensionName: "apple-reminders",
        label: "@apple-reminders",
        sourceId: "appleReminders",
        type: "extension-source"
      },
      {
        text: " today",
        type: "text"
      }
    ]
  )
})

test("extension source viewer leaves plain text unparsed", () => {
  assert.equal(parseExtensionSourceTextForViewer("plain text"), null)
})
