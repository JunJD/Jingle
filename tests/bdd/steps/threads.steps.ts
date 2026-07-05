import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type { AgentThreadDataSnapshot } from "../../../src/shared/app-types"
import type { ThreadWorkspaceBindingRecord } from "../../../src/shared/thread-workspace"
import { JingleWorld } from "../support/world"

type ThreadSnapshot = {
  metadata?: Record<string, unknown>
  thread_id: string
  title?: string
}

async function createThread(
  world: JingleWorld,
  metadata?: Record<string, unknown>
): Promise<ThreadSnapshot> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (input) => {
    return (
      window as typeof window & {
        api: {
          threads: {
            create: (input?: { metadata?: Record<string, unknown> }) => Promise<ThreadSnapshot>
          }
        }
      }
    ).api.threads.create({ metadata: input })
  }, metadata)
}

async function cloneThread(world: JingleWorld, threadId: string): Promise<ThreadSnapshot> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputThreadId) => {
    return (
      window as typeof window & {
        api: { threads: { clone: (threadId: string) => Promise<ThreadSnapshot> } }
      }
    ).api.threads.clone(inputThreadId)
  }, threadId)
}

async function getThread(world: JingleWorld, threadId: string): Promise<ThreadSnapshot | null> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputThreadId) => {
    return (
      window as typeof window & {
        api: { threads: { get: (threadId: string) => Promise<ThreadSnapshot | null> } }
      }
    ).api.threads.get(inputThreadId)
  }, threadId)
}

async function getThreadWorkspaceBinding(
  world: JingleWorld,
  threadId: string
): Promise<ThreadWorkspaceBindingRecord | null> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputThreadId) => {
    return (
      window as typeof window & {
        api: {
          threadWorkspace: {
            get: (threadId: string) => Promise<ThreadWorkspaceBindingRecord | null>
          }
        }
      }
    ).api.threadWorkspace.get(inputThreadId)
  }, threadId)
}

async function listThreads(world: JingleWorld): Promise<ThreadSnapshot[]> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async () => {
    return (
      window as typeof window & { api: { threads: { list: () => Promise<ThreadSnapshot[]> } } }
    ).api.threads.list()
  })
}

async function deleteThread(world: JingleWorld, threadId: string): Promise<void> {
  const page = await world.getPageByKind("launcher")

  await page.evaluate(async (inputThreadId) => {
    await (
      window as typeof window & {
        api: { threads: { delete: (threadId: string) => Promise<void> } }
      }
    ).api.threads.delete(inputThreadId)
  }, threadId)
}

async function getAgentThreadData(
  world: JingleWorld,
  threadId: string
): Promise<AgentThreadDataSnapshot> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputThreadId) => {
    return (
      window as typeof window & {
        electron: {
          ipcRenderer: {
            invoke: (channel: string, ...args: unknown[]) => Promise<AgentThreadDataSnapshot>
          }
        }
      }
    ).electron.ipcRenderer.invoke("threads:agentThreadData", inputThreadId)
  }, threadId)
}

async function setGlobalWorkspace(
  world: JingleWorld,
  workspacePath: string
): Promise<string | null> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputPath) => {
    return (
      window as typeof window & {
        api: {
          workspace: {
            set: (threadId: string | undefined, path: string | null) => Promise<string | null>
          }
        }
      }
    ).api.workspace.set(undefined, inputPath)
  }, workspacePath)
}

When(
  "我把全局 workspace 设置为测试目录 {string}",
  async function (this: JingleWorld, directoryName: string) {
    const workspacePath = join(this.getJingleHome(), directoryName)
    mkdirSync(workspacePath, { recursive: true })

    const actualWorkspacePath = await setGlobalWorkspace(this, workspacePath)

    expect(actualWorkspacePath).toBe(workspacePath)
    this.setScenarioValue("threads.currentWorkspacePath", workspacePath)
  }
)

When(
  "我通过 threads API 创建标题为 {string} 且来源为 {string}",
  async function (this: JingleWorld, title: string, source: string) {
    const thread = await createThread(this, {
      source,
      title
    })

    this.setScenarioValue("threads.latestThreadId", thread.thread_id)
  }
)

When("我克隆最后创建的历史线程", async function (this: JingleWorld) {
  const sourceThreadId = this.getScenarioValue("threads.lastCreatedThreadId")
  const clonedThread = await cloneThread(this, sourceThreadId)

  this.setScenarioValue("threads.latestClonedThreadId", clonedThread.thread_id)
  this.setScenarioValue("threads.latestThreadId", clonedThread.thread_id)
})

When("我删除最新创建的线程", async function (this: JingleWorld) {
  const threadId = this.getScenarioValue("threads.latestThreadId")

  await deleteThread(this, threadId)
  this.setScenarioValue("threads.latestDeletedThreadId", threadId)
})

Then("最新创建线程标题应为 {string}", async function (this: JingleWorld, title: string) {
  const threadId = this.getScenarioValue("threads.latestThreadId")
  const thread = await getThread(this, threadId)

  expect(thread?.title).toBe(title)
})

Then(
  "最新创建线程 metadata.source 应为 {string}",
  async function (this: JingleWorld, source: string) {
    const threadId = this.getScenarioValue("threads.latestThreadId")
    const thread = await getThread(this, threadId)

    expect(thread?.metadata?.source).toBe(source)
  }
)

Then(
  "最新创建线程 workspace binding 应为当前全局 workspace",
  async function (this: JingleWorld) {
    const threadId = this.getScenarioValue("threads.latestThreadId")
    const expectedWorkspacePath = this.getScenarioValue("threads.currentWorkspacePath")
    const binding = await getThreadWorkspaceBinding(this, threadId)

    expect(binding?.workspacePath).toBe(expectedWorkspacePath)
  }
)

Then("最新创建线程 metadata.model 应为非空字符串", async function (this: JingleWorld) {
  const threadId = this.getScenarioValue("threads.latestThreadId")
  const thread = await getThread(this, threadId)
  const model = thread?.metadata?.model

  expect(typeof model).toBe("string")
  expect((model as string).length).toBeGreaterThan(0)
})

Then("threads:list 包含最新创建线程", async function (this: JingleWorld) {
  const threadId = this.getScenarioValue("threads.latestThreadId")
  const threads = await listThreads(this)

  expect(threads.some((thread) => thread.thread_id === threadId)).toBe(true)
})

Then("新克隆线程与源线程 ID 不同", async function (this: JingleWorld) {
  const sourceThreadId = this.getScenarioValue("threads.lastCreatedThreadId")
  const clonedThreadId = this.getScenarioValue("threads.latestClonedThreadId")

  expect(clonedThreadId).not.toBe(sourceThreadId)
})

Then("新克隆线程标题应为 {string}", async function (this: JingleWorld, title: string) {
  const clonedThreadId = this.getScenarioValue("threads.latestClonedThreadId")
  const thread = await getThread(this, clonedThreadId)

  expect(thread?.title).toBe(title)
})

Then(
  "新克隆线程的 history 应包含消息 {string}",
  async function (this: JingleWorld, message: string) {
    const clonedThreadId = this.getScenarioValue("threads.latestClonedThreadId")
    const threadData = await getAgentThreadData(this, clonedThreadId)

    expect(
      threadData.messages.messages.some((entry) => {
        const content = entry.content
        return typeof content === "string" && content.includes(message)
      })
    ).toBe(true)
  }
)

Then(
  "最后创建历史线程的 history 应包含消息 {string}",
  async function (this: JingleWorld, message: string) {
    const threadId = this.getScenarioValue("threads.lastCreatedThreadId")
    const threadData = await getAgentThreadData(this, threadId)

    expect(
      threadData.messages.messages.some((entry) => {
        const content = entry.content
        return typeof content === "string" && content.includes(message)
      })
    ).toBe(true)
  }
)

Then("最后创建历史线程的 history 中待审批请求应为空", async function (this: JingleWorld) {
  const threadId = this.getScenarioValue("threads.lastCreatedThreadId")
  const threadData = await getAgentThreadData(this, threadId)

  expect(threadData.runState.pendingApproval).toBeNull()
})

Then("最后创建历史线程的 runtime state 中 todos 应为空", async function (this: JingleWorld) {
  const threadId = this.getScenarioValue("threads.lastCreatedThreadId")
  const threadData = await getAgentThreadData(this, threadId)

  expect(threadData.runState.todos).toEqual([])
})

Then("最后创建历史线程的 runtime state 中待审批请求应为空", async function (this: JingleWorld) {
  const threadId = this.getScenarioValue("threads.lastCreatedThreadId")
  const threadData = await getAgentThreadData(this, threadId)

  expect(threadData.runState.pendingApproval).toBeNull()
})

Then(
  "最后创建历史线程的 agent thread data 应包含消息 {string} 且 run state 为空",
  async function (this: JingleWorld, message: string) {
    const threadId = this.getScenarioValue("threads.lastCreatedThreadId")
    const threadData = await getAgentThreadData(this, threadId)

    expect(
      threadData.messages.messages.some((entry) => {
        const content = entry.content
        return typeof content === "string" && content.includes(message)
      })
    ).toBe(true)
    expect(threadData.runState.todos).toEqual([])
    expect(threadData.runState.pendingApproval).toBeNull()
  }
)

Then("threads:get 不再返回最新删除线程", async function (this: JingleWorld) {
  const threadId = this.getScenarioValue("threads.latestDeletedThreadId")
  const thread = await getThread(this, threadId)

  expect(thread).toBeNull()
})

Then("threads:list 不再包含最新删除线程", async function (this: JingleWorld) {
  const threadId = this.getScenarioValue("threads.latestDeletedThreadId")
  const threads = await listThreads(this)

  expect(threads.some((thread) => thread.thread_id === threadId)).toBe(false)
})
