import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("Launcher readiness acknowledgement never owns window visibility", async () => {
  const source = await readFile(
    new URL("../../src/main/windows/launcher-window.ts", import.meta.url),
    "utf8"
  )

  assert.doesNotMatch(source, /\.setOpacity\(/)
  assert.match(source, /const awaitPresentationAcknowledgement =/)
  assert.match(source, /Launcher presentation readiness timed out/)
})
