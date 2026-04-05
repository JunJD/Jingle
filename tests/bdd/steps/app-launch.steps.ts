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

Then("Launcher 窗口当前可见", async function (this: OpenworkWorld) {
  await expect.poll(() => this.isWindowVisible("launcher")).toBe(true)
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

Then(
  "Launcher 首页展示了名为 {string} 的结果",
  async function (this: OpenworkWorld, title: string) {
    const page = await this.getPageByKind("launcher")
    const result = page
      .locator(".launcher-result-row")
      .filter({ has: page.getByText(title, { exact: true }) })
      .first()

    await expect(result).toBeVisible()
  }
)

When("我执行当前选中的 Launcher 结果", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const input = page.locator('.launcher-chrome[data-surface="home"] .launcher-input input')

  await input.press("Enter")
})

When("我打开名为 {string} 的 Launcher 结果", async function (this: OpenworkWorld, title: string) {
  const page = await this.getPageByKind("launcher")
  const result = page
    .locator(".launcher-result-row")
    .filter({ has: page.getByText(title, { exact: true }) })
    .first()

  await result.click()
})

When("我在 Launcher 中按下 Escape", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.keyboard.press("Escape")
})

When("我在 Launcher 首页按下 Escape", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.keyboard.press("Escape")
})

When("我在 Launcher 首页按下 Tab", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.keyboard.press("Tab")
})

When("我在 Launcher 首页按下 ArrowDown", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.keyboard.press("ArrowDown")
})

When("我在 Launcher 首页按下 ArrowUp", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.keyboard.press("ArrowUp")
})

When("我在 Launcher AI 输入框按下 Backspace", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const input = page.locator('.launcher-chrome[data-surface="ai"] .launcher-input input')

  await input.focus()
  await input.press("Backspace")
})

When("我从 Launcher 打开设置窗口", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const settingsButton = page
    .locator('.launcher-chrome[data-surface="home"] .launcher-chrome-footer button')
    .first()

  await settingsButton.click()
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

Then("Launcher 首页当前选中结果为 {string}", async function (this: OpenworkWorld, title: string) {
  const page = await this.getPageByKind("launcher")
  const selectedRow = page.locator(
    '.launcher-chrome[data-surface="home"] .launcher-result-row.launcher-result-row--selected'
  )

  await expect(selectedRow).toBeVisible()
  await expect(selectedRow.getByText(title, { exact: true })).toBeVisible()
})

Then("Launcher 翻译输入框包含 {string}", async function (this: OpenworkWorld, query: string) {
  const page = await this.getPageByKind("launcher")
  const translateSurface = page.locator(
    '.launcher-window-shell[data-active-command-owner="translate"]'
  )
  const input = page.locator("textarea.launcher-translate-textarea")

  await expect(translateSurface).toBeVisible()
  await expect(input).toHaveValue(query)
})

Then("Launcher 窗口已隐藏", async function (this: OpenworkWorld) {
  await expect.poll(() => this.isWindowVisible("launcher")).toBe(false)
})

Then("Settings 窗口可用", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("settings")

  await expect(page.locator("body")).toHaveAttribute("data-window", "settings")
  await page.waitForFunction(() => {
    const root = document.getElementById("root")
    return Boolean(root && root.childElementCount > 0)
  })
})

When("我切换到 Settings 快捷键页", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("settings")

  await page.locator('[data-settings-tab="shortcuts"]').click()
})

When("我开始编辑 launcher.toggle 快捷键", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("settings")
  const currentBinding = page.locator('[data-shortcut-current-binding="launcher.toggle"]')

  await expect(currentBinding).toBeVisible()
  this.setScenarioValue("shortcuts.launcherToggle.initialBinding", await currentBinding.innerText())
  await page.locator('[data-shortcut-edit="launcher.toggle"]').click()
})

When("我录制新的 launcher.toggle 快捷键", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("settings")
  const recorder = page.locator('[data-shortcut-recorder="launcher.toggle"]')
  const platform = await page.evaluate(() => {
    return (
      window as unknown as Window & {
        electron: { process: { platform: string } }
      }
    ).electron.process.platform
  })
  const shortcutKey = platform === "darwin" ? "Meta+Alt+K" : "Control+Alt+K"

  await recorder.focus()
  await page.keyboard.press(shortcutKey)
})

When("我保存 launcher.toggle 快捷键", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("settings")

  await page.locator('[data-shortcut-save="launcher.toggle"]').click()
})

Then("Settings 展示 launcher.toggle 快捷键", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("settings")

  await expect(page.locator('[data-command-id="launcher.toggle"]')).toBeVisible()
})

Then("Settings 将 launcher.toggle 标记为可配置", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("settings")

  await expect(page.locator('[data-command-id="launcher.toggle"]')).toHaveAttribute(
    "data-shortcut-configurable",
    "true"
  )
})

Then("Settings 将 launcher.toggle 显示为自定义快捷键", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("settings")
  const currentBinding = page.locator('[data-shortcut-current-binding="launcher.toggle"]')
  const bindingSource = page.locator('[data-shortcut-binding-source="launcher.toggle"]')
  const initialBinding = this.getScenarioValue("shortcuts.launcherToggle.initialBinding")

  await expect(bindingSource).toHaveAttribute("data-shortcut-binding-source-value", "custom")
  await expect(currentBinding).not.toHaveText(initialBinding)
})

Then("Settings 为 launcher.toggle 显示可用的全局注册状态", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("settings")

  await expect(
    page.locator('[data-shortcut-registration-state="launcher.toggle"]')
  ).toHaveAttribute("data-shortcut-registration-state-value", "available")
  await expect(
    page.locator('[data-shortcut-registration-accelerator="launcher.toggle"]')
  ).toBeVisible()
})

Then(
  "应用菜单使用与 launcher.toggle 相同的快捷键 accelerator",
  async function (this: OpenworkWorld) {
    const page = await this.getPageByKind("settings")
    const expectedAccelerator = await page
      .locator('[data-shortcut-registration-accelerator="launcher.toggle"]')
      .innerText()
    const actualAccelerator = await this.getApplicationMenuAccelerator("Show Launcher")

    expect(actualAccelerator).toBe(expectedAccelerator)
  }
)
