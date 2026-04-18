import { After, Given, Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import type { Page } from "playwright"
import type { HITLDecision, ThreadRuntimeState } from "../../../src/shared/app-types"
import type { AgentInvokeMessage } from "../../../src/shared/message-content"
import type { IPCEvent } from "../../../src/types"
import { OpenworkWorld } from "../support/world"

interface AgentThreadSnapshot {
  status: string
  thread_id: string
}

interface AgentBddStream {
  cleanup: (() => void) | null
  events: IPCEvent[]
}

interface AgentBddStore {
  streams: Record<string, AgentBddStream>
}

interface AgentBddWindow extends Window {
  __openworkAgentBdd?: AgentBddStore
  api: {
    agent: {
      cancel: (threadId: string) => Promise<void>
      interrupt: (
        threadId: string,
        decision: HITLDecision,
        onEvent?: (event: IPCEvent) => void
      ) => () => void
      streamAgent: (
        threadId: string,
        message: AgentInvokeMessage,
        command: unknown,
        onEvent: (event: IPCEvent) => void,
        modelId?: string
      ) => () => void
    }
    threads: {
      create: (metadata?: Record<string, unknown>) => Promise<AgentThreadSnapshot>
      get: (threadId: string) => Promise<AgentThreadSnapshot | null>
      getRuntimeState: (threadId: string) => Promise<ThreadRuntimeState>
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

async function getRuntimeState(world: OpenworkWorld): Promise<ThreadRuntimeState> {
  const page = await getLauncherPage(world)
  const threadId = getLatestThreadId(world)

  return page.evaluate(async (inputThreadId) => {
    return (window as unknown as AgentBddWindow).api.threads.getRuntimeState(inputThreadId)
  }, threadId)
}

async function getStreamEvents(world: OpenworkWorld): Promise<IPCEvent[]> {
  const page = await getLauncherPage(world)
  const streamKey = getLatestStreamKey(world)

  return page.evaluate((inputStreamKey) => {
    const store = (window as unknown as AgentBddWindow).__openworkAgentBdd
    return store?.streams[inputStreamKey]?.events ?? []
  }, streamKey)
}

async function waitForStreamEventType(world: OpenworkWorld, type: IPCEvent["type"]): Promise<void> {
  const page = await getLauncherPage(world)
  const streamKey = getLatestStreamKey(world)

  await page.waitForFunction(
    ({ inputStreamKey, expectedType }) => {
      const store = (window as unknown as AgentBddWindow).__openworkAgentBdd
      const events = store?.streams[inputStreamKey]?.events ?? []
      return events.some((event) => event.type === expectedType)
    },
    { expectedType: type, inputStreamKey: streamKey },
    { timeout: 10_000 }
  )
}

async function startStreamAgent(
  world: OpenworkWorld,
  input: {
    command: unknown
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

      const events: IPCEvent[] = []
      const cleanup = targetWindow.api.agent.streamAgent(
        inputThreadId,
        {
          content: message,
          id: `${inputStreamKey}:message`
        },
        command,
        (event) => {
          events.push(event)
        },
        "bdd-scripted-model"
      )

      targetWindow.__openworkAgentBdd.streams[inputStreamKey] = {
        cleanup,
        events
      }
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

async function startInterruptAgent(world: OpenworkWorld, decision: HITLDecision): Promise<void> {
  const page = await getLauncherPage(world)
  const threadId = getLatestThreadId(world)
  const streamKey = `agent:${threadId}:${Date.now()}:${Math.random()}`

  await page.evaluate(
    ({ decision: inputDecision, threadId: inputThreadId, streamKey: inputStreamKey }) => {
      const targetWindow = window as unknown as AgentBddWindow
      targetWindow.__openworkAgentBdd ??= { streams: {} }

      const events: IPCEvent[] = []
      const cleanup = targetWindow.api.agent.interrupt(inputThreadId, inputDecision, (event) => {
        events.push(event)
      })

      targetWindow.__openworkAgentBdd.streams[inputStreamKey] = {
        cleanup,
        events
      }
    },
    {
      decision,
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
          source,
          title: inputTitle,
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

When("我通过 agent interrupt 拒绝最新待审批请求", async function (this: OpenworkWorld) {
  const decision = await getPendingApprovalDecision(this, "reject")

  await startInterruptAgent(this, decision)
})

Then("最新 agent stream 应收到 done", async function (this: OpenworkWorld) {
  await waitForStreamEventType(this, "done")
})

Then("最新 agent stream 不应收到 done", async function (this: OpenworkWorld) {
  const page = await getLauncherPage(this)

  await page.waitForTimeout(250)
  expect((await getStreamEvents(this)).some((event) => event.type === "done")).toBe(false)
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
    .poll(async () => JSON.stringify(await getStreamEvents(this)))
    .toContain("__interrupt__")
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

Then(
  "最新 agent 线程状态应为 {string}",
  async function (this: OpenworkWorld, expectedStatus: string) {
    await expect.poll(async () => getThreadStatus(this)).toBe(expectedStatus)
  }
)
