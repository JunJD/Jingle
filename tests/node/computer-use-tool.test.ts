import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage, ToolMessage } from "@langchain/core/messages"
import { tool } from "langchain"
import { createJingleComputerUseToolsMiddleware } from "@jingle/langchain-agent-harness/transitional"
import type { JingleComputerUseToolContext } from "@jingle/langchain-agent-harness"
import { RuntimeToolExecutionKernel } from "../../packages/langchain-agent-harness/src/harness-runtime/graph/runtime-executors/RuntimeToolExecutionKernel"
import {
  ComputerUseActionLedger,
  ComputerUseResourceScheduler,
  ComputerUseSessionManager,
  ComputerUseTransactionCoordinator,
  type ComputerUseActionAttempt,
  type ComputerUseActionLedgerPort,
  type ComputerUseBackend,
  type ComputerUseObservation
} from "../../packages/computer-use-core/src"
import { z } from "../../src/main/agent/tool-input-schema"

test("Computer Use middleware exposes the semantic state tool contract", async () => {
  const seen: string[] = []
  const signal = new AbortController().signal
  const handler =
    (name: string) => async (input: unknown, context: JingleComputerUseToolContext) => {
      assert.equal(context.runId, "run-1")
      assert.equal(context.threadId, "thread-1")
      assert.equal(context.signal, signal)
      seen.push(`${name}:${String(context.toolCallId)}:${JSON.stringify(input)}`)
      return { ok: name }
    }
  const middleware = createJingleComputerUseToolsMiddleware({
    action: handler("action"),
    allowedApplicationIds: ["com.example.editor"],
    expand: handler("expand"),
    inspect: handler("inspect"),
    observe: handler("observe"),
    search: handler("search")
  })

  const observeTool = middleware.tools?.find(
    (candidate) => candidate.name === "computer_use_observe"
  ) as unknown as {
    schema: { properties: { applicationId: { enum: string[] } } }
  }
  assert.deepEqual(observeTool.schema.properties.applicationId.enum, ["com.example.editor"])

  const actionTool = middleware.tools?.find(
    (candidate) => candidate.name === "computer_use_action"
  ) as unknown as {
    schema: {
      properties: {
        actions: {
          oneOf: Array<{
            items: {
              oneOf?: Array<{
                properties: { keys?: { uniqueItems?: boolean }; ref: { maxLength: number } }
              }>
              properties?: { ref: { maxLength: number } }
            }
          }>
        }
      }
    }
  }
  const actionVariants = actionTool.schema.properties.actions.oneOf
  assert.equal(actionVariants[0]?.items.properties?.ref.maxLength, 1_024)
  assert.equal(actionVariants[1]?.items.oneOf?.[0]?.properties.ref.maxLength, 1_024)
  assert.equal(actionVariants[1]?.items.oneOf?.[3]?.properties.keys?.uniqueItems, true)

  const inspectTool = middleware.tools?.find(
    (candidate) => candidate.name === "computer_use_inspect"
  ) as unknown as {
    schema: { properties: { refs: { items: { maxLength: number }; uniqueItems?: boolean } } }
  }
  assert.equal(inspectTool.schema.properties.refs.items.maxLength, 1_024)
  assert.equal(inspectTool.schema.properties.refs.uniqueItems, true)

  assert.deepEqual(
    middleware.tools?.map((candidate) => candidate.name),
    [
      "computer_use_observe",
      "computer_use_action",
      "computer_use_search",
      "computer_use_expand",
      "computer_use_inspect"
    ]
  )

  const inputs: Record<string, unknown> = {
    computer_use_action: {
      actions: [{ kind: "activate", ref: "@window" }],
      sessionId: "session-1",
      stateId: "state-1"
    },
    computer_use_expand: { sessionId: "session-1", stateId: "state-1" },
    computer_use_inspect: { refs: ["@save"], sessionId: "session-1", stateId: "state-1" },
    computer_use_observe: { applicationId: "com.example.editor" },
    computer_use_search: { query: "save", sessionId: "session-1", stateId: "state-1" }
  }
  for (const [name, input] of Object.entries(inputs)) {
    const candidate = middleware.tools?.find((tool) => tool.name === name)
    assert.ok(candidate)
    await candidate.invoke(
      { args: input, id: `tool-${name}`, name, type: "tool_call" },
      {
        configurable: { run_id: "run-1", thread_id: "thread-1" },
        metadata: { run_id: "run-1", thread_id: "thread-1" },
        signal
      }
    )
  }

  assert.deepEqual(seen.map((entry) => entry.split(":", 1)[0]).sort(), [
    "action",
    "expand",
    "inspect",
    "observe",
    "search"
  ])
})

test("Computer Use middleware rejects activate mixed with another semantic action", async () => {
  let callCount = 0
  const handler = async () => {
    callCount += 1
    return null
  }
  const middleware = createJingleComputerUseToolsMiddleware({
    action: handler,
    allowedApplicationIds: ["com.example.editor"],
    expand: handler,
    inspect: handler,
    observe: handler,
    search: handler
  })
  const action = middleware.tools?.find((candidate) => candidate.name === "computer_use_action")
  assert.ok(action)

  await assert.rejects(
    action.invoke(
      {
        args: {
          actions: [
            { kind: "activate", ref: "@window" },
            { kind: "press", ref: "@save" }
          ],
          sessionId: "session-1",
          stateId: "state-1"
        },
        id: "tool-activate-mixed",
        name: "computer_use_action",
        type: "tool_call"
      },
      {
        configurable: { run_id: "run-1", thread_id: "thread-1" },
        metadata: { run_id: "run-1", thread_id: "thread-1" },
        signal: new AbortController().signal
      }
    ),
    /input did not match/i
  )
  assert.equal(callCount, 0)
})

test("Computer Use activate dispatches foreground through the durable transaction owner", async () => {
  const raw: ComputerUseObservation = {
    application: { id: "com.example.fixture", name: "Fixture" },
    capturedAt: 1,
    elements: [{ actions: ["activate"], index: 0, ref: "@window", role: "window" }],
    epoch: 0,
    resourceKey: "desktop-pid:42",
    sourceTruncated: false,
    stateId: "ignored-by-backend",
    window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" }
  }
  const phases: string[] = []
  const attempts = new Map<string, ComputerUseActionAttempt>()
  const port: ComputerUseActionLedgerPort = {
    read(attemptId) {
      return Promise.resolve(attempts.get(attemptId))
    },
    reserve(attempt) {
      phases.push(attempt.phase)
      attempts.set(attempt.attemptId, attempt)
      return Promise.resolve({ status: "reserved" })
    },
    transition(input) {
      phases.push(input.attempt.phase)
      attempts.set(input.attempt.attemptId, input.attempt)
      return Promise.resolve({ status: "applied" })
    }
  }
  const deliveries: string[] = []
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [
        {
          action: "activate",
          background: "refused",
          foreground: "verified",
          route: "ax_raise_activate"
        }
      ],
      environment: "macos-quartz",
      platform: "macos",
      protocolVersion: 1
    },
    disposeSession() {
      return Promise.resolve()
    },
    execute(request) {
      deliveries.push(request.delivery)
      return Promise.resolve({
        baseStateId: request.base.stateId,
        outcome: "worked",
        steps: [
          {
            action: request.actions[0]!,
            evidence: {
              delivery: "semantic",
              noSideEffectProof: false,
              route: "ax_raise_activate",
              verification: "verified"
            },
            outcome: "worked"
          }
        ]
      })
    },
    identify() {
      return Promise.resolve({
        application: raw.application,
        resourceKey: raw.resourceKey,
        window: raw.window
      })
    },
    observe() {
      const { epoch: _epoch, stateId: _stateId, ...observation } = raw
      return Promise.resolve(observation)
    }
  }
  const sessions = new ComputerUseSessionManager(backend)
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    sessions,
    new ComputerUseActionLedger(port)
  )
  const target = await coordinator.identify({ applicationId: raw.application.id })
  const base = await coordinator.observe({ target })
  await sessions.setEnabled(true)
  const grant = sessions.openSession({ observation: base, runId: "run-1", threadId: "thread-1" })

  const result = await coordinator.execute({
    actions: [{ kind: "activate", ref: "@window" }],
    baseStateId: base.stateId,
    runId: "run-1",
    sessionId: grant.sessionId,
    threadId: "thread-1",
    transactionId: "activate-1"
  })

  assert.deepEqual(deliveries, ["foreground"])
  assert.deepEqual(phases, ["queued", "dispatched", "settled"])
  assert.equal(result.outcome, "worked")
  assert.equal(result.successor?.epoch, 1)
})

test("Computer Use activate rejects a non-root ref before durable admission", async () => {
  const raw: ComputerUseObservation = {
    application: { id: "com.example.fixture", name: "Fixture" },
    capturedAt: 1,
    elements: [
      { actions: ["activate"], index: 0, ref: "@window", role: "window" },
      { actions: ["activate"], index: 1, ref: "@child", role: "group" }
    ],
    epoch: 0,
    resourceKey: "desktop-pid:42",
    sourceTruncated: false,
    stateId: "ignored-by-backend",
    window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" }
  }
  let reserveCount = 0
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [
        {
          action: "activate",
          background: "refused",
          foreground: "verified",
          route: "ax_raise_activate"
        }
      ],
      environment: "macos-quartz",
      platform: "macos",
      protocolVersion: 1
    },
    disposeSession() {
      return Promise.resolve()
    },
    execute() {
      return Promise.reject(new Error("non-root activate must not dispatch"))
    },
    identify() {
      return Promise.resolve({
        application: raw.application,
        resourceKey: raw.resourceKey,
        window: raw.window
      })
    },
    observe() {
      const { epoch: _epoch, stateId: _stateId, ...observation } = raw
      return Promise.resolve(observation)
    }
  }
  const port: ComputerUseActionLedgerPort = {
    read() {
      return Promise.resolve(undefined)
    },
    reserve() {
      reserveCount += 1
      return Promise.resolve({ status: "reserved" })
    },
    transition() {
      throw new Error("non-root activate must not transition")
    }
  }
  const sessions = new ComputerUseSessionManager(backend)
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    sessions,
    new ComputerUseActionLedger(port)
  )
  const target = await coordinator.identify({ applicationId: raw.application.id })
  const base = await coordinator.observe({ target })
  await sessions.setEnabled(true)
  const grant = sessions.openSession({ observation: base, runId: "run-1", threadId: "thread-1" })

  await assert.rejects(
    coordinator.execute({
      actions: [{ kind: "activate", ref: "@child" }],
      baseStateId: base.stateId,
      runId: "run-1",
      sessionId: grant.sessionId,
      threadId: "thread-1",
      transactionId: "activate-child"
    }),
    /current window root/
  )
  assert.equal(reserveCount, 0)
})

test("Computer Use middleware requires a complete live run context", async () => {
  let callCount = 0
  const handler = async () => {
    callCount += 1
    return null
  }
  const middleware = createJingleComputerUseToolsMiddleware({
    action: handler,
    allowedApplicationIds: ["com.example.editor"],
    expand: handler,
    inspect: handler,
    observe: handler,
    search: handler
  })
  const observe = middleware.tools?.find((tool) => tool.name === "computer_use_observe")
  assert.ok(observe)

  await assert.rejects(observe.invoke({ applicationId: "com.example.editor" }), /caller lease/i)
  const controller = new AbortController()
  controller.abort(new DOMException("Stopped", "AbortError"))
  await assert.rejects(
    observe.invoke(
      {
        args: { applicationId: "com.example.editor" },
        id: "tool-observe",
        name: "computer_use_observe",
        type: "tool_call"
      },
      {
        configurable: { run_id: "run-1", thread_id: "thread-1" },
        metadata: { run_id: "run-1", thread_id: "thread-1" },
        signal: controller.signal
      }
    ),
    /Stopped/
  )
  assert.equal(callCount, 0)
})

test("tool execution kernel marks Computer Use failures as errors", async () => {
  const failingTool = tool(
    async () => {
      throw new Error("native dispatch unavailable")
    },
    {
      description: "Computer Use failure fixture",
      name: "computer_use_observe",
      schema: z.object({})
    }
  )
  const kernel = new RuntimeToolExecutionKernel([failingTool])
  const result = (await kernel.invoke([
    new AIMessage({
      content: "",
      tool_calls: [
        {
          args: {},
          id: "tool-computer-use-failure",
          name: "computer_use_observe",
          type: "tool_call"
        }
      ]
    })
  ])) as ToolMessage[]

  assert.equal(result.length, 1)
  assert.equal(result[0].status, "error")
  assert.match(String(result[0].content), /native dispatch unavailable/)
})
