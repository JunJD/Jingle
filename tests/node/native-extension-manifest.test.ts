import assert from "node:assert/strict"
import test from "node:test"
import { defineNativeExtensionManifest } from "../../src/shared/native-extensions"

function defineManifestWithToolDisplays(
  toolName: string,
  toolDisplays: Record<string, never>
): void {
  defineNativeExtensionManifest({
    aiCapability: {
      guide: "Use the invalid display fixture.",
      id: "invalid-display",
      title: "Invalid Display",
      toolDisplays,
      toolNames: [toolName]
    },
    capabilities: [],
    commands: [],
    connection: {
      auth: {
        type: "none"
      },
      id: "default",
      provider: "invalid-display",
      title: "Invalid Display"
    },
    name: "invalid-display",
    title: "Invalid Display"
  })
}

test("native extension manifest requires own tool display entries", () => {
  assert.throws(
    () => defineManifestWithToolDisplays("toString", {}),
    /aiCapability\.toolDisplays must define "toString"/
  )
})

test("native extension manifest rejects undefined tool display entries", () => {
  assert.throws(
    () =>
      defineManifestWithToolDisplays("missingDisplay", {
        missingDisplay: undefined as never
      }),
    /aiCapability\.toolDisplays must define "missingDisplay"/
  )
})
