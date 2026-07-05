import { After, BeforeAll } from "@cucumber/cucumber"
import { mkdirSync } from "node:fs"
import { JingleWorld } from "./world"

BeforeAll(function () {
  mkdirSync("test-results/bdd", { recursive: true })
})

After(async function (this: JingleWorld) {
  const debugPauseMs = readDebugPauseMs()
  if (process.env.JINGLE_BDD_DEBUG === "1" && debugPauseMs > 0) {
    console.log(`[BDD debug] pause ${debugPauseMs}ms before closing app`)
    await new Promise((resolve) => setTimeout(resolve, debugPauseMs))
  }

  try {
    await this.closeApp()
  } finally {
    await this.runCleanups()
  }
})

function readDebugPauseMs(): number {
  const rawValue = process.env.JINGLE_BDD_DEBUG_PAUSE_MS
  if (rawValue === undefined) {
    return 0
  }

  const value = Number(rawValue)
  if (!Number.isFinite(value)) {
    return 0
  }

  return value
}
