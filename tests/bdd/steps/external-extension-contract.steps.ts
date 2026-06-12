import { Given, Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { ExtensionAiAskPayload } from "../../../src/shared/extension-runtime-protocol"
import type {
  NativeExtensionInvokeContext,
  NativeExtensionInvokeRequest
} from "../../../src/shared/native-extensions"
import type { AppleReminder, AppleRemindersData } from "../../../installable-extensions/apple-reminders/contracts"
import type { GitHubNotification } from "../../../installable-extensions/github/domain/client-core"
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

interface NotionMockRequest {
  body: unknown
  method: string
  url: string
}

type JsonRecord = Record<string, unknown>

interface NativeExtensionPageApi {
  nativeExtensions: {
    setPreferences: (
      extensionName: string,
      nextRecord: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
  }
}

function getRuntimeFormRoot(page: import("@playwright/test").Page) {
  return page.locator('.launcher-chrome[data-surface="runtime-form"]')
}

function getRuntimeListRoot(page: import("@playwright/test").Page) {
  return page.locator('.launcher-chrome[data-surface="runtime-list"]')
}

function getLauncherHomeInput(page: import("@playwright/test").Page) {
  return page
    .locator(
      '.launcher-chrome[data-surface="home"] .launcher-input input, .launcher-chrome[data-surface="home"] .launcher-input textarea'
    )
    .first()
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

function notionTitleProperty(title: string): Record<string, unknown> {
  return {
    id: "title",
    title: [
      {
        annotations: {
          bold: false,
          code: false,
          color: "default",
          italic: false,
          strikethrough: false,
          underline: false
        },
        href: null,
        plain_text: title,
        text: {
          content: title,
          link: null
        },
        type: "text"
      }
    ],
    type: "title"
  }
}

function createNotionPage(id: string, title: string): Record<string, unknown> {
  return {
    archived: false,
    created_by: {
      id: "bdd-user-1",
      object: "user"
    },
    created_time: "2026-05-26T10:00:00.000Z",
    icon: null,
    id,
    last_edited_by: {
      id: "bdd-user-1",
      object: "user"
    },
    last_edited_time: "2026-05-26T12:00:00.000Z",
    object: "page",
    parent: {
      type: "workspace",
      workspace: true
    },
    properties: {
      Name: notionTitleProperty(title)
    },
    public_url: null,
    url: `https://www.notion.so/${id}`
  }
}

function createNotionDataSource(id: string, title: string): Record<string, unknown> {
  return {
    archived: false,
    cover: null,
    created_by: {
      id: "bdd-user-1",
      object: "user"
    },
    created_time: "2026-05-26T10:00:00.000Z",
    database_parent: {
      database_id: "bdd-notion-database-1",
      type: "database_id"
    },
    description: [],
    icon: null,
    id,
    in_trash: false,
    is_inline: false,
    last_edited_by: {
      id: "bdd-user-1",
      object: "user"
    },
    last_edited_time: "2026-05-26T12:00:00.000Z",
    object: "data_source",
    parent: {
      database_id: "bdd-notion-database-1",
      type: "database_id"
    },
    properties: {
      Name: {
        description: null,
        id: "title",
        name: "Name",
        title: {},
        type: "title"
      }
    },
    public_url: null,
    title: notionTitleProperty(title).title,
    url: `https://www.notion.so/${id}`
  }
}

function createNotionParagraphBlock(id: string, text: string): Record<string, unknown> {
  return {
    archived: false,
    created_by: {
      id: "bdd-user-1",
      object: "user"
    },
    created_time: "2026-05-26T10:00:00.000Z",
    has_children: false,
    id,
    last_edited_by: {
      id: "bdd-user-1",
      object: "user"
    },
    last_edited_time: "2026-05-26T12:00:00.000Z",
    object: "block",
    paragraph: {
      color: "default",
      rich_text: [
        {
          annotations: {
            bold: false,
            code: false,
            color: "default",
            italic: false,
            strikethrough: false,
            underline: false
          },
          href: null,
          plain_text: text,
          text: {
            content: text,
            link: null
          },
          type: "text"
        }
      ]
    },
    parent: {
      page_id: "bdd-notion-page-1",
      type: "page_id"
    },
    type: "paragraph"
  }
}

function requestBodyHasSearchFilter(body: unknown, value: string): boolean {
  return Boolean(
    body &&
      typeof body === "object" &&
      "filter" in body &&
      (body as { filter?: { value?: unknown } }).filter?.value === value
  )
}

function collectPlainText(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return []
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPlainText(item))
  }

  const record = value as JsonRecord
  const ownText = typeof record.plain_text === "string" ? [record.plain_text] : []
  const textContent =
    record.text &&
    typeof record.text === "object" &&
    typeof (record.text as JsonRecord).content === "string"
      ? [(record.text as JsonRecord).content as string]
      : []
  return [
    ...ownText,
    ...textContent,
    ...Object.values(record).flatMap((child) => collectPlainText(child))
  ]
}

function jsonResponse(response: ServerResponse, body: unknown, statusCode = 200): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json"
  })
  response.end(JSON.stringify(body))
}

function htmlResponse(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  })
  response.end(body)
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString("utf8").trim()
  return text ? JSON.parse(text) : null
}

async function startNotionMockServer(requests: NotionMockRequest[]): Promise<{
  close: () => Promise<void>
  url: string
}> {
  const server = createServer((request, response) => {
    void (async () => {
      const body = request.method === "POST" || request.method === "PATCH" ? await readJsonBody(request) : null
      const url = request.url ?? "/"
      requests.push({
        body,
        method: request.method ?? "GET",
        url
      })

      if (request.method === "POST" && url === "/v1/search") {
        const results = requestBodyHasSearchFilter(body, "data_source")
          ? [createNotionDataSource("bdd-notion-data-source-1", "BDD Tasks")]
          : [createNotionPage("bdd-notion-page-1", "BDD Connected Notion Page")]
        jsonResponse(response, {
          has_more: false,
          next_cursor: null,
          object: "list",
          results
        })
        return
      }

      if (request.method === "GET" && url === "/bdd-quick-capture-article") {
        htmlResponse(
          response,
          `<!doctype html>
<html>
  <head>
    <title>BDD Quick Capture Article</title>
  </head>
  <body>
    <article>
      <h1>BDD Quick Capture Article</h1>
      <p>BDD quick capture article body for Electron runtime.</p>
    </article>
  </body>
</html>`
        )
        return
      }

      if (request.method === "GET" && url === "/v1/data_sources/bdd-notion-data-source-1") {
        jsonResponse(response, createNotionDataSource("bdd-notion-data-source-1", "BDD Tasks"))
        return
      }

      if (request.method === "PATCH" && url === "/v1/blocks/bdd-notion-page-1/children") {
        const text = collectPlainText(body).join(" ").trim() || "BDD appended block"
        jsonResponse(response, {
          has_more: false,
          next_cursor: null,
          object: "list",
          results: [createNotionParagraphBlock("bdd-appended-block-1", text)]
        })
        return
      }

      if (request.method === "POST" && url === "/v1/pages") {
        jsonResponse(response, {
          ...createNotionPage("bdd-created-notion-page-1", "BDD Created Notion Page"),
          parent: {
            database_id: "bdd-notion-database-1",
            type: "database_id"
          },
          properties: {
            title: notionTitleProperty(
              collectPlainText((body as { properties?: unknown } | null)?.properties).join(" ") ||
                "BDD Created Notion Page"
            )
          },
          url: "https://www.notion.so/bdd-created-notion-page-1"
        })
        return
      }

      if (request.method === "GET" && url === "/v1/users") {
        jsonResponse(response, {
          has_more: false,
          next_cursor: null,
          object: "list",
          results: []
        })
        return
      }

      jsonResponse(response, { message: `Unhandled BDD Notion request ${request.method} ${url}` }, 404)
    })().catch((error) => {
      jsonResponse(
        response,
        { message: error instanceof Error ? error.message : String(error) },
        500
      )
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("BDD Notion mock server did not bind to a TCP port.")
  }

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
    url: `http://127.0.0.1:${address.port}/v1`
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

Given("BDD Notion API 使用连接后的测试数据", async function (this: OpenworkWorld) {
  const requests: NotionMockRequest[] = []
  const server = await startNotionMockServer(requests)

  this.addCleanup(server.close)
  this.setScenarioObject("notionMock.requests", requests)
  this.setScenarioValue("notionMock.apiBaseUrl", server.url)
  this.setScenarioValue(
    "notionMock.quickCaptureArticleUrl",
    `${server.url.replace(/\/v1$/, "")}/bdd-quick-capture-article`
  )
})

Given("Notion extension 已连接到 BDD Notion API", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const apiBaseUrl = this.getScenarioValue("notionMock.apiBaseUrl")

  await page.evaluate(async (input) => {
    await (
      window as typeof window & {
        api: NativeExtensionPageApi
      }
    ).api.nativeExtensions.setPreferences("notion", {
      accessToken: "secret_bdd_notion_token",
      apiBaseUrl: input.apiBaseUrl,
      open_in: {
        name: "Notion"
      },
      properties_in_page_previews: false
    })
  }, { apiBaseUrl })
})

When("我在 Launcher 中搜索 BDD Notion 快速剪藏 URL", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")
  const articleUrl = this.getScenarioValue("notionMock.quickCaptureArticleUrl")

  await getLauncherHomeInput(page).fill(`notion quick capture ${articleUrl}`)
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

When(
  "我在 runtime 表单下拉框 {string} 选择 {string}",
  async function (this: OpenworkWorld, title: string, value: string) {
    const page = await this.getPageByKind("launcher")
    const field = getRuntimeFormRoot(page)
      .locator('[data-runtime-form-field]')
      .filter({ has: page.getByText(title, { exact: true }) })
      .first()
    const select = field.locator("select").first()

    await expect(select).toBeVisible()
    await select.selectOption(value)
  }
)

Then(
  "runtime 表单文本框 {string} 当前值应为 BDD Notion 快速剪藏 URL",
  async function (this: OpenworkWorld, title: string) {
    const page = await this.getPageByKind("launcher")
    const articleUrl = this.getScenarioValue("notionMock.quickCaptureArticleUrl")
    const field = getRuntimeFormRoot(page).locator("label").filter({
      has: page.getByText(title, { exact: true })
    })
    const textArea = field.locator("textarea").first()
    const input = field.locator("input").first()

    if ((await textArea.count()) > 0) {
      await expect(textArea).toHaveValue(articleUrl)
      return
    }

    await expect(input).toHaveValue(articleUrl)
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

Then("runtime list 展示条目 {string}", async function (this: OpenworkWorld, title: string) {
  const page = await this.getPageByKind("launcher")
  const list = getRuntimeListRoot(page)

  await expect(list).toBeVisible()
  await expect(
    list.locator('[role="button"]').filter({ has: page.getByText(title, { exact: true }) }).first()
  ).toBeVisible()
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

Then("BDD Notion API 收到 search 请求", function (this: OpenworkWorld) {
  const requests = this.getScenarioObject<NotionMockRequest[]>("notionMock.requests")

  expect(
    requests.some((request) => request.method === "POST" && request.url === "/v1/search")
  ).toBe(true)
})

Then("BDD Notion API 收到快速剪藏页面读取请求", function (this: OpenworkWorld) {
  const requests = this.getScenarioObject<NotionMockRequest[]>("notionMock.requests")

  expect(
    requests.some(
      (request) => request.method === "GET" && request.url === "/bdd-quick-capture-article"
    )
  ).toBe(true)
})

Then(
  "BDD Notion API 收到向页面 {string} 追加文本 {string} 的请求",
  async function (this: OpenworkWorld, pageId: string, text: string) {
    const requests = this.getScenarioObject<NotionMockRequest[]>("notionMock.requests")

    await expect
      .poll(
        () => {
          const appendRequest = requests.find(
            (request) =>
              request.method === "PATCH" && request.url === `/v1/blocks/${pageId}/children`
          )
          return appendRequest ? collectPlainText(appendRequest.body).join("\n") : ""
        },
        { timeout: 10_000 }
      )
      .toContain(text)
  }
)

Then(
  "BDD Notion API 收到创建页面 {string} 且正文包含 {string} 的请求",
  async function (this: OpenworkWorld, title: string, content: string) {
    const requests = this.getScenarioObject<NotionMockRequest[]>("notionMock.requests")

    await expect
      .poll(
        () => {
          const createRequest = requests.find(
            (request) => request.method === "POST" && request.url === "/v1/pages"
          )
          return createRequest ? collectPlainText(createRequest.body).join("\n") : ""
        },
        { timeout: 10_000 }
      )
      .toContain(title)

    const createRequest = requests.find(
      (request) => request.method === "POST" && request.url === "/v1/pages"
    )
    expect(collectPlainText(createRequest?.body).join("\n")).toContain(content)
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
