import { After, BeforeAll } from "@cucumber/cucumber"
import { mkdirSync } from "node:fs"
import { OpenworkWorld } from "./world"

BeforeAll(function () {
  mkdirSync("test-results/bdd", { recursive: true })
})

After(async function (this: OpenworkWorld) {
  await this.closeApp()
})
