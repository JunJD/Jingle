import assert from "node:assert/strict"
import test from "node:test"
import {
  buildAgentConnectThreadEventsIpcPayload,
  buildAgentDisconnectThreadEventsIpcPayload,
  buildAgentInvokeIpcPayload,
  buildAgentResumeIpcPayload
} from "../../src/preload/api/agent-payload"
import { createAgentThreadEventsApi } from "../../src/preload/api/agent-thread-events"

test("agent invoke IPC payload omits optional undefined fields", () => {
  const payload = buildAgentInvokeIpcPayload({
    followUpAction: undefined,
    message: {
      content: "没理解",
      id: "message-1"
    },
    modelId: "deepseek:deepseek-v4-pro",
    permissionMode: "ask-to-edit",
    temporaryMode: false,
    threadId: "thread-1"
  })

  assert.deepEqual(payload, {
    message: {
      content: "没理解",
      id: "message-1"
    },
    modelId: "deepseek:deepseek-v4-pro",
    permissionMode: "ask-to-edit",
    temporaryMode: false,
    threadId: "thread-1"
  })
  assert.equal(Object.hasOwn(payload, "followUpAction"), false)
  assert.equal(Object.hasOwn(payload, "expectedRunId"), false)
  assert.equal(Object.hasOwn(payload, "expectedTurnId"), false)
})

test("agent invoke IPC payload preserves follow-up steering identity", () => {
  assert.deepEqual(
    buildAgentInvokeIpcPayload({
      expectedRunId: "run-1",
      expectedTurnId: "turn-1",
      followUpAction: "steer",
      message: {
        content: "continue",
        id: "message-1"
      },
      threadId: "thread-1"
    }),
    {
      expectedRunId: "run-1",
      expectedTurnId: "turn-1",
      followUpAction: "steer",
      message: {
        content: "continue",
        id: "message-1"
      },
      threadId: "thread-1"
    }
  )
})

test("agent preload payload builders omit optional undefined route fields", () => {
  assert.deepEqual(
    buildAgentResumeIpcPayload({
      decision: {
        request_id: "request-1",
        tool_call_id: undefined,
        type: "approve"
      },
      modelId: undefined,
      threadId: "thread-1"
    }),
    {
      decision: {
        request_id: "request-1",
        tool_call_id: undefined,
        type: "approve"
      },
      threadId: "thread-1"
    }
  )

  assert.deepEqual(buildAgentConnectThreadEventsIpcPayload("thread-1", {}), {
    threadId: "thread-1"
  })
  assert.deepEqual(buildAgentDisconnectThreadEventsIpcPayload("thread-1", "subscription-1"), {
    subscriptionToken: "subscription-1",
    threadId: "thread-1"
  })
})

test("agent preload stale cleanup cannot disconnect a newer thread event subscription", async () => {
  let releaseFirstConnect!: () => void
  const firstConnectGate = new Promise<void>((resolve) => {
    releaseFirstConnect = resolve
  })
  let connectCount = 0
  let currentMainToken: string | null = null
  const disconnectedTokens: string[] = []
  const api = createAgentThreadEventsApi({
    connect: async () => {
      connectCount += 1
      const subscriptionToken = `subscription-${connectCount}`
      currentMainToken = subscriptionToken
      if (connectCount === 1) {
        await firstConnectGate
      }
      return { subscriptionToken }
    },
    disconnect: async (_threadId, subscriptionToken) => {
      disconnectedTokens.push(subscriptionToken)
      if (currentMainToken === subscriptionToken) {
        currentMainToken = null
      }
    },
    listen: () => () => {},
    reportError: () => {}
  })

  const first = api.connectThreadEvents("thread-1", () => {})
  first()
  const second = api.connectThreadEvents("thread-1", () => {})
  await second.ready
  assert.equal(currentMainToken, "subscription-2")

  releaseFirstConnect()
  await first.ready
  assert.deepEqual(disconnectedTokens, ["subscription-1"])
  assert.equal(currentMainToken, "subscription-2")

  second()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(disconnectedTokens, ["subscription-1", "subscription-2"])
  assert.equal(currentMainToken, null)
})

test("agent preload rejects malformed thread event subscription results", async () => {
  const api = createAgentThreadEventsApi({
    connect: async () => ({}),
    disconnect: async () => {},
    listen: () => () => {},
    reportError: () => {}
  })

  const subscription = api.connectThreadEvents("thread-1", () => {})
  await assert.rejects(subscription.ready, /subscription result is invalid/)
  subscription()
})

test("agent preload retries cleanup when a pending replay restores the prior subscription", async () => {
  let releaseReplay!: () => void
  const replayGate = new Promise<void>((resolve) => {
    releaseReplay = resolve
  })
  let connectCount = 0
  let currentMainToken: string | null = null
  const disconnectedTokens: string[] = []
  const api = createAgentThreadEventsApi({
    connect: async () => {
      connectCount += 1
      if (connectCount === 1) {
        currentMainToken = "subscription-1"
        return { subscriptionToken: "subscription-1" }
      }

      currentMainToken = "subscription-2"
      await replayGate
      currentMainToken = "subscription-1"
      throw new Error("replay failed")
    },
    disconnect: async (_threadId, subscriptionToken) => {
      disconnectedTokens.push(subscriptionToken)
      if (currentMainToken === subscriptionToken) {
        currentMainToken = null
      }
    },
    listen: () => () => {},
    reportError: () => {}
  })

  const subscription = api.connectThreadEvents("thread-1", () => {})
  await subscription.ready
  const replay = api.replayThreadEvents("thread-1")
  subscription()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(currentMainToken, "subscription-2")

  releaseReplay()
  await assert.rejects(replay, /replay failed/)
  assert.deepEqual(disconnectedTokens, ["subscription-1", "subscription-1"])
  assert.equal(currentMainToken, null)
})
