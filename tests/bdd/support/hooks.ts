import { After, BeforeAll } from "@cucumber/cucumber"
import { mkdirSync } from "node:fs"
import { OpenworkWorld } from "./world"

BeforeAll(function () {
  mkdirSync("test-results/bdd", { recursive: true })
})

After(async function (this: OpenworkWorld) {
  const debugPauseMs = Number(process.env.OPENWORK_BDD_DEBUG_PAUSE_MS ?? "0")
  if (process.env.OPENWORK_BDD_DEBUG === "1" && debugPauseMs > 0) {
    console.log(`[BDD debug] pause ${debugPauseMs}ms before closing app`)
    await new Promise((resolve) => setTimeout(resolve, debugPauseMs))
  }

  await this.closeApp()
})
