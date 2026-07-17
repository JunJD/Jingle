import assert from "node:assert/strict"
import test from "node:test"
import { parseExtensionAiModelTarget } from "../../src/main/services/extension-runtime/ai-model-target"

test("extension AI model target keeps default, fast, and explicit selection mutually exclusive", () => {
  assert.deepEqual(parseExtensionAiModelTarget({}), { kind: "default" })
  assert.deepEqual(parseExtensionAiModelTarget({ modelPreference: "fast" }), { kind: "fast" })
  assert.deepEqual(parseExtensionAiModelTarget({ modelId: "  openai:gpt-5.6-sol  " }), {
    kind: "explicit",
    modelId: "openai:gpt-5.6-sol"
  })
})

test("extension AI model target rejects ambiguous and blank explicit input", () => {
  assert.throws(
    () => parseExtensionAiModelTarget({ modelId: "openai:gpt-5.6-sol", modelPreference: "fast" }),
    /cannot specify both modelId and modelPreference/
  )
  assert.throws(() => parseExtensionAiModelTarget({ modelId: "   " }), /non-empty string/)
})
