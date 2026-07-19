import { Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type { LauncherHistoryItem } from "../../../src/shared/launcher-history"
import type {
  LauncherActionExecutionResult,
  LauncherSearchAction
} from "../../../src/shared/launcher-search"
import type { LocalStartItem } from "../../../src/shared/local-start"
import { JingleWorld } from "../support/world"

async function listLocalStartItems(world: JingleWorld): Promise<LocalStartItem[]> {
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

async function executeLauncherAction(
  world: JingleWorld,
  action: LauncherSearchAction
): Promise<LauncherActionExecutionResult> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputAction) => {
    return (
      window as typeof window & {
        api: {
          launcher: {
            executeAction: (action: LauncherSearchAction) => Promise<LauncherActionExecutionResult>
          }
        }
      }
    ).api.launcher.executeAction(inputAction)
  }, action)
}

function findRequiredLocalStartItem(items: LocalStartItem[], title: string): LocalStartItem {
  const item = items.find((candidate) => candidate.title === title)

  if (!item) {
    throw new Error(`Local start item "${title}" was not found.`)
  }

  return item
}

function getLatestLauncherHistory(world: JingleWorld): LauncherHistoryItem[] {
  return JSON.parse(world.getScenarioValue("launcherHistory.latestItems")) as LauncherHistoryItem[]
}

When(
  "我通过 Launcher API 执行标题为 {string} 的 local start 打开动作",
  async function (this: JingleWorld, title: string) {
    const localStartItem = findRequiredLocalStartItem(await listLocalStartItems(this), title)
    const result = await executeLauncherAction(this, {
      executor: "shell",
      localStartItemId: localStartItem.id,
      target: {
        kind: localStartItem.kind,
        path: localStartItem.path
      },
      type: "open-path"
    })

    this.setScenarioValue("launcherAction.latestResult", JSON.stringify(result))
    this.setScenarioValue("launcherAction.localStartHistoryKey", `local-start:${localStartItem.id}`)
  }
)

When(
  "我通过 Launcher API 执行 Windows packaged application {string}",
  async function (this: JingleWorld, appUserModelId: string) {
    const result = await executeLauncherAction(this, {
      executor: "shell",
      target: { appUserModelId },
      type: "launch-windows-packaged-application"
    })

    this.setScenarioValue("launcherAction.latestResult", JSON.stringify(result))
    this.setScenarioValue(
      "launcherAction.packagedApplicationHistoryKey",
      `application:windows-packaged:${appUserModelId}`
    )
  }
)

Then("Launcher API 动作执行成功", function (this: JingleWorld) {
  const result = JSON.parse(
    this.getScenarioValue("launcherAction.latestResult")
  ) as LauncherActionExecutionResult

  expect(result).toEqual({ ok: true })
})

Then(
  "launcher history 标题为 {string} 的项 historyKey 应等于当前执行 local start 的 historyKey",
  function (this: JingleWorld, title: string) {
    const expectedHistoryKey = this.getScenarioValue("launcherAction.localStartHistoryKey")
    const item = getLatestLauncherHistory(this).find((candidate) => candidate.title === title)

    expect(item?.historyKey).toBe(expectedHistoryKey)
  }
)

Then(
  "launcher history 标题为 {string} 的项 historyKey 应等于当前执行 packaged application 的 historyKey",
  function (this: JingleWorld, title: string) {
    const expectedHistoryKey = this.getScenarioValue("launcherAction.packagedApplicationHistoryKey")
    const item = getLatestLauncherHistory(this).find((candidate) => candidate.title === title)

    expect(item?.historyKey).toBe(expectedHistoryKey)
  }
)
