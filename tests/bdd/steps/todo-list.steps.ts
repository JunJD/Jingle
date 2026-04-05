import { Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { randomUUID } from "node:crypto"
import { OpenworkWorld } from "../support/world"

function getTodoListRoot(page: import("@playwright/test").Page) {
  return page.locator('.launcher-window-shell[data-active-command-owner="todo-list"]')
}

When("我在 Todo List 中创建一条新的测试待办", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const todoListRoot = getTodoListRoot(page)
  const input = todoListRoot.locator(
    '.launcher-chrome[data-surface="native-list"] .launcher-input input'
  )
  const title = `BDD todo ${randomUUID()}`

  this.setScenarioValue("todoList.createdTitle", title)

  await expect(todoListRoot).toBeVisible()
  await input.fill(title)

  const createRow = todoListRoot
    .locator('[role="button"]')
    .filter({ has: page.getByText("Create Todo", { exact: true }) })
    .first()

  await expect(createRow).toBeVisible()
  await createRow.click()
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
