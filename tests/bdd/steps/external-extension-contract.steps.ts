import { Given, Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type { ExtensionAiAskPayload } from "../../../src/shared/extension-runtime-protocol"
import type {
  NativeExtensionInvokeContext,
  NativeExtensionInvokeRequest
} from "../../../src/shared/native-extensions"
import type { AppleReminder, AppleRemindersData } from "../../../src/extensions/apple-reminders/src/contracts"
import type { GitHubNotification } from "../../../src/extensions/github/src/client-core"
import { OpenworkWorld } from "../support/world"

interface ExtensionRuntimeBddProbe {
  askAI?: (input: ExtensionAiAskPayload) => Promise<string> | string
  hostRequests?: Array<{ capability: string; payload: unknown }>
  invokeNativeExtension?: (
    request: NativeExtensionInvokeRequest,
    context: NativeExtensionInvokeContext
  ) => Promise<unknown> | unknown
  lastAiAsk?: ExtensionAiAskPayload
  rpcCalls?: Array<{ extensionName: string; method: string; payload: unknown }>
}

function getRuntimeFormRoot(page: import("@playwright/test").Page) {
  return page.locator('.launcher-chrome[data-surface="runtime-form"]')
}

function getRuntimeListRoot(page: import("@playwright/test").Page) {
  return page.locator('.launcher-chrome[data-surface="runtime-list"]')
}

function createAppleRemindersData(): AppleRemindersData {
  const inbox = {
    color: "blue",
    id: "bdd-inbox",
    isDefault: true,
    title: "Inbox"
  }
  return {
    lists: [inbox],
    reminders: [
      {
        completionDate: null,
        creationDate: "2026-05-10T00:00:00.000Z",
        dueDate: "2026-05-10",
        id: "bdd-reminder-1",
        isCompleted: false,
        list: inbox,
        notes: "Created by BDD runtime fixture",
        openUrl: "x-apple-reminderkit://bdd-reminder-1",
        priority: "high",
        title: "BDD Reminder"
      } satisfies AppleReminder
    ]
  }
}

function createGitHubNotification(): GitHubNotification {
  return {
    id: "101",
    reason: "mention",
    repositoryFullName: "openwork/runtime-contract",
    subjectType: "Issue",
    title: "BDD GitHub Notification",
    unread: true,
    updatedAt: "2026-05-10T00:00:00.000Z",
    url: "https://github.com/openwork/runtime-contract/issues/101"
  }
}

Given(
  "BDD extension runtime AI 返回 {string}",
  function (this: OpenworkWorld, responseText: string) {
    this.setExtensionRuntimeFixture("aiResponseText", responseText)
  }
)

Given("BDD extension runtime RPC 使用测试数据", function (this: OpenworkWorld) {
  this.setExtensionRuntimeFixture("appleRemindersData", createAppleRemindersData())
  this.setExtensionRuntimeFixture("githubNotification", createGitHubNotification())
})

When(
  "我在 runtime 表单文本框 {string} 输入 {string}",
  async function (this: OpenworkWorld, title: string, value: string) {
    const page = await this.getPageByKind("launcher")
    const field = getRuntimeFormRoot(page).locator("label").filter({
      has: page.getByText(title, { exact: true })
    })
    const textArea = field.locator("textarea").first()
    const input = field.locator("input").first()

    if ((await textArea.count()) > 0) {
      await textArea.fill(value)
      return
    }

    await input.fill(value)
  }
)

When("我执行当前 runtime primary action", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const shell = page.locator(".launcher-window-shell")
  const primaryAction = shell
    .locator("button.launcher-action-link")
    .filter({ hasNot: page.getByText("Actions", { exact: true }) })
    .last()

  await expect(primaryAction).toBeVisible()
  await primaryAction.click()
})

When(
  "我点击 runtime list 空状态动作 {string}",
  async function (this: OpenworkWorld, actionTitle: string) {
    const page = await this.getPageByKind("launcher")
    const list = getRuntimeListRoot(page)
    const action = list.getByRole("button", { exact: true, name: actionTitle })

    await expect(action).toBeVisible()
    await action.click()
  }
)

Then("runtime form 当前标题为 {string}", async function (this: OpenworkWorld, title: string) {
  const page = await this.getPageByKind("launcher")
  const form = getRuntimeFormRoot(page)

  await expect(form).toBeVisible()
  await expect(form.getByText(title, { exact: true }).first()).toBeVisible()
})

Then("runtime list 当前标题为 {string}", async function (this: OpenworkWorld, title: string) {
  const page = await this.getPageByKind("launcher")
  const list = getRuntimeListRoot(page)

  await expect(list).toBeVisible()
  await expect(list.getByText(title, { exact: true }).first()).toBeVisible()
})

Then(
  "runtime list 空状态标题为 {string}",
  async function (this: OpenworkWorld, title: string) {
    const page = await this.getPageByKind("launcher")
    const list = getRuntimeListRoot(page)

    await expect(list).toBeVisible()
    await expect(list.getByText(title, { exact: true }).first()).toBeVisible()
  }
)

Then(
  "runtime 表单消息 {string} 包含 {string}",
  async function (this: OpenworkWorld, fieldId: string, text: string) {
    const page = await this.getPageByKind("launcher")
    const form = getRuntimeFormRoot(page)
    const field = form.locator(`[data-runtime-form-field="${fieldId}"]`)

    await expect(field).toBeVisible()
    await expect(field).toContainText(text)
  }
)

Then(
  "BDD runtime AI 最近一次 prompt 应为 {string}",
  async function (this: OpenworkWorld, expectedPrompt: string) {
    const lastPrompt = await this.evaluateInMain(() => {
      return (
        globalThis as typeof globalThis & {
          __OPENWORK_BDD_EXTENSION_RUNTIME__?: ExtensionRuntimeBddProbe
        }
      ).__OPENWORK_BDD_EXTENSION_RUNTIME__?.lastAiAsk?.prompt
    }, null)

    expect(lastPrompt).toBe(expectedPrompt)
  }
)

Then(
  "BDD runtime host 最近请求 capability 应为 {string}",
  async function (this: OpenworkWorld, expectedCapability: string) {
    const lastCapability = await this.evaluateInMain(() => {
      return (
        globalThis as typeof globalThis & {
          __OPENWORK_BDD_EXTENSION_RUNTIME__?: ExtensionRuntimeBddProbe
        }
      ).__OPENWORK_BDD_EXTENSION_RUNTIME__?.hostRequests?.at(-1)?.capability
    }, null)

    expect(lastCapability).toBe(expectedCapability)
  }
)

Then("系统剪贴板文本应为 {string}", async function (this: OpenworkWorld, expectedText: string) {
  const clipboardText = await this.evaluateInMain((electron, _unused) => {
    return electron.clipboard.readText()
  }, null)

  expect(clipboardText).toBe(expectedText)
})

Then(
  "Settings 当前选中 extension 应为 {string}",
  async function (this: OpenworkWorld, extensionName: string) {
    const page = await this.getPageByKind("settings")

    await expect(page.locator(`[data-extension-selected="${extensionName}"]`)).toBeVisible()
  }
)
