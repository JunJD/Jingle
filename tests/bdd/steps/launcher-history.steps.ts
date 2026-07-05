import { Given, Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type { LauncherHistoryItem } from "../../../src/shared/launcher-history"
import { seedLauncherHistoryFixture } from "../support/launcher-history-fixtures"
import { JingleWorld } from "../support/world"

async function listLauncherHistory(world: JingleWorld): Promise<LauncherHistoryItem[]> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async () => {
    return (
      window as typeof window & {
        api: {
          launcherHistory: {
            list: () => Promise<LauncherHistoryItem[]>
          }
        }
      }
    ).api.launcherHistory.list()
  })
}

async function setLauncherHistoryPinned(
  world: JingleWorld,
  itemId: string,
  pin: boolean
): Promise<LauncherHistoryItem> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(
    async (input) => {
      return (
        window as typeof window & {
          api: {
            launcherHistory: {
              setPinned: (itemId: string, pin: boolean) => Promise<LauncherHistoryItem>
            }
          }
        }
      ).api.launcherHistory.setPinned(input.itemId, input.pin)
    },
    { itemId, pin }
  )
}

async function removeLauncherHistory(world: JingleWorld, itemId: string): Promise<void> {
  const page = await world.getPageByKind("launcher")

  await page.evaluate(async (inputItemId) => {
    await (
      window as typeof window & {
        api: {
          launcherHistory: {
            remove: (itemId: string) => Promise<void>
          }
        }
      }
    ).api.launcherHistory.remove(inputItemId)
  }, itemId)
}

function getLatestLauncherHistory(world: JingleWorld): LauncherHistoryItem[] {
  return JSON.parse(world.getScenarioValue("launcherHistory.latestItems")) as LauncherHistoryItem[]
}

function findRequiredHistoryItem(
  items: LauncherHistoryItem[],
  title: string
): LauncherHistoryItem {
  const item = items.find((candidate) => candidate.title === title)

  if (!item) {
    throw new Error(`Launcher history item "${title}" was not found.`)
  }

  return item
}

Given(
  "launcher history 中已有置顶目录 {string} 和最近目录 {string}",
  function (this: JingleWorld, pinnedTitle: string, recentTitle: string) {
    const jingleHome = this.prepareJingleHome()

    seedLauncherHistoryFixture({
      jingleHome,
      items: [
        {
          title: pinnedTitle,
          pin: true,
          lastUsedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          title: recentTitle,
          lastUsedAt: "2026-01-02T00:00:00.000Z"
        }
      ]
    })
  }
)

Given(
  "launcher history 中已有较早目录 {string} 和最近目录 {string}",
  function (this: JingleWorld, olderTitle: string, recentTitle: string) {
    const jingleHome = this.prepareJingleHome()

    seedLauncherHistoryFixture({
      jingleHome,
      items: [
        {
          title: olderTitle,
          lastUsedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          title: recentTitle,
          lastUsedAt: "2026-01-02T00:00:00.000Z"
        }
      ]
    })
  }
)

When("我读取 launcher history 列表", async function (this: JingleWorld) {
  const items = await listLauncherHistory(this)

  this.setScenarioValue("launcherHistory.latestItems", JSON.stringify(items))
})

When(
  "我置顶标题为 {string} 的 launcher history 项",
  async function (this: JingleWorld, title: string) {
    const item = findRequiredHistoryItem(getLatestLauncherHistory(this), title)

    await setLauncherHistoryPinned(this, item.id, true)
  }
)

When(
  "我删除标题为 {string} 的 launcher history 项",
  async function (this: JingleWorld, title: string) {
    const item = findRequiredHistoryItem(getLatestLauncherHistory(this), title)

    await removeLauncherHistory(this, item.id)
  }
)

Then(
  "launcher history 第 {int} 项标题应为 {string}",
  function (this: JingleWorld, position: number, title: string) {
    const item = getLatestLauncherHistory(this)[position - 1]

    expect(item?.title).toBe(title)
  }
)

Then(
  "launcher history 标题为 {string} 的项应为置顶",
  function (this: JingleWorld, title: string) {
    const item = findRequiredHistoryItem(getLatestLauncherHistory(this), title)

    expect(item.pin).toBe(true)
  }
)

Then(
  "launcher history 不包含标题为 {string} 的项",
  function (this: JingleWorld, title: string) {
    const items = getLatestLauncherHistory(this)

    expect(items.some((item) => item.title === title)).toBe(false)
  }
)

Then(
  "launcher history 包含标题为 {string} 的项",
  function (this: JingleWorld, title: string) {
    const items = getLatestLauncherHistory(this)

    expect(items.some((item) => item.title === title)).toBe(true)
  }
)
