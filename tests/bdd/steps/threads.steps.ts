import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type { ThreadHistoryState, ThreadRuntimeState } from "../../../src/shared/app-types"
import { OpenworkWorld } from "../support/world"

type ThreadSnapshot = {
  metadata?: Record<string, unknown>
  thread_id: string
  title?: string
}

async function createThread(
  world: OpenworkWorld,
  metadata?: Record<string, unknown>
): Promise<ThreadSnapshot> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (input) => {
    return (window as typeof window & { api: { threads: { create: (metadata?: Record<string, unknown>) => Promise<ThreadSnapshot> } } }).api.threads.create(input)
  }, metadata)
}

async function cloneThread(world: OpenworkWorld, threadId: string): Promise<ThreadSnapshot> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputThreadId) => {
    return (window as typeof window & { api: { threads: { clone: (threadId: string) => Promise<ThreadSnapshot> } } }).api.threads.clone(inputThreadId)
  }, threadId)
}

async function getThread(world: OpenworkWorld, threadId: string): Promise<ThreadSnapshot | null> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputThreadId) => {
    return (window as typeof window & { api: { threads: { get: (threadId: string) => Promise<ThreadSnapshot | null> } } }).api.threads.get(inputThreadId)
  }, threadId)
}

async function listThreads(world: OpenworkWorld): Promise<ThreadSnapshot[]> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async () => {
    return (window as typeof window & { api: { threads: { list: () => Promise<ThreadSnapshot[]> } } }).api.threads.list()
  })
}

async function deleteThread(world: OpenworkWorld, threadId: string): Promise<void> {
  const page = await world.getPageByKind("launcher")

  await page.evaluate(async (inputThreadId) => {
    await (window as typeof window & { api: { threads: { delete: (threadId: string) => Promise<void> } } }).api.threads.delete(inputThreadId)
  }, threadId)
}

async function getThreadHistory(world: OpenworkWorld, threadId: string): Promise<ThreadHistoryState> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputThreadId) => {
    return (window as typeof window & { api: { threads: { getHistory: (threadId: string) => Promise<ThreadHistoryState> } } }).api.threads.getHistory(inputThreadId)
  }, threadId)
}

async function getThreadRuntimeState(
  world: OpenworkWorld,
  threadId: string
): Promise<ThreadRuntimeState> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputThreadId) => {
    return (window as typeof window & { api: { threads: { getRuntimeState: (threadId: string) => Promise<ThreadRuntimeState> } } }).api.threads.getRuntimeState(inputThreadId)
  }, threadId)
}

async function setGlobalWorkspace(world: OpenworkWorld, workspacePath: string): Promise<string | null> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputPath) => {
    return (window as typeof window & { api: { workspace: { set: (threadId: string | undefined, path: string | null) => Promise<string | null> } } }).api.workspace.set(undefined, inputPath)
  }, workspacePath)
}

When(
  "我把全局 workspace 设置为测试目录 {string}",
  async function (this: OpenworkWorld, directoryName: string) {
    const workspacePath = join(this.getOpenworkHome(), directoryName)
    mkdirSync(workspacePath, { recursive: true })

    const actualWorkspacePath = await setGlobalWorkspace(this, workspacePath)

    expect(actualWorkspacePath).toBe(workspacePath)
    this.setScenarioValue("threads.currentWorkspacePath", workspacePath)
  }
)

When(
  "我通过 threads API 创建标题为 {string} 且来源为 {string}",
  async function (this: OpenworkWorld, title: string, source: string) {
    const thread = await createThread(this, {
      source,
      title
    })

    this.setScenarioValue("threads.latestThreadId", thread.thread_id)
  }
)

When("我克隆最后创建的历史线程", async function (this: OpenworkWorld) {
  const sourceThreadId = this.getScenarioValue("threads.lastCreatedThreadId")
  const clonedThread = await cloneThread(this, sourceThreadId)

  this.setScenarioValue("threads.latestClonedThreadId", clonedThread.thread_id)
  this.setScenarioValue("threads.latestThreadId", clonedThread.thread_id)
})

When("我删除最新创建的线程", async function (this: OpenworkWorld) {
  const threadId = this.getScenarioValue("threads.latestThreadId")

  await deleteThread(this, threadId)
  this.setScenarioValue("threads.latestDeletedThreadId", threadId)
})

Then("最新创建线程标题应为 {string}", async function (this: OpenworkWorld, title: string) {
  const threadId = this.getScenarioValue("threads.latestThreadId")
  const thread = await getThread(this, threadId)

  expect(thread?.title).toBe(title)
})

Then(
  "最新创建线程 metadata.source 应为 {string}",
  async function (this: OpenworkWorld, source: string) {
    const threadId = this.getScenarioValue("threads.latestThreadId")
    const thread = await getThread(this, threadId)

    expect(thread?.metadata?.source).toBe(source)
  }
)

Then(
  "最新创建线程 metadata.workspacePath 应为当前全局 workspace",
  async function (this: OpenworkWorld) {
    const threadId = this.getScenarioValue("threads.latestThreadId")
    const expectedWorkspacePath = this.getScenarioValue("threads.currentWorkspacePath")
    const thread = await getThread(this, threadId)

    expect(thread?.metadata?.workspacePath).toBe(expectedWorkspacePath)
  }
)

Then("最新创建线程 metadata.model 应为非空字符串", async function (this: OpenworkWorld) {
  const threadId = this.getScenarioValue("threads.latestThreadId")
  const thread = await getThread(this, threadId)
  const model = thread?.metadata?.model

  expect(typeof model).toBe("string")
  expect((model as string).length).toBeGreaterThan(0)
})

Then("threads:list 包含最新创建线程", async function (this: OpenworkWorld) {
  const threadId = this.getScenarioValue("threads.latestThreadId")
  const threads = await listThreads(this)

  expect(threads.some((thread) => thread.thread_id === threadId)).toBe(true)
})

Then("新克隆线程与源线程 ID 不同", async function (this: OpenworkWorld) {
  const sourceThreadId = this.getScenarioValue("threads.lastCreatedThreadId")
  const clonedThreadId = this.getScenarioValue("threads.latestClonedThreadId")

  expect(clonedThreadId).not.toBe(sourceThreadId)
})

Then("新克隆线程标题应为 {string}", async function (this: OpenworkWorld, title: string) {
  const clonedThreadId = this.getScenarioValue("threads.latestClonedThreadId")
  const thread = await getThread(this, clonedThreadId)

  expect(thread?.title).toBe(title)
})

Then(
  "新克隆线程的 history 应包含消息 {string}",
  async function (this: OpenworkWorld, message: string) {
    const clonedThreadId = this.getScenarioValue("threads.latestClonedThreadId")
    const history = await getThreadHistory(this, clonedThreadId)

    expect(history.messages.some((entry) => {
      const content = entry.content
      return typeof content === "string" && content.includes(message)
    })).toBe(true)
  }
)

Then(
  "最后创建历史线程的 history 应包含消息 {string}",
  async function (this: OpenworkWorld, message: string) {
    const threadId = this.getScenarioValue("threads.lastCreatedThreadId")
    const history = await getThreadHistory(this, threadId)

    expect(history.messages.some((entry) => {
      const content = entry.content
      return typeof content === "string" && content.includes(message)
    })).toBe(true)
  }
)

Then(
  "最后创建历史线程的 history 中待审批请求应为空",
  async function (this: OpenworkWorld) {
    const threadId = this.getScenarioValue("threads.lastCreatedThreadId")
    const history = await getThreadHistory(this, threadId)

    expect(history.pendingApproval).toBeNull()
  }
)

Then(
  "最后创建历史线程的 runtime state 中 todos 应为空",
  async function (this: OpenworkWorld) {
    const threadId = this.getScenarioValue("threads.lastCreatedThreadId")
    const runtimeState = await getThreadRuntimeState(this, threadId)

    expect(runtimeState.todos).toEqual([])
  }
)

Then(
  "最后创建历史线程的 runtime state 中待审批请求应为空",
  async function (this: OpenworkWorld) {
    const threadId = this.getScenarioValue("threads.lastCreatedThreadId")
    const runtimeState = await getThreadRuntimeState(this, threadId)

    expect(runtimeState.pendingApproval).toBeNull()
  }
)

Then("threads:get 不再返回最新删除线程", async function (this: OpenworkWorld) {
  const threadId = this.getScenarioValue("threads.latestDeletedThreadId")
  const thread = await getThread(this, threadId)

  expect(thread).toBeNull()
})

Then("threads:list 不再包含最新删除线程", async function (this: OpenworkWorld) {
  const threadId = this.getScenarioValue("threads.latestDeletedThreadId")
  const threads = await listThreads(this)

  expect(threads.some((thread) => thread.thread_id === threadId)).toBe(false)
})
