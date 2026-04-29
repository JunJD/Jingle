import assert from "node:assert/strict"
import test from "node:test"
import { normalizeLauncherSettings } from "../../src/shared/launcher-settings"

test("launcher settings keep unique disabled use-with command keys", () => {
  assert.deepEqual(
    normalizeLauncherSettings({
      useWithDisabledCommandKeys: ["files:open", "files:open", 42],
      windowMode: "compact"
    }),
    {
      useWithDisabledCommandKeys: ["files:open"],
      windowMode: "compact"
    }
  )
})
