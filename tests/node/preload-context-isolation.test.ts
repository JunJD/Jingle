import assert from "node:assert/strict"
import test from "node:test"
import { assertContextIsolation } from "../../src/preload/context-isolation"

test("preload rejects a renderer without Electron context isolation", () => {
  assert.doesNotThrow(() => assertContextIsolation(true))
  assert.throws(() => assertContextIsolation(false), /requires Electron context isolation/i)
})
