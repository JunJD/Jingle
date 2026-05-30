import assert from "node:assert/strict"
import test from "node:test"
import {
  LAUNCHER_SEARCH_SOURCES,
  launcherSearchSourceOrder
} from "../../src/renderer/src/launcher-shell/hooks/launcher-search-page-store-core"

test("launcher search requests quicklinks as a first-class source", () => {
  assert.deepEqual(LAUNCHER_SEARCH_SOURCES, [
    "applications",
    "quicklinks",
    "files",
    "threads",
    "browser-history"
  ])
  assert.equal(
    launcherSearchSourceOrder.get("quicklinks"),
    launcherSearchSourceOrder.get("applications")! + 1
  )
})
