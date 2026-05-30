import { Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { randomUUID } from "node:crypto"
import { OpenworkWorld } from "../support/world"

function getTodoListRoot(page: import("@playwright/test").Page) {
  return page.locator('.launcher-window-shell[data-active-command-owner="todo-list"]')
}

function getTodoListInput(page: import("@playwright/test").Page) {
  return getTodoListRoot(page).locator(
    '.launcher-chrome[data-surface="runtime-list"] .launcher-input input'
  )
}

async function waitForTodoListReady(page: import("@playwright/test").Page): Promise<void> {
  const todoListRoot = getTodoListRoot(page)
  const runtimeList = todoListRoot.locator(
    '.launcher-chrome[data-surface="runtime-list"][data-input-status="idle"]'
  )

  await expect(runtimeList).toBeVisible()
  await expect(todoListRoot.getByText("Create Todo", { exact: true }).first()).toBeVisible()
}

When("我在 Todo List 中创建一条新的测试待办", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const todoListRoot = getTodoListRoot(page)
  const input = getTodoListInput(page)
  const title = `BDD todo ${randomUUID()}`

  this.setScenarioValue("todoList.createdTitle", title)

  await waitForTodoListReady(page)
  await expect(todoListRoot).toBeVisible()
  await input.fill(title)

  const createRow = todoListRoot
    .locator('[role="button"]')
    .filter({ has: page.getByText("Create Todo", { exact: true }) })
    .first()

  await expect(createRow).toBeVisible()
  await expect(createRow.getByText(title, { exact: true })).toBeVisible()
  await createRow.click()
})

When("我在 Todo List 输入框中输入新的测试待办标题", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const input = getTodoListInput(page)
  const title = `BDD todo ${randomUUID()}`

  this.setScenarioValue("todoList.createdTitle", title)

  await waitForTodoListReady(page)
  await input.fill(title)
})

When("我在 Todo List 输入框按下 Enter", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const input = getTodoListInput(page)

  await input.focus()
  await input.press("Enter")
})

When("我在当前 Launcher surface 打开动作面板", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const shell = page.locator(".launcher-window-shell")
  const runtimeSurface = shell.locator('.launcher-chrome[data-surface^="runtime"]').first()
  const actionsButton = runtimeSurface.locator("button").filter({
    has: page.getByText("Actions", { exact: true })
  })
  const focusTarget = shell
    .locator(
      '.launcher-chrome[data-surface^="runtime"] input, .launcher-chrome[data-surface^="runtime"] textarea'
    )
    .first()
  const platform = await page.evaluate(() => {
    return (
      window as unknown as Window & {
        electron: { process: { platform: string } }
      }
    ).electron.process.platform
  })

  await expect(runtimeSurface).toBeVisible()
  await expect(actionsButton).toBeVisible()
  await expect(focusTarget).toBeVisible()
  await focusTarget.focus()
  await page.keyboard.press(platform === "darwin" ? "Meta+K" : "Control+K")
})

When("我在原生动作面板中向下移动一次", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.keyboard.press("ArrowDown")
})

When("我执行当前选中的原生动作", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.keyboard.press("Enter")
})

When("我关闭原生动作面板", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.keyboard.press("Escape")
})

Then("Launcher 当前命令归属为 {string}", async function (this: OpenworkWorld, ownerId: string) {
  const page = await this.getPageByKind("launcher")

  await expect(page.locator(".launcher-window-shell")).toHaveAttribute(
    "data-active-command-owner",
    ownerId
  )
})

Then("Todo List 展示刚创建的待办", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const todoListRoot = getTodoListRoot(page)
  const createdTitle = this.getScenarioValue("todoList.createdTitle")

  const todoRow = todoListRoot
    .locator('[role="button"]')
    .filter({ has: page.getByText(createdTitle, { exact: true }) })
    .first()

  await expect(todoListRoot).toBeVisible()
  await expect(todoRow).toBeVisible()
})

Then("Launcher 原生动作面板可见", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await expect(page.locator('[data-surface="native-action-panel"]')).toBeVisible()
})

Then("Launcher 原生动作面板已隐藏", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await expect(page.locator('[data-surface="native-action-panel"]')).toHaveCount(0)
})

Then("Todo List 已进入搜索模式", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const todoListRoot = getTodoListRoot(page)
  const searchingLabel = todoListRoot.getByText("Todo List • Searching", { exact: true }).first()

  await expect(searchingLabel).toBeVisible()
})
