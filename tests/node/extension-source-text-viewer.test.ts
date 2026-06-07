import assert from "node:assert/strict"
import test from "node:test"
import { parseComposerReferenceTextForViewer } from "../../src/renderer/src/components/chat/ExtensionSourceTextViewer"

test("extension source viewer parses schema markdown into inline tokens", () => {
  assert.deepEqual(
    parseComposerReferenceTextForViewer(
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

test("composer reference viewer parses workspace file markdown into inline tokens", () => {
  assert.deepEqual(
    parseComposerReferenceTextForViewer(
      "Review [@src/main/agent/service.ts](openwork-workspace-file://src%2Fmain%2Fagent%2Fservice.ts)"
    ),
    [
      {
        text: "Review ",
        type: "text"
      },
      {
        label: "@src/main/agent/service.ts",
        path: "src/main/agent/service.ts",
        type: "workspace-file"
      }
    ]
  )
})

test("composer reference viewer decodes encoded workspace file markdown delimiters", () => {
  assert.deepEqual(
    parseComposerReferenceTextForViewer(
      "Review [@src/(main)/service).ts](openwork-workspace-file://src%2F%28main%29%2Fservice%29.ts)"
    ),
    [
      {
        text: "Review ",
        type: "text"
      },
      {
        label: "@src/(main)/service).ts",
        path: "src/(main)/service).ts",
        type: "workspace-file"
      }
    ]
  )
})

test("composer reference viewer leaves plain text unparsed", () => {
  assert.equal(parseComposerReferenceTextForViewer("plain text"), null)
})
