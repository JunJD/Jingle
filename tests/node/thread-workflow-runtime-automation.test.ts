import assert from "node:assert/strict"
import test from "node:test"
import type { AgentThreadEvent } from "../../src/shared/agent-thread-contract"
import type { JingleRuntimeEventBatch } from "@jingle/agent-client"
import {
  resolveThreadWorkflowRuntimeTransition,
  shutdownAgentServiceBeforeThreadWorkflowAutomation,
  startThreadWorkflowRuntimeAutomation
} from "../../src/main/thread-workflow/runtime-automation"

test("workflow automation maps agent lifecycle facts without making runtime the status owner", () => {
  const run = {
    assistantMessageId: null,
    currentToolCallId: null,
    phase: "thinking",
    phaseStartedAt: new Date(),
    runId: "run-1",
    startedAt: new Date(),
    status: "running",
    threadId: "thread-1",
    toolCalls: [],
    turnId: "turn-1",
    userMessageId: "turn-1"
  } as Extract<AgentThreadEvent, { type: "run.started" }>["run"]

  assert.deepEqual(
    resolveThreadWorkflowRuntimeTransition("thread-1", {
      revision: 1,
      run,
      type: "run.started"
    }),
    {
      currentGate: null,
      statusKey: "running",
      threadId: "thread-1"
    }
  )
  assert.deepEqual(
    resolveThreadWorkflowRuntimeTransition("thread-1", {
      completedAt: new Date(),
      durationMs: 10,
      error: null,
      revision: 2,
      runId: "run-1",
      status: "completed",
      type: "run.finished"
    }),
    {
      currentGate: null,
      expectedStatusKeys: ["running"],
      statusKey: "review",
      threadId: "thread-1"
    }
  )
})

test("workflow automation serializes one thread batch through the workflow service owner", async () => {
  let listener: ((batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void) | null = null
  let stopped = false
  const transitions: Array<{ currentGate: string | null; statusKey?: string }> = []

  const stop = startThreadWorkflowRuntimeAutomation({
    agentThreadRunner: {
      connectAllThreadEvents: (_subscriberId, nextListener) => {
        listener = nextListener
        return () => {
          stopped = true
        }
      }
    },
    workflow: {
      applyRuntimeTransitions: async (batch) => {
        transitions.push(
          ...batch.map((transition) => ({
            currentGate: transition.currentGate,
            ...(transition.statusKey ? { statusKey: transition.statusKey } : {})
          }))
        )
        return true
      }
    }
  })

  assert.ok(listener)
  const emit = listener as (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void
  emit({
    events: [
      {
        approval: {
          allowed_decisions: ["approve", "reject"],
          id: "approval-1",
          review: null,
          tool_call: {
            args: {},
            id: "tool-1",
            name: "write_file"
          }
        },
        requestedAt: new Date(),
        revision: 1,
        runId: "run-1",
        type: "approval.requested"
      },
      {
        completedAt: new Date(),
        durationMs: 10,
        error: null,
        revision: 2,
        runId: "run-1",
        status: "cancelled",
        type: "run.finished"
      }
    ],
    latestRevision: 2,
    threadId: "thread-1"
  })

  await stop()
  assert.equal(stopped, true)
  assert.deepEqual(transitions, [
    { currentGate: "approval" },
    { currentGate: null, statusKey: "cancelled" }
  ])
})

test("workflow automation preserves event order across concurrent batches for one thread", async () => {
  let listener: ((batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void) | null = null
  let releaseFirstTransition!: () => void
  let markFirstTransitionStarted!: () => void
  const firstTransitionStarted = new Promise<void>((resolve) => {
    markFirstTransitionStarted = resolve
  })
  const firstTransitionBlocked = new Promise<void>((resolve) => {
    releaseFirstTransition = resolve
  })
  const transitions: string[] = []

  const stop = startThreadWorkflowRuntimeAutomation({
    agentThreadRunner: {
      connectAllThreadEvents: (_subscriberId, nextListener) => {
        listener = nextListener
        return () => undefined
      }
    },
    workflow: {
      applyRuntimeTransitions: async (batch) => {
        const transition = batch[0]
        assert.ok(transition)
        const value = transition.statusKey ?? transition.currentGate ?? "cleared"
        transitions.push(`start:${value}`)
        if (transitions.length === 1) {
          markFirstTransitionStarted()
          await firstTransitionBlocked
        }
        transitions.push(`finish:${value}`)
        return true
      }
    }
  })

  assert.ok(listener)
  const emit = listener as (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void
  emit({
    events: [
      {
        approval: {
          allowed_decisions: ["approve", "reject"],
          id: "approval-1",
          review: null,
          tool_call: {
            args: {},
            id: "tool-1",
            name: "write_file"
          }
        },
        requestedAt: new Date(),
        revision: 1,
        runId: "run-1",
        type: "approval.requested"
      }
    ],
    latestRevision: 1,
    threadId: "thread-1"
  })
  await firstTransitionStarted

  emit({
    events: [
      {
        completedAt: new Date(),
        durationMs: 10,
        error: null,
        revision: 2,
        runId: "run-1",
        status: "cancelled",
        type: "run.finished"
      }
    ],
    latestRevision: 2,
    threadId: "thread-1"
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(transitions, ["start:approval"])

  releaseFirstTransition()
  await stop()
  assert.deepEqual(transitions, [
    "start:approval",
    "finish:approval",
    "start:cancelled",
    "finish:cancelled"
  ])
})

test("application shutdown keeps workflow automation connected through active run cancellation", async () => {
  let listener: ((batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void) | null = null
  let stopped = false
  const shutdownOrder: string[] = []
  const transitions: string[] = []
  const stopAutomation = startThreadWorkflowRuntimeAutomation({
    agentThreadRunner: {
      connectAllThreadEvents: (_subscriberId, nextListener) => {
        listener = nextListener
        return () => {
          stopped = true
          shutdownOrder.push("automation")
        }
      }
    },
    workflow: {
      applyRuntimeTransitions: async (batch) => {
        transitions.push(...batch.map((transition) => transition.statusKey ?? "unchanged"))
        return true
      }
    }
  })

  assert.ok(listener)
  const emit = listener as (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void
  emit({
    events: [
      {
        revision: 1,
        run: {
          assistantMessageId: null,
          currentToolCallId: null,
          phase: "thinking",
          phaseStartedAt: new Date(),
          runId: "run-quit",
          startedAt: new Date(),
          status: "running",
          threadId: "thread-quit",
          toolCalls: [],
          turnId: "turn-quit",
          userMessageId: "turn-quit"
        },
        type: "run.started"
      }
    ],
    latestRevision: 1,
    threadId: "thread-quit"
  })

  await shutdownAgentServiceBeforeThreadWorkflowAutomation({
    flushAgentControllerProjections: async () => {
      assert.equal(stopped, false)
      shutdownOrder.push("projection")
      emit({
        events: [
          {
            completedAt: new Date(),
            durationMs: 10,
            error: null,
            revision: 2,
            runId: "run-quit",
            status: "cancelled",
            type: "run.finished"
          }
        ],
        latestRevision: 2,
        threadId: "thread-quit"
      })
    },
    shutdownAgentService: async () => {
      assert.equal(stopped, false)
      shutdownOrder.push("agent")
    },
    stopAutomation
  })

  assert.equal(stopped, true)
  assert.deepEqual(shutdownOrder, ["agent", "projection", "automation"])
  assert.deepEqual(transitions, ["running", "cancelled"])
})
