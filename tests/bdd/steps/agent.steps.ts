import { After, Given, Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import type { Page } from "playwright"
import type { AgentThreadEventBatch } from "../../../src/shared/agent-thread-runtime"
import type { AgentThreadDataSnapshot, HITLDecision } from "../../../src/shared/app-types"
import type { AgentInvokeMessage } from "../../../src/shared/message-content"
import { OpenworkWorld } from "../support/world"

interface AgentThreadSummary {
  status: string
  thread_id: string
}

interface AgentBddStream {
  cleanup: (() => void) | null
  events: AgentThreadEventBatch[]
}

interface AgentBddStore {
  streams: Record<string, AgentBddStream>
}

interface AgentBddWindow extends Window {
  __openworkAgentBdd?: AgentBddStore
  api: {
    agent: {
      cancel: (threadId: string) => Promise<void>
      invoke: (threadId: string, message: AgentInvokeMessage, modelId?: string) => void
      resume: (threadId: string, decision: HITLDecision, modelId?: string) => void
      connectThreadEvents: (threadId: string, onBatch: (batch: AgentThreadEventBatch) => void) => () => void
    }
    threads: {
      create: (input?: {
        metadata?: Record<string, unknown>
        workspacePath?: string | null
      }) => Promise<AgentThreadSummary>
      get: (threadId: string) => Promise<AgentThreadSummary | null>
      getAgentThreadData: (threadId: string) => Promise<AgentThreadDataSnapshot>
    }
  }
}

function getLatestThreadId(world: OpenworkWorld): string {
  return world.getScenarioValue("agent.latestThreadId")
}

function getLatestStreamKey(world: OpenworkWorld): string {
  return world.getScenarioValue("agent.latestStreamKey")
}

async function getLauncherPage(world: OpenworkWorld): Promise<Page> {
  return world.getPageByKind("launcher")
}

async function getThreadStatus(world: OpenworkWorld): Promise<string | null> {
  const page = await getLauncherPage(world)
  const threadId = getLatestThreadId(world)

  return page.evaluate(async (inputThreadId) => {
    const thread = await (window as unknown as AgentBddWindow).api.threads.get(inputThreadId)
    return thread?.status ?? null
  }, threadId)
}

async function getRuntimeState(
  world: OpenworkWorld
): Promise<AgentThreadDataSnapshot["runState"]> {
  const threadData = await getAgentThreadData(world)
  return threadData.runState
}

async function getAgentThreadData(world: OpenworkWorld): Promise<AgentThreadDataSnapshot> {
  const page = await getLauncherPage(world)
  const threadId = getLatestThreadId(world)

  return page.evaluate(async (inputThreadId) => {
    return (window as unknown as AgentBddWindow).api.threads.getAgentThreadData(inputThreadId)
  }, threadId)
}

async function getStreamEvents(world: OpenworkWorld): Promise<AgentThreadEventBatch[]> {
  const page = await getLauncherPage(world)
  const streamKey = getLatestStreamKey(world)

  return page.evaluate((inputStreamKey) => {
    const store = (window as unknown as AgentBddWindow).__openworkAgentBdd
    return store?.streams[inputStreamKey]?.events ?? []
  }, streamKey)
}

function getLatestStreamPendingApprovalId(events: AgentThreadEventBatch[]): string | null {
  return (
    events
      .flatMap((batch) => batch.events)
      .map((event) => (event.type === "approval.requested" ? event.approval.id : null))
      .filter((requestId): requestId is string => typeof requestId === "string")
      .at(-1) ?? null
  )
}

async function waitForStreamEventType(world: OpenworkWorld, type: string): Promise<void> {
  const page = await getLauncherPage(world)
  const streamKey = getLatestStreamKey(world)

  await page.waitForFunction(
    ({ inputStreamKey, expectedType }) => {
      const store = (window as unknown as AgentBddWindow).__openworkAgentBdd
      const events = store?.streams[inputStreamKey]?.events ?? []
      return events.some((batch) => batch.events.some((event) => event.type === expectedType))
    },
    { expectedType: type, inputStreamKey: streamKey },
    { timeout: 10_000 }
  )
}

async function startStreamAgent(
  world: OpenworkWorld,
  input: {
    command: { resume: HITLDecision } | null
    message: string
  }
): Promise<void> {
  const page = await getLauncherPage(world)
  const threadId = getLatestThreadId(world)
  const streamKey = `agent:${threadId}:${Date.now()}:${Math.random()}`

  await page.evaluate(
    ({ command, message, threadId: inputThreadId, streamKey: inputStreamKey }) => {
      const targetWindow = window as unknown as AgentBddWindow
      targetWindow.__openworkAgentBdd ??= { streams: {} }

      const events: AgentThreadEventBatch[] = []
      const cleanup = targetWindow.api.agent.connectThreadEvents(inputThreadId, (batch) => {
        events.push(batch)
      })

      targetWindow.__openworkAgentBdd.streams[inputStreamKey] = {
        cleanup,
        events
      }

      if (command?.resume) {
        targetWindow.api.agent.resume(inputThreadId, command.resume, "bdd-scripted-model")
        return
      }

      targetWindow.api.agent.invoke(
        inputThreadId,
        {
          content: message,
          id: `${inputStreamKey}:message`
        },
        "bdd-scripted-model"
      )
    },
    {
      command: input.command,
      message: input.message,
      streamKey,
      threadId
    }
  )

  world.setScenarioValue("agent.latestStreamKey", streamKey)
}

async function getPendingApprovalDecision(
  world: OpenworkWorld,
  type: HITLDecision["type"]
): Promise<HITLDecision> {
  const runtimeState = await getRuntimeState(world)
  const request = runtimeState.pendingApproval

  expect(request).not.toBeNull()

  return {
    request_id: request!.id,
    tool_call_id: request!.tool_call.id,
    type
  }
}

After(async function (this: OpenworkWorld) {
  try {
    const page = await getLauncherPage(this)
    await page.evaluate(() => {
      const store = (window as unknown as AgentBddWindow).__openworkAgentBdd
      if (!store) {
        return
      }

      for (const stream of Object.values(store.streams)) {
        stream.cleanup?.()
      }

      delete (window as unknown as AgentBddWindow).__openworkAgentBdd
    })
  } catch {
    // The app-level After hook may already have closed the Electron page.
  }
})

Given("Openwork 桌面应用已使用脚本化 agent runtime 启动", async function (this: OpenworkWorld) {
  this.useScriptedAgentRuntime()
  await this.launchApp()
})

When(
  "我通过 agent API 创建可运行测试线程 {string}",
  async function (this: OpenworkWorld, title: string) {
    const page = await getLauncherPage(this)
    const workspacePath = join(this.getOpenworkHome(), "agent-workspace", title)
    mkdirSync(workspacePath, { recursive: true })

    const thread = await page.evaluate(
      async ({ source, title: inputTitle, workspacePath: inputWorkspacePath }) => {
        return (window as unknown as AgentBddWindow).api.threads.create({
          metadata: {
            source,
            title: inputTitle
          },
          workspacePath: inputWorkspacePath
        })
      },
      {
        source: "bdd-agent",
        title,
        workspacePath
      }
    )

    this.setScenarioValue("agent.latestThreadId", thread.thread_id)
    this.setScenarioValue("agent.latestWorkspacePath", workspacePath)
  }
)

When(
  "我对最新 agent 线程发送脚本消息 {string}",
  async function (this: OpenworkWorld, message: string) {
    await startStreamAgent(this, {
      command: null,
      message
    })
  }
)

When("我取消最新 agent 线程", async function (this: OpenworkWorld) {
  const page = await getLauncherPage(this)
  const threadId = getLatestThreadId(this)

  await page.evaluate(async (inputThreadId) => {
    await (window as unknown as AgentBddWindow).api.agent.cancel(inputThreadId)
  }, threadId)
})

When("我通过 agent resume 批准最新待审批请求", async function (this: OpenworkWorld) {
  const decision = await getPendingApprovalDecision(this, "approve")

  await startStreamAgent(this, {
    command: { resume: decision },
    message: ""
  })
})

When("我通过 agent resume 拒绝最新待审批请求", async function (this: OpenworkWorld) {
  const decision = await getPendingApprovalDecision(this, "reject")
  await startStreamAgent(this, {
    command: { resume: decision },
    message: ""
  })
})

Then("最新 agent stream 应收到 done", async function (this: OpenworkWorld) {
  await waitForStreamEventType(this, "run.finished")
})

Then("最新 agent stream 不应收到 done", async function (this: OpenworkWorld) {
  const page = await getLauncherPage(this)

  await page.waitForTimeout(250)
  expect(
    (await getStreamEvents(this)).some((batch) =>
      batch.events.some((event) => event.type === "run.finished")
    )
  ).toBe(false)
})

Then("最新 agent stream 应收到取消完成事件", async function (this: OpenworkWorld) {
  await expect
    .poll(async () =>
      (await getStreamEvents(this)).some((batch) =>
        batch.events.some((event) => {
          if (event.type !== "run.finished") {
            return false
          }

          return event.status === "cancelled"
        })
      )
    )
    .toBe(true)
})

Then(
  "最新 agent stream 应包含文本 {string}",
  async function (this: OpenworkWorld, expectedText: string) {
    await expect
      .poll(async () => JSON.stringify(await getStreamEvents(this)))
      .toContain(expectedText)
  }
)

Then("最新 agent stream 应进入长任务", async function (this: OpenworkWorld) {
  await expect
    .poll(async () => JSON.stringify(await getStreamEvents(this)))
    .toContain("scripted agent long task started")
})

Then("最新 agent stream 应收到 HITL 中断", async function (this: OpenworkWorld) {
  await expect
    .poll(async () =>
      (await getStreamEvents(this)).some((batch) =>
        batch.events.some((event) => event.type === "approval.requested")
      )
    )
    .toBe(true)
})

Then("最新 agent stream HITL 请求 id 应与 runtime state 一致", async function (this: OpenworkWorld) {
  await expect
    .poll(async () => {
      const [runtimeState, streamEvents] = await Promise.all([getRuntimeState(this), getStreamEvents(this)])
      const streamRequestId = getLatestStreamPendingApprovalId(streamEvents)

      return {
        runtimeRequestId: runtimeState.pendingApproval?.id ?? null,
        streamRequestId
      }
    })
    .toEqual({
      runtimeRequestId: expect.any(String),
      streamRequestId: expect.any(String)
    })

  await expect
    .poll(async () => {
      const [runtimeState, streamEvents] = await Promise.all([getRuntimeState(this), getStreamEvents(this)])
      const streamRequestId = getLatestStreamPendingApprovalId(streamEvents)

      return streamRequestId === (runtimeState.pendingApproval?.id ?? null)
    })
    .toBe(true)
})

Then(
  "最新 agent runtime state 待审批工具应为 {string}",
  async function (this: OpenworkWorld, toolName: string) {
    await expect
      .poll(async () => (await getRuntimeState(this)).pendingApproval?.tool_call.name ?? null)
      .toBe(toolName)
  }
)

Then("最新 agent runtime state 待审批请求应为空", async function (this: OpenworkWorld) {
  await expect.poll(async () => (await getRuntimeState(this)).pendingApproval).toBeNull()
})

Then("最新 agent thread data 消息数应为 {int}", async function (this: OpenworkWorld, expectedCount: number) {
  await expect.poll(async () => (await getAgentThreadData(this)).messages.messages.length).toBe(expectedCount)
})

Then(
  "最新 agent thread data 应包含 {int} 条用户消息和 {int} 条助手消息",
  async function (this: OpenworkWorld, expectedUserCount: number, expectedAssistantCount: number) {
    await expect
      .poll(async () => {
        const messages = (await getAgentThreadData(this)).messages.messages
        return {
          assistant: messages.filter((message) => message.role === "assistant").length,
          user: messages.filter((message) => message.role === "user").length
        }
      })
      .toEqual({
        assistant: expectedAssistantCount,
        user: expectedUserCount
      })
  }
)

Then(
  "最新 agent 线程状态应为 {string}",
  async function (this: OpenworkWorld, expectedStatus: string) {
    await expect.poll(async () => getThreadStatus(this)).toBe(expectedStatus)
  }
)
