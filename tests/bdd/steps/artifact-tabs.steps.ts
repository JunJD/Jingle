import { Given, Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { AI_THREAD_SOURCE } from "../../../src/shared/launcher-ai"
import { JingleWorld } from "../support/world"
import { seedHistoryThreadWithArtifactFixture } from "../support/history-fixtures"

Given(
  "存在标题为 {string} 且包含 summary artifact {string} 的 Launcher AI 历史线程",
  async function (this: JingleWorld, title: string, artifactTitle: string) {
    const fixture = await seedHistoryThreadWithArtifactFixture({
      artifactTitle,
      metadata: { source: AI_THREAD_SOURCE },
      title
    })

    this.setScenarioValue("artifactTabs.threadId", fixture.threadId)
    this.setScenarioValue("artifactTabs.artifactId", fixture.artifactId)
    this.setScenarioValue("artifactTabs.artifactTitle", artifactTitle)
    this.setScenarioValue("threads.lastCreatedThreadId", fixture.threadId)
  }
)

When("我在 Main 窗口 展开 present_artifacts 工具消息", async function (this: JingleWorld) {
  const page = await this.getPageByKind("main")
  const threadId = this.getScenarioValue("artifactTabs.threadId")
  const artifactTitle = this.getScenarioValue("artifactTabs.artifactTitle")
  const groupToggle = page
    .locator('.jingle-agent-tool-group-trigger[data-tool-call-toggle="present_artifacts"]')
    .first()
  const toolToggle = page
    .locator(
      '.jingle-agent-activity-tool-item [data-tool-call-toggle="present_artifacts"], [data-tool-trigger][data-tool-call-toggle="present_artifacts"]'
    )
    .first()
  const artifactCard = page.locator(
    `[data-launcher-artifact-card][data-launcher-artifact-title="${artifactTitle}"]`
  )
  const artifactItem = page.locator(
    `[data-presented-artifact-item][data-artifact-title="${artifactTitle}"]`
  )

  await expect
    .poll(async () => {
      const threadData = await page.evaluate(async (targetThreadId) => {
        return (
          window as typeof window & {
            api: {
              threads: {
                getAgentThreadData: (threadId: string) => Promise<{
                  messages: {
                    messages: Array<{
                      role: string
                      tool_calls?: Array<{ name?: string }>
                    }>
                  }
                }>
              }
            }
          }
        ).api.threads.getAgentThreadData(targetThreadId)
      }, threadId)

      return threadData.messages.messages.some(
        (message) =>
          message.role === "assistant" &&
          (message.tool_calls ?? []).some((toolCall) => toolCall.name === "present_artifacts")
      )
    })
    .toBe(true)

  await expect(artifactCard).toBeVisible()
  if ((await artifactItem.count()) === 0 && (await groupToggle.count()) > 0) {
    await expect(groupToggle).toBeVisible()
    await groupToggle.click()
  }

  if ((await artifactItem.count()) === 0) {
    await expect(toolToggle).toBeVisible()
    await toolToggle.click()
  }

  await expect(artifactItem).toBeVisible()
})

Then(
  "Main 窗口 artifact 面板展示标题为 {string} 的 artifact",
  async function (this: JingleWorld, artifactTitle: string) {
    const page = await this.getPageByKind("main")
    const artifactCard = page.locator(
      `[data-launcher-artifact-card][data-launcher-artifact-title="${artifactTitle}"]`
    )

    await expect(artifactCard).toBeVisible()
  }
)

Then(
  "Main 窗口 artifact 面板中标题为 {string} 的 artifact 不可打开",
  async function (this: JingleWorld, artifactTitle: string) {
    const page = await this.getPageByKind("main")
    const artifactCard = page.locator(
      `[data-launcher-artifact-card][data-launcher-artifact-title="${artifactTitle}"]`
    )

    await expect(artifactCard).toHaveAttribute("data-launcher-artifact-openable", "false")
  }
)

Then(
  "Main 窗口 present_artifacts 消息展示标题为 {string} 的 artifact",
  async function (this: JingleWorld, artifactTitle: string) {
    const page = await this.getPageByKind("main")
    const artifactItem = page.locator(
      `[data-presented-artifact-item][data-artifact-title="${artifactTitle}"]`
    )

    await expect(artifactItem).toBeVisible()
  }
)

Then(
  "Main 窗口 present_artifacts 消息中标题为 {string} 的 artifact 不可打开",
  async function (this: JingleWorld, artifactTitle: string) {
    const page = await this.getPageByKind("main")
    const artifactItem = page.locator(
      `[data-presented-artifact-item][data-artifact-title="${artifactTitle}"]`
    )

    await expect(artifactItem).toHaveAttribute("data-artifact-openable", "false")
  }
)

Then("Main 窗口 不存在 artifact tab", async function (this: JingleWorld) {
  const page = await this.getPageByKind("main")

  await expect(page.locator('[data-thread-tab="artifact"]')).toHaveCount(0)
  await expect(page.locator("[data-artifact-viewer]")).toHaveCount(0)
})
