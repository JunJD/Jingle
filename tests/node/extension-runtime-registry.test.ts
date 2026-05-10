import assert from "node:assert/strict"
import test from "node:test"
import { nativeExtensionManifests } from "../../src/extensions"
import { getNativeExtensionRuntimeCommand } from "../../src/extensions/runtime"

test("manifest runtime commands resolve through the package-level runtime registry", () => {
  const missingCommands: string[] = []

  for (const manifest of nativeExtensionManifests) {
    for (const command of manifest.commands) {
      if (!command.runtime) {
        continue
      }

      const runtimeCommand = getNativeExtensionRuntimeCommand({
        commandName: command.name,
        extensionName: manifest.name
      })

      if (!runtimeCommand) {
        missingCommands.push(`${manifest.name}:${command.name}`)
      }
    }
  }

  assert.deepEqual(missingCommands, [])

  const translate = getNativeExtensionRuntimeCommand({
    commandName: "translate",
    extensionName: "translate"
  })
  assert.equal(translate?.mode, "view")
  assert.equal(typeof translate?.Component, "function")

  const quickAddReminder = getNativeExtensionRuntimeCommand({
    commandName: "quick-add-reminder",
    extensionName: "apple-reminders"
  })
  assert.equal(quickAddReminder?.mode, "no-view")
  assert.equal(typeof quickAddReminder?.run, "function")

  const unreadNotifications = getNativeExtensionRuntimeCommand({
    commandName: "unread-notifications",
    extensionName: "github"
  })
  assert.equal(unreadNotifications?.mode, "menu-bar")
  assert.equal(typeof unreadNotifications?.Component, "function")
})
