import { Given, Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { OpenworkWorld } from "../support/world"
import { seedHistoryThreadFixture } from "../support/history-fixtures"
import { getPrismaClient } from "../../../src/main/db/client"
import type { Page } from "@playwright/test"
import type { AgentThreadDataSnapshot, Thread } from "../../../src/shared/app-types"
import { AI_THREAD_SOURCE } from "../../../src/shared/launcher-ai"

function getLauncherAiSurface(page: import("@playwright/test").Page) {
  return page.locator('.launcher-chrome[data-surface="ai"]').first()
}

function getLauncherInput(page: Page, surface?: string) {
  const surfaceSelector = surface
    ? `.launcher-chrome[data-surface="${surface}"]`
    : ".launcher-chrome"

  return page.locator(`${surfaceSelector} .launcher-input input, ${surfaceSelector} .launcher-input textarea`).first()
}

function getLauncherAiComposer(page: Page) {
  return page.locator('.ow-prompt-input [contenteditable="true"]').first()
}

async function readLauncherVisibleInputValue(page: Page): Promise<string> {
  const standardInput = getLauncherInput(page)
  if ((await standardInput.count()) > 0) {
    return standardInput.inputValue()
  }

  const aiComposer = getLauncherAiComposer(page)
  if ((await aiComposer.count()) > 0) {
    return (await aiComposer.innerText()).replace(/\n$/, "")
  }

  throw new Error("Launcher input control is not available.")
}

async function countIndexedUserMessagesContaining(fragment: string): Promise<number> {
  const [row] = await getPrismaClient().$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*) AS count FROM "messages_fts" WHERE role = ? AND search_text LIKE ?`,
    "user",
    `%${fragment}%`
  )

  return Number(row?.count ?? 0)
}

async function countLauncherAssistantMessagesContaining(page: Page, fragment: string): Promise<number> {
  const aiSurface = getLauncherAiSurface(page)
  const responses = aiSurface.locator(".is-assistant")
  const count = await responses.count()
  let matches = 0

  for (let index = 0; index < count; index += 1) {
    const text = (await responses.nth(index).innerText()).trim()
    if (text.includes(fragment)) {
      matches += 1
    }
  }

  return matches
}

async function getLatestLauncherAiThreadData(
  world: OpenworkWorld
): Promise<AgentThreadDataSnapshot> {
  const page = await world.getPageByKind("launcher")
  const expectedWorkspacePath = world.getScenarioValue("threads.currentWorkspacePath")

  return page.evaluate(async ({ source, workspacePath }) => {
    const api = (window as typeof window & {
      api: {
        threads: {
          getAgentThreadData: (threadId: string) => Promise<AgentThreadDataSnapshot>
          list: () => Promise<Thread[]>
        }
      }
    }).api

    const threads = await api.threads.list()
    const launcherThread = threads
      .filter((thread) => thread.metadata?.source === source)
      .filter((thread) => thread.metadata?.workspacePath === workspacePath)
      .sort((left, right) => {
        return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
      })[0]

    if (!launcherThread) {
      throw new Error(`No launcher AI thread found for workspace: ${workspacePath}`)
    }

    return api.threads.getAgentThreadData(launcherThread.thread_id)
  }, {
    source: AI_THREAD_SOURCE,
    workspacePath: expectedWorkspacePath
  })
}

Given("Openwork 桌面应用已启动", async function (this: OpenworkWorld) {
  await this.launchApp()
})

When("我重新启动 Openwork 桌面应用", async function (this: OpenworkWorld) {
  await this.restartApp()
})

Given("存在标题为 {string} 的历史线程", async function (this: OpenworkWorld, title: string) {
  const { threadId } = await seedHistoryThreadFixture({ title })

  this.setScenarioValue("threads.lastCreatedThreadId", threadId)
})

Given(
  "存在标题为 {string} 且包含历史消息 {string} 的历史线程",
  async function (this: OpenworkWorld, title: string, message: string) {
    const { threadId } = await seedHistoryThreadFixture({
      messages: [message],
      title
    })

    this.setScenarioValue("threads.lastCreatedThreadId", threadId)
  }
)

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
  const input = getLauncherInput(page, "home")

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

Then(
  "数据库消息索引用 LIKE 能找到历史消息片段 {string}",
  async function (this: OpenworkWorld, fragment: string) {
    const threadId = this.getScenarioValue("threads.lastCreatedThreadId")
    const [row] = await getPrismaClient().$queryRawUnsafe<Array<{ count: bigint | number }>>(
      `SELECT COUNT(*) AS count FROM "messages_fts" WHERE thread_id = ? AND search_text LIKE ?`,
      threadId,
      `%${fragment}%`
    )

    expect(Number(row.count)).toBeGreaterThan(0)
  }
)

When("我执行当前选中的 Launcher 结果", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const input = getLauncherInput(page, "home")

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

When("我直接打开 Main 历史窗口", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.evaluate(async () => {
    const api = (
      window as unknown as Window & {
        api: {
          mainWindow: {
            openWindow: () => Promise<void>
          }
        }
      }
    ).api

    await api.mainWindow.openWindow()
  })
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
  const input = getLauncherInput(page, "home")

  await page.bringToFront()
  await expect(input).toBeVisible()
  await input.focus()
  await input.press("Tab")
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
  const input = getLauncherAiComposer(page)

  await input.focus()
  await input.press("Backspace")
})

When("我从 Launcher 打开设置窗口", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const platform = await page.evaluate(() => {
    return (
      window as unknown as Window & {
        electron: { process: { platform: string } }
      }
    ).electron.process.platform
  })

  await page.keyboard.press(platform === "darwin" ? "Meta+Comma" : "Control+Comma")
})

When("我通过 API 打开 Settings 窗口", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.evaluate(async () => {
    await (
      window as typeof window & {
        api: {
          settings: {
            openWindow: () => Promise<void>
          }
        }
      }
    ).api.settings.openWindow()
  })
})

Then("Launcher 界面切换到 {string}", async function (this: OpenworkWorld, surface: string) {
  const page = await this.getPageByKind("launcher")
  const activeSurface = page.locator(`.launcher-chrome[data-surface="${surface}"]`)

  await expect(activeSurface).toBeVisible()
})

Then("Launcher 输入框包含 {string}", async function (this: OpenworkWorld, query: string) {
  const page = await this.getPageByKind("launcher")

  await expect.poll(() => readLauncherVisibleInputValue(page)).toBe(query)
})

Then("Launcher AI 输入状态会进入 pending", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.waitForFunction(() => {
    const aiSurface = document.querySelector('.launcher-chrome[data-surface="ai"]')
    return aiSurface?.getAttribute("data-input-status") === "pending"
  })
})

Then(
  "Launcher AI 当前 turn 显示状态 {string}",
  async function (this: OpenworkWorld, status: string) {
    const page = await this.getPageByKind("launcher")
    const aiSurface = getLauncherAiSurface(page)
    const statusRow = aiSurface.locator(`[data-active-turn-status="${status}"]`).first()

    await expect(statusRow).toBeVisible()
    await expect(statusRow).toHaveAttribute("role", "status")
  }
)

Then(
  "在接下来 {int} 毫秒内不会提交 Launcher AI 消息 {string}",
  async function (this: OpenworkWorld, durationMs: number, message: string) {
    const page = await this.getPageByKind("launcher")
    const aiSurface = getLauncherAiSurface(page)
    const deadline = Date.now() + durationMs

    await expect(aiSurface).toBeVisible()

    while (Date.now() < deadline) {
      expect(await countIndexedUserMessagesContaining(message)).toBe(0)
      await page.waitForTimeout(60)
    }

    expect(await countIndexedUserMessagesContaining(message)).toBe(0)
  }
)

Then(
  "Launcher AI 最终只展示 {int} 条包含 {string} 的助手回复",
  async function (this: OpenworkWorld, expectedCount: number, text: string) {
    const page = await this.getPageByKind("launcher")

    await expect
      .poll(async () => countLauncherAssistantMessagesContaining(page, text))
      .toBe(expectedCount)
  }
)

Then(
  "Launcher AI 新线程的 agent thread data 最终包含 {int} 条用户消息、{int} 条包含 {string} 的助手消息，且线程状态为 {string}",
  async function (
    this: OpenworkWorld,
    expectedUserCount: number,
    expectedAssistantCount: number,
    assistantText: string,
    expectedStatus: AgentThreadDataSnapshot["thread"]["status"]
  ) {
    await expect
      .poll(async () => {
        const threadData = await getLatestLauncherAiThreadData(this)
        const userCount = threadData.messages.messages.filter((message) => message.role === "user").length
        const matchingAssistantCount = threadData.messages.messages.filter((message) => {
          if (message.role !== "assistant") {
            return false
          }

          const content = message.content
          if (typeof content === "string") {
            return content.includes(assistantText)
          }

          return content.some((block) => {
            return typeof block.text === "string" && block.text.includes(assistantText)
          })
        }).length

        return {
          assistantCount: matchingAssistantCount,
          status: threadData.thread.status,
          userCount
        }
      })
      .toEqual({
        assistantCount: expectedAssistantCount,
        status: expectedStatus,
        userCount: expectedUserCount
      })
  }
)

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
  const input = translateSurface.locator('[data-runtime-form-field="source-text"] textarea')

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

Then("Main 窗口可用", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("main")

  await expect(page.locator("body")).toHaveAttribute("data-window", "main")
  await page.waitForFunction(() => {
    const root = document.getElementById("root")
    return Boolean(root && root.childElementCount > 0)
  })
})

Then(
  "Main 窗口当前选中了标题为 {string} 的线程",
  async function (this: OpenworkWorld, title: string) {
    const page = await this.getPageByKind("main")

    await expect
      .poll(async () => {
        return page.locator('[data-thread-selected="true"]').first().innerText()
      })
      .toContain(title)
  }
)

Then("Main 窗口消息区包含 {string}", async function (this: OpenworkWorld, content: string) {
  const page = await this.getPageByKind("main")

  await expect(page.locator("main").getByText(content, { exact: true }).first()).toBeVisible()
})

When(
  "我在 Main 窗口选择标题为 {string} 的线程",
  async function (this: OpenworkWorld, title: string) {
    const page = await this.getPageByKind("main")
    const threadItem = page
      .locator('[data-thread-selected="false"], [data-thread-selected="true"]')
      .filter({ has: page.getByText(title, { exact: true }) })
      .first()

    await threadItem.click()
  }
)

Then(
  "Main 窗口持续选中了标题为 {string} 的线程",
  async function (this: OpenworkWorld, title: string) {
    const page = await this.getPageByKind("main")
    const selectedThread = page.locator('[data-thread-selected="true"]').first()
    const deadline = Date.now() + 1000

    while (Date.now() < deadline) {
      await expect(selectedThread).toContainText(title)
      await page.waitForTimeout(100)
    }
  }
)

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

Then(
  "Settings 展示 launcher.search.open-settings 快捷键",
  async function (this: OpenworkWorld) {
    const page = await this.getPageByKind("settings")

    await expect(page.locator('[data-command-id="launcher.search.open-settings"]')).toBeVisible()
  }
)

Then("Settings 将 launcher.toggle 标记为可配置", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("settings")

  await expect(page.locator('[data-command-id="launcher.toggle"]')).toHaveAttribute(
    "data-shortcut-configurable",
    "true"
  )
})

Then(
  "Settings 将 launcher.search.open-settings 标记为可配置",
  async function (this: OpenworkWorld) {
    const page = await this.getPageByKind("settings")

    await expect(page.locator('[data-command-id="launcher.search.open-settings"]')).toHaveAttribute(
      "data-shortcut-configurable",
      "true"
    )
  }
)

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
