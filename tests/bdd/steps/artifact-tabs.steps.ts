import { Given, Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { OpenworkWorld } from "../support/world"
import { seedHistoryThreadWithArtifactFixture } from "../support/history-fixtures"

Given(
  "存在标题为 {string} 且包含 summary artifact {string} 的历史线程",
  async function (this: OpenworkWorld, title: string, artifactTitle: string) {
    const fixture = await seedHistoryThreadWithArtifactFixture({
      artifactTitle,
      title
    })

    this.setScenarioValue("artifactTabs.threadId", fixture.threadId)
    this.setScenarioValue("artifactTabs.artifactId", fixture.artifactId)
    this.setScenarioValue("artifactTabs.artifactTitle", artifactTitle)
  }
)

When(
  "我在 Main 窗口从右侧 Artifacts 面板打开标题为 {string} 的 artifact",
  async function (this: OpenworkWorld, artifactTitle: string) {
    const page = await this.getPageByKind("main")
    const artifactCard = page.locator(
      `[data-artifact-card][data-artifact-title="${artifactTitle}"]`
    )

    await expect(artifactCard).toBeVisible()
    await artifactCard.click()
  }
)

When("我在 Main 窗口展开 present_artifacts 工具消息", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("main")
  const threadId = this.getScenarioValue("artifactTabs.threadId")
  const toggle = page.locator('[data-tool-call-toggle="present_artifacts"]').first()
  const artifactTitle = this.getScenarioValue("artifactTabs.artifactTitle")
  const artifactItem = page.locator(
    `[data-presented-artifact-item][data-artifact-title="${artifactTitle}"]`
  )

  await expect
    .poll(async () => {
      const snapshot = await page.evaluate(async (targetThreadId) => {
        return (
          window as typeof window & {
            api: {
              agent: {
                getThreadSnapshot: (threadId: string) => Promise<{
                  messagesPage: Array<{
                    role: string
                    tool_calls?: Array<{ name?: string }>
                  }>
                }>
              }
            }
          }
        ).api.agent.getThreadSnapshot(targetThreadId)
      }, threadId)

      return snapshot.messagesPage.some(
        (message) =>
          message.role === "assistant" &&
          (message.tool_calls ?? []).some((toolCall) => toolCall.name === "present_artifacts")
      )
    })
    .toBe(true)

  await expect(toggle).toBeVisible()

  if ((await artifactItem.count()) === 0) {
    await toggle.click()
  }

  await expect(artifactItem).toBeVisible()
})

When(
  "我在 Main 窗口从聊天消息打开标题为 {string} 的 artifact",
  async function (this: OpenworkWorld, artifactTitle: string) {
    const page = await this.getPageByKind("main")
    const artifactItem = page.locator(
      `[data-presented-artifact-item][data-artifact-title="${artifactTitle}"][data-artifact-openable="true"]`
    )

    await expect(artifactItem).toBeVisible()
    await artifactItem.click()
  }
)

When("我关闭标题为 {string} 的 artifact tab", async function (this: OpenworkWorld, title: string) {
  const page = await this.getPageByKind("main")
  const closeButton = page.locator(
    `[data-thread-tab-close="artifact"][data-thread-tab-title="${title}"]`
  )

  await expect(closeButton).toBeVisible()
  await closeButton.click()
})

Then(
  "Main 窗口顶部存在标题为 {string} 的 artifact tab",
  async function (this: OpenworkWorld, title: string) {
    const page = await this.getPageByKind("main")
    const artifactTab = page.locator(
      `[data-thread-tab="artifact"][data-thread-tab-title="${title}"]`
    )

    await expect(artifactTab).toBeVisible()
  }
)

Then(
  "Main 窗口标题为 {string} 的 artifact tab 只有一个",
  async function (this: OpenworkWorld, title: string) {
    const page = await this.getPageByKind("main")
    const artifactTabs = page.locator(
      `[data-thread-tab="artifact"][data-thread-tab-title="${title}"]`
    )

    await expect(artifactTabs).toHaveCount(1)
  }
)

Then(
  "Main 窗口当前激活的主 tab 为标题 {string} 的 artifact",
  async function (this: OpenworkWorld, title: string) {
    const page = await this.getPageByKind("main")
    const artifactTab = page.locator(
      `[data-thread-tab="artifact"][data-thread-tab-title="${title}"][data-thread-tab-active="true"]`
    )

    await expect(artifactTab).toBeVisible()
  }
)

Then("Main 窗口当前激活的主 tab 为 Agent", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("main")
  const agentTab = page.locator('[data-thread-tab="agent"][data-thread-tab-active="true"]')

  await expect(agentTab).toBeVisible()
})

Then(
  "Main 窗口 artifact viewer 展示标题为 {string}",
  async function (this: OpenworkWorld, title: string) {
    const page = await this.getPageByKind("main")
    const viewer = page.locator(`[data-artifact-viewer][data-artifact-title="${title}"]`)

    await expect(viewer).toBeVisible()
  }
)
