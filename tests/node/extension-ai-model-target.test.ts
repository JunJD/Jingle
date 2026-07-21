import assert from "node:assert/strict"
import test from "node:test"
import { parseExtensionAiModelTarget } from "../../src/main/services/extension-runtime/ai-model-target"

test("extension AI model target keeps only default and fast policy selection", () => {
  assert.deepEqual(parseExtensionAiModelTarget({ modelPreference: "default" }), { kind: "default" })
  assert.deepEqual(parseExtensionAiModelTarget({ modelPreference: "fast" }), { kind: "fast" })
})
