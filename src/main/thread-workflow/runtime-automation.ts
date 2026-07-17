import type { AgentThreadEvent } from "@shared/agent-thread-contract"
import type { JingleRuntimeEventBatch } from "@jingle/agent-client"
import type { AgentThreadRunner } from "../agent/agent-thread-runner"
import type { ApplyThreadWorkflowRuntimeTransitionInput } from "../db/thread-workflow"

interface ThreadWorkflowRuntimeTransitionWriter {
  applyRuntimeTransitions(
    inputs: readonly ApplyThreadWorkflowRuntimeTransitionInput[]
  ): Promise<boolean>
}

export interface ThreadWorkflowRuntimeAutomationOptions {
  agentThreadRunner: Pick<AgentThreadRunner, "connectAllThreadEvents">
  workflow: ThreadWorkflowRuntimeTransitionWriter
}

export interface ThreadWorkflowRuntimeAutomationShutdownOptions {
  flushAgentControllerProjections: () => Promise<void>
  shutdownAgentService: () => Promise<void>
  stopAutomation: (() => Promise<void>) | null
}

function workflowStatusKeyForFinishedRun(
  status: Extract<AgentThreadEvent, { type: "run.finished" }>["status"]
): "blocked" | "cancelled" | "review" {
  switch (status) {
    case "completed":
      return "review"
    case "failed":
    case "recovery_required":
      return "blocked"
    case "cancelled":
      return "cancelled"
  }
}

export function resolveThreadWorkflowRuntimeTransition(
  threadId: string,
  event: AgentThreadEvent
): ApplyThreadWorkflowRuntimeTransitionInput | null {
  switch (event.type) {
    case "run.started":
    case "run.resumed":
      return {
        currentGate: null,
        statusKey: "running",
        threadId
      }
    case "approval.requested":
      return {
        currentGate: "approval",
        threadId
      }
    case "approval.cleared":
      return {
        currentGate: null,
        threadId
      }
    case "run.finished":
      return {
        currentGate: null,
        expectedStatusKeys: ["running"],
        statusKey: workflowStatusKeyForFinishedRun(event.status),
        threadId
      }
    default:
      return null
  }
}

export function startThreadWorkflowRuntimeAutomation(
  options: ThreadWorkflowRuntimeAutomationOptions
): () => Promise<void> {
  const queues = new Map<string, Promise<void>>()
  const stopListening = options.agentThreadRunner.connectAllThreadEvents(
    "thread-workflow-runtime-automation",
    (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => {
      const transitions = batch.events
        .map((event) => resolveThreadWorkflowRuntimeTransition(batch.threadId, event))
        .filter(
          (transition): transition is ApplyThreadWorkflowRuntimeTransitionInput =>
            transition !== null
        )
      if (transitions.length === 0) {
        return
      }

      const previous = queues.get(batch.threadId) ?? Promise.resolve()
      const task = previous
        .then(async () => {
          await options.workflow.applyRuntimeTransitions(transitions)
        })
        .catch((error: unknown) => {
          console.error("[ThreadWorkflow] Runtime automation failed.", {
            error,
            threadId: batch.threadId
          })
        })
        .finally(() => {
          if (queues.get(batch.threadId) === task) {
            queues.delete(batch.threadId)
          }
        })
      queues.set(batch.threadId, task)
    }
  )

  return async () => {
    stopListening()
    await Promise.all(queues.values())
  }
}

export async function shutdownAgentServiceBeforeThreadWorkflowAutomation(
  options: ThreadWorkflowRuntimeAutomationShutdownOptions
): Promise<void> {
  try {
    await options.shutdownAgentService()
    await options.flushAgentControllerProjections()
  } finally {
    await options.stopAutomation?.()
  }
}
