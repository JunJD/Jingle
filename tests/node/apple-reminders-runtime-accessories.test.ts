import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { List } from "@jingle/extension-api"
import { createExtensionRuntimeRenderer } from "../../src/extension-runtime/reconciler/render"
import { getReminderAccessories } from "../../installable-extensions/apple-reminders/src/helpers"
import type { AppleReminder } from "../../installable-extensions/apple-reminders/contracts"

function createReminder(overrides: Partial<AppleReminder> = {}): AppleReminder {
  return {
    completionDate: null,
    creationDate: null,
    dueDate: null,
    id: "reminder-1",
    isCompleted: false,
    list: {
      color: "",
      id: "list-1",
      isDefault: false,
      title: "Inbox"
    },
    notes: "",
    openUrl: "",
    priority: null,
    title: "Review runtime migration",
    ...overrides
  }
}

test("Apple Reminders runtime accessories serialize as a stable text visual", async () => {
  const accessories = getReminderAccessories({
    displayCompletionDate: false,
    reminder: createReminder({
      priority: "high"
    }),
    showListName: true
  })

  assert.equal(accessories, "Inbox · high")

  const renderer = createExtensionRuntimeRenderer({
    commandName: "my-reminders",
    extensionName: "apple-reminders"
  })
  renderer.render(
    createElement(
      List,
      { navigationTitle: "My Reminders" },
      createElement(List.Item, {
        accessories,
        id: "reminder-1",
        title: "Review runtime migration"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assert.equal(snapshot?.kind, "list")
  if (snapshot?.kind !== "list") {
    return
  }

  assert.deepEqual(snapshot.sections[0]?.items[0]?.accessories, [
    {
      kind: "text",
      text: "Inbox · high"
    }
  ])
})
