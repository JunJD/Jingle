import { Given, Then } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { OpenworkWorld } from "../support/world"

Given("the Openwork desktop app is launched", async function (this: OpenworkWorld) {
  await this.launchApp()
})

Then("the main window should be available", async function (this: OpenworkWorld) {
  const page = this.getPage()

  await expect(page).toHaveTitle(/openwork/i)
  expect(page.isClosed()).toBe(false)
})

Then(
  "the renderer should identify itself as the main window",
  async function (this: OpenworkWorld) {
    const page = this.getPage()

    await page.waitForFunction(() => document.body.dataset.window === "main")
    await expect(page.locator("body")).toHaveAttribute("data-window", "main")
  }
)

Then("the React root should contain rendered content", async function (this: OpenworkWorld) {
  const page = this.getPage()

  await page.waitForFunction(() => {
    const root = document.getElementById("root")
    return Boolean(root && root.childElementCount > 0)
  })

  const renderedChildren = await page.locator("#root > *").count()
  expect(renderedChildren).toBeGreaterThan(0)
})
