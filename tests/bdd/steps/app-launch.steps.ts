import { Given, Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { OpenworkWorld } from "../support/world"

Given("Openwork 桌面应用已启动", async function (this: OpenworkWorld) {
  await this.launchApp()
})

Then("Launcher 窗口可用", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await expect(page).toHaveTitle(/openwork/i)
  expect(page.isClosed()).toBe(false)
})

Then("渲染进程标识为 Launcher 窗口", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.waitForFunction(() => document.body.dataset.window === "launcher")
  await expect(page.locator("body")).toHaveAttribute("data-window", "launcher")
})

Then("Launcher React 根节点已完成渲染", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.waitForFunction(() => {
    const root = document.getElementById("root")
    return Boolean(root && root.childElementCount > 0)
  })

  const renderedChildren = await page.locator("#root > *").count()
  expect(renderedChildren).toBeGreaterThan(0)
})

Then("默认不会打开 Main 窗口", async function (this: OpenworkWorld) {
  const windowKinds = await this.getWindowKinds()

  expect(windowKinds).not.toContain("main")
})

When("我在 Launcher 中搜索 {string}", async function (this: OpenworkWorld, query: string) {
  const page = await this.getPageByKind("launcher")
  const input = page.locator('.launcher-chrome[data-surface="home"] .launcher-input input')

  await input.fill(query)
})

Then("Launcher 首页展示了可执行结果", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const homeSurface = page.locator('.launcher-chrome[data-surface="home"]')
  const rows = homeSurface.locator(".launcher-result-row")

  await expect(homeSurface).toBeVisible()
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeGreaterThan(0)
})

When("我执行当前选中的 Launcher 结果", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const input = page.locator('.launcher-chrome[data-surface="home"] .launcher-input input')

  await input.press("Enter")
})

When("我在 Launcher 中按下 Escape", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.keyboard.press("Escape")
})

Then("Launcher 界面切换到 {string}", async function (this: OpenworkWorld, surface: string) {
  const page = await this.getPageByKind("launcher")
  const activeSurface = page.locator(`.launcher-chrome[data-surface="${surface}"]`)

  await expect(activeSurface).toBeVisible()
})

Then("Launcher 输入框包含 {string}", async function (this: OpenworkWorld, query: string) {
  const page = await this.getPageByKind("launcher")
  const input = page.locator(".launcher-chrome .launcher-input input")

  await expect(input).toHaveValue(query)
})
