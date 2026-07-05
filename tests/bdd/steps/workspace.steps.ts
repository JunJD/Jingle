import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { AI_THREAD_SOURCE } from "../../../src/shared/launcher-ai"
import { JingleWorld } from "../support/world"

type WorkspaceReadResult = {
  content?: string
  error?: string
  modified_at?: string
  size?: number
  success: boolean
}

type ThreadSnapshot = {
  thread_id: string
  title?: string
}

async function createThread(
  world: JingleWorld,
  input: {
    title: string
    workspacePath?: string
  }
): Promise<ThreadSnapshot> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(
    async (input) => {
      return (
        window as typeof window & {
          api: {
            threads: {
              create: (input?: {
                metadata?: Record<string, unknown>
                workspaceKind?: "projectless"
                workspacePath?: string
              }) => Promise<ThreadSnapshot>
            }
          }
        }
      ).api.threads.create({
        metadata: {
          source: input.source,
          title: input.title
        },
        ...(input.workspacePath
          ? { workspaceKind: "projectless" as const, workspacePath: input.workspacePath }
          : {})
      })
    },
    { source: AI_THREAD_SOURCE, title: input.title, workspacePath: input.workspacePath }
  )
}

async function getGlobalWorkspace(world: JingleWorld): Promise<string | null> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async () => {
    return (
      window as typeof window & {
        api: {
          workspace: {
            get: (threadId?: string) => Promise<string | null>
          }
        }
      }
    ).api.workspace.get()
  })
}

async function getThreadWorkspace(world: JingleWorld, threadId: string): Promise<string | null> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputThreadId) => {
    return (
      window as typeof window & {
        api: {
          workspace: {
            get: (threadId?: string) => Promise<string | null>
          }
        }
      }
    ).api.workspace.get(inputThreadId)
  }, threadId)
}

async function setThreadWorkspace(
  world: JingleWorld,
  threadId: string,
  workspacePath: string
): Promise<string | null> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(
    async (input) => {
      return (
        window as typeof window & {
          api: {
            workspace: {
              set: (threadId: string | undefined, path: string | null) => Promise<string | null>
            }
          }
        }
      ).api.workspace.set(input.threadId, input.workspacePath)
    },
    { threadId, workspacePath }
  )
}

async function readWorkspaceTextFile(
  world: JingleWorld,
  threadId: string,
  filePath: string
): Promise<WorkspaceReadResult> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(
    async (input) => {
      return (
        window as typeof window & {
          api: {
            workspace: {
              readFile: (threadId: string, filePath: string) => Promise<WorkspaceReadResult>
            }
          }
        }
      ).api.workspace.readFile(input.threadId, input.filePath)
    },
    { threadId, filePath }
  )
}

async function readWorkspaceBinaryFile(
  world: JingleWorld,
  threadId: string,
  filePath: string
): Promise<WorkspaceReadResult> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(
    async (input) => {
      return (
        window as typeof window & {
          api: {
            workspace: {
              readBinaryFile: (threadId: string, filePath: string) => Promise<WorkspaceReadResult>
            }
          }
        }
      ).api.workspace.readBinaryFile(input.threadId, input.filePath)
    },
    { threadId, filePath }
  )
}

When(
  "我通过 API 创建标题为 {string} 且 workspace 为测试目录 {string} 的线程",
  async function (this: JingleWorld, title: string, directoryName: string) {
    const workspacePath = join(this.getJingleHome(), directoryName)

    mkdirSync(workspacePath, { recursive: true })

    const thread = await createThread(this, { title, workspacePath })
    const actualWorkspacePath = await getThreadWorkspace(this, thread.thread_id)

    expect(actualWorkspacePath).toBe(workspacePath)
    this.setScenarioValue(`workspace.thread.${title}.id`, thread.thread_id)
    this.setScenarioValue(`workspace.thread.${title}.path`, workspacePath)
    this.setScenarioValue("threads.lastCreatedThreadId", thread.thread_id)
  }
)

When(
  "我把最新创建线程的 workspace 设置为测试目录 {string}",
  async function (this: JingleWorld, directoryName: string) {
    const threadId = this.getScenarioValue("threads.latestThreadId")
    const workspacePath = join(this.getJingleHome(), directoryName)

    mkdirSync(workspacePath, { recursive: true })

    const actualWorkspacePath = await setThreadWorkspace(this, threadId, workspacePath)

    expect(actualWorkspacePath).toBe(workspacePath)
    this.setScenarioValue("workspace.currentThreadPath", workspacePath)
  }
)

When(
  "我在最新创建线程的 workspace 中写入文本文件 {string} 内容为 {string}",
  async function (this: JingleWorld, filePath: string, content: string) {
    const workspacePath = this.getScenarioValue("workspace.currentThreadPath")
    const targetPath = join(workspacePath, filePath)

    mkdirSync(join(targetPath, ".."), { recursive: true })
    writeFileSync(targetPath, content, "utf8")
  }
)

When(
  "我在最新创建线程的 workspace 中写入二进制文件 {string} 字节 {string}",
  async function (this: JingleWorld, filePath: string, bytes: string) {
    const workspacePath = this.getScenarioValue("workspace.currentThreadPath")
    const targetPath = join(workspacePath, filePath)
    const buffer = Buffer.from(
      bytes
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    )

    mkdirSync(join(targetPath, ".."), { recursive: true })
    writeFileSync(targetPath, buffer)
  }
)

When(
  "我读取最新创建线程 workspace 中的文本文件 {string}",
  async function (this: JingleWorld, filePath: string) {
    const threadId = this.getScenarioValue("threads.latestThreadId")
    const result = await readWorkspaceTextFile(this, threadId, filePath)

    this.setScenarioValue("workspace.latestTextReadResult", JSON.stringify(result))
  }
)

When(
  "我读取最新创建线程 workspace 中的二进制文件 {string}",
  async function (this: JingleWorld, filePath: string) {
    const threadId = this.getScenarioValue("threads.latestThreadId")
    const result = await readWorkspaceBinaryFile(this, threadId, filePath)

    this.setScenarioValue("workspace.latestBinaryReadResult", JSON.stringify(result))
  }
)

Then("workspace:get 全局路径应为当前全局 workspace", async function (this: JingleWorld) {
  const expectedWorkspacePath = this.getScenarioValue("threads.currentWorkspacePath")
  const actualWorkspacePath = await getGlobalWorkspace(this)

  expect(actualWorkspacePath).toBe(expectedWorkspacePath)
})

Then("workspace:get 最新创建线程路径应为当前线程 workspace", async function (this: JingleWorld) {
  const threadId = this.getScenarioValue("threads.latestThreadId")
  const expectedWorkspacePath = this.getScenarioValue("workspace.currentThreadPath")
  const actualWorkspacePath = await getThreadWorkspace(this, threadId)

  expect(actualWorkspacePath).toBe(expectedWorkspacePath)
})

Then("workspace:get 全局路径应为当前线程 workspace", async function (this: JingleWorld) {
  const expectedWorkspacePath = this.getScenarioValue("workspace.currentThreadPath")
  const actualWorkspacePath = await getGlobalWorkspace(this)

  expect(actualWorkspacePath).toBe(expectedWorkspacePath)
})

Then("最新 workspace 文本读取结果应成功", async function (this: JingleWorld) {
  const result = JSON.parse(
    this.getScenarioValue("workspace.latestTextReadResult")
  ) as WorkspaceReadResult

  expect(result.success).toBe(true)
})

Then(
  "最新 workspace 文本读取内容应为 {string}",
  async function (this: JingleWorld, content: string) {
    const result = JSON.parse(
      this.getScenarioValue("workspace.latestTextReadResult")
    ) as WorkspaceReadResult

    expect(result.content).toBe(content)
  }
)

Then("最新 workspace 文本读取结果应失败", async function (this: JingleWorld) {
  const result = JSON.parse(
    this.getScenarioValue("workspace.latestTextReadResult")
  ) as WorkspaceReadResult

  expect(result.success).toBe(false)
})

Then(
  "最新 workspace 文本读取错误应包含 {string}",
  async function (this: JingleWorld, errorFragment: string) {
    const result = JSON.parse(
      this.getScenarioValue("workspace.latestTextReadResult")
    ) as WorkspaceReadResult

    expect(result.error).toContain(errorFragment)
  }
)

Then("最新 workspace 二进制读取结果应成功", async function (this: JingleWorld) {
  const result = JSON.parse(
    this.getScenarioValue("workspace.latestBinaryReadResult")
  ) as WorkspaceReadResult

  expect(result.success).toBe(true)
})

Then(
  "最新 workspace 二进制读取内容应为 {string}",
  async function (this: JingleWorld, base64: string) {
    const result = JSON.parse(
      this.getScenarioValue("workspace.latestBinaryReadResult")
    ) as WorkspaceReadResult

    expect(result.content).toBe(base64)
  }
)

Then(
  "Pinned AI session workspace 路径应为标题 {string} 的线程 workspace",
  async function (this: JingleWorld, title: string) {
    const page = await this.getPageByKind("pinned-ai-session")
    const expectedThreadId = this.getScenarioValue(`workspace.thread.${title}.id`)
    const expectedWorkspacePath = this.getScenarioValue(`workspace.thread.${title}.path`)
    const environmentTrigger = page.locator("[data-launcher-ai-environment-trigger]")

    await environmentTrigger.click()
    const workspaceRow = page.locator(
      `[data-launcher-ai-workspace-thread-id="${expectedThreadId}"]`
    )

    await expect(workspaceRow).toBeVisible()
    await expect(workspaceRow).toHaveAttribute(
      "data-launcher-ai-workspace-path",
      expectedWorkspacePath
    )
    await page.keyboard.press("Escape")
  }
)
