import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type { CreateLocalStartItemInput, LocalStartItem } from "../../../src/shared/local-start"
import { OpenworkWorld } from "../support/world"

async function upsertLocalStart(
  world: OpenworkWorld,
  input: CreateLocalStartItemInput
): Promise<LocalStartItem> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (localStartInput) => {
    return (
      window as typeof window & {
        api: {
          localStart: {
            upsert: (input: CreateLocalStartItemInput) => Promise<LocalStartItem>
          }
        }
      }
    ).api.localStart.upsert(localStartInput)
  }, input)
}

async function listLocalStart(world: OpenworkWorld): Promise<LocalStartItem[]> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async () => {
    return (
      window as typeof window & {
        api: {
          localStart: {
            list: () => Promise<LocalStartItem[]>
          }
        }
      }
    ).api.localStart.list()
  })
}

async function recordLocalStartUse(world: OpenworkWorld, itemId: string): Promise<LocalStartItem> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputItemId) => {
    return (
      window as typeof window & {
        api: {
          localStart: {
            recordUse: (itemId: string) => Promise<LocalStartItem>
          }
        }
      }
    ).api.localStart.recordUse(inputItemId)
  }, itemId)
}

async function removeLocalStart(world: OpenworkWorld, itemId: string): Promise<void> {
  const page = await world.getPageByKind("launcher")

  await page.evaluate(async (inputItemId) => {
    await (
      window as typeof window & {
        api: {
          localStart: {
            remove: (itemId: string) => Promise<void>
          }
        }
      }
    ).api.localStart.remove(inputItemId)
  }, itemId)
}

function getLatestLocalStartItems(world: OpenworkWorld): LocalStartItem[] {
  return JSON.parse(world.getScenarioValue("localStart.latestItems")) as LocalStartItem[]
}

function findRequiredLocalStartItem(items: LocalStartItem[], title: string): LocalStartItem {
  const item = items.find((candidate) => candidate.title === title)

  if (!item) {
    throw new Error(`Local start item "${title}" was not found.`)
  }

  return item
}

async function findLocalStartItemByTitle(
  world: OpenworkWorld,
  title: string
): Promise<LocalStartItem> {
  return findRequiredLocalStartItem(await listLocalStart(world), title)
}

When(
  "我 upsert local start 目录 {string} 路径为 {string}",
  async function (this: OpenworkWorld, title: string, relativePath: string) {
    const itemPath = join(this.getOpenworkHome(), relativePath)

    mkdirSync(itemPath, { recursive: true })
    await upsertLocalStart(this, {
      kind: "directory",
      path: itemPath,
      title
    })
    this.setScenarioValue("localStart.currentPath", itemPath)
  }
)

When("我读取 local start 列表", async function (this: OpenworkWorld) {
  const items = await listLocalStart(this)

  this.setScenarioValue("localStart.latestItems", JSON.stringify(items))
})

When(
  "我记录使用标题为 {string} 的 local start 项",
  async function (this: OpenworkWorld, title: string) {
    const item = await findLocalStartItemByTitle(this, title)

    await recordLocalStartUse(this, item.id)
  }
)

When(
  "我删除标题为 {string} 的 local start 项",
  async function (this: OpenworkWorld, title: string) {
    const item = await findLocalStartItemByTitle(this, title)

    await removeLocalStart(this, item.id)
  }
)

Then("local start 列表包含标题为 {string} 的项", function (this: OpenworkWorld, title: string) {
  const items = getLatestLocalStartItems(this)

  expect(items.some((item) => item.title === title)).toBe(true)
})

Then("local start 列表不包含标题为 {string} 的项", function (this: OpenworkWorld, title: string) {
  const items = getLatestLocalStartItems(this)

  expect(items.some((item) => item.title === title)).toBe(false)
})

Then(
  "local start 标题为 {string} 的项 useCount 应为 {int}",
  function (this: OpenworkWorld, title: string, useCount: number) {
    const item = findRequiredLocalStartItem(getLatestLocalStartItems(this), title)

    expect(item.useCount).toBe(useCount)
  }
)

Then(
  "local start 列表中路径为当前 local start 路径的项只有 {int} 个",
  function (this: OpenworkWorld, count: number) {
    const currentPath = this.getScenarioValue("localStart.currentPath")
    const items = getLatestLocalStartItems(this)

    expect(items.filter((item) => item.path === currentPath)).toHaveLength(count)
  }
)

Then(
  "local start 第 {int} 项标题应为 {string}",
  function (this: OpenworkWorld, position: number, title: string) {
    const item = getLatestLocalStartItems(this)[position - 1]

    expect(item?.title).toBe(title)
  }
)
