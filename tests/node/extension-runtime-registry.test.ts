import assert from "node:assert/strict"
import test from "node:test"
import { nativeExtensionManifests } from "../../src/extensions"
import { getNativeExtensionRuntimeCommand } from "../../src/extensions/runtime"

test("manifest runtime commands resolve through the built-in runtime adapter", () => {
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
})
