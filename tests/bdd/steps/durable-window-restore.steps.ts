import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Given, Then } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type { Thread } from "../../../src/shared/app-types"
import type { PinThreadWindowResult } from "../../../src/shared/durable-window"
import type {
  MainWindowSessionState,
  ThreadWindowRestoreState
} from "../../../src/main/preferences"
import { JingleWorld } from "../support/world"

interface DurableRestoreFixture {
  activeThreadId: string
  archivedThreadId: string
  missingThreadId: string
}

interface DurableWindowTestApi {
  durableWindow: {
    openPrimary: (params: { threadId: string }) => Promise<void>
    pinNew: (params: { threadId: string }) => Promise<PinThreadWindowResult>
  }
  threads: {
    create: (input: { metadata: Record<string, unknown> }) => Promise<Thread>
    delete: (threadId: string) => Promise<void>
    setArchived: (threadId: string, archived: boolean) => Promise<Thread>
  }
}

Given(
  "已持久化 active、archived 和 missing 线程的 durable 窗口绑定",
  async function (this: JingleWorld) {
    const mainPage = await this.getPageByKind("main")
    const fixture = await mainPage.evaluate(async () => {
      const api = (window as typeof window & { api: DurableWindowTestApi }).api
      const active = await api.threads.create({
        metadata: { source: "bdd-durable-restore", title: "BDD Restore Active" }
      })
      const archived = await api.threads.create({
        metadata: { source: "bdd-durable-restore", title: "BDD Restore Archived" }
      })
      const missing = await api.threads.create({
        metadata: { source: "bdd-durable-restore", title: "BDD Restore Missing" }
      })

      for (const threadId of [active.thread_id, archived.thread_id, missing.thread_id]) {
        const result = await api.durableWindow.pinNew({ threadId })
        if (!result.ok) {
          throw new Error(`Failed to persist BDD Thread window for ${threadId}: ${result.reason}`)
        }
      }

      await api.threads.setArchived(archived.thread_id, true)
      await api.threads.delete(missing.thread_id)
      await api.durableWindow.openPrimary({ threadId: archived.thread_id })

      return {
        activeThreadId: active.thread_id,
        archivedThreadId: archived.thread_id,
        missingThreadId: missing.thread_id
      }
    })

    await expect
      .poll(async () => (await this.getWindowKinds()).filter((kind) => kind === "thread-window"))
      .toHaveLength(3)
    this.setScenarioObject("durableRestore.fixture", fixture)
  }
)

Then("只恢复 active 线程的 Thread 窗口", async function (this: JingleWorld) {
  const fixture = this.getScenarioObject<DurableRestoreFixture>("durableRestore.fixture")

  await expect
    .poll(async () => (await this.getWindowKinds()).filter((kind) => kind === "thread-window"))
    .toHaveLength(1)

  const threadWindow = await this.getPageByKind("thread-window")
  await expect(threadWindow.locator("[data-launcher-ai-thread-id]").first()).toHaveAttribute(
    "data-launcher-ai-thread-id",
    fixture.activeThreadId
  )
})

Then("durable 窗口 stale bindings 已从偏好中修复", function (this: JingleWorld) {
  const fixture = this.getScenarioObject<DurableRestoreFixture>("durableRestore.fixture")
  const settings = JSON.parse(
    readFileSync(join(this.getJingleHome(), "settings.json"), "utf8")
  ) as {
    mainWindowSessionState?: MainWindowSessionState
    threadWindowRestoreState?: ThreadWindowRestoreState
  }

  expect(settings.mainWindowSessionState?.lastActiveThreadId).toBeNull()
  expect(settings.threadWindowRestoreState?.windows).toHaveLength(1)
  expect(settings.threadWindowRestoreState?.windows[0]?.threadId).toBe(fixture.activeThreadId)
  expect(settings.threadWindowRestoreState?.windows).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ threadId: fixture.archivedThreadId }),
      expect.objectContaining({ threadId: fixture.missingThreadId })
    ])
  )
})
