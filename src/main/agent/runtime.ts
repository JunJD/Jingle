import { runtimeUsesCheckpointPersistence } from "../checkpointer/runtime-checkpointer-manager"
import { createBddAgentRuntime } from "./bdd-runtime"
import {
  createRuntimeRunLifecycleController,
  type JingleInvokeRunLifecycleInput,
  type JingleResumeRunLifecycleInput
} from "./run-lifecycle-controller"
import { createRuntimePauseController } from "./pause-controller"
import {
  createRuntimeThreadFromControls,
  type AgentRunSteeringBufferPort
} from "@jingle/langchain-agent-harness/transitional"
import type {
  Runtime,
  RuntimeCompactInput,
  RuntimeCompactResult,
  RuntimeThread
} from "@jingle/langchain-agent-harness"
import type { AgentContextInclusion } from "@shared/jingle-memory"
import type { JingleMemoryService } from "../jingle-memory/service"

export interface CreateAgentRunHandleOptions {
  /** Thread ID - REQUIRED for per-thread checkpointing */
  threadId: string
  runtime: Runtime<
    AgentContextInclusion,
    JingleInvokeRunLifecycleInput,
    JingleResumeRunLifecycleInput
  >
  jingleMemoryService?: JingleMemoryService
  steeringBuffer?: AgentRunSteeringBufferPort
  /** Workspace path - REQUIRED for agent to operate on files */
  workspacePath: string
}

type BddRunStreamChunk = [mode: string, data: unknown]

interface BddAgentRuntime {
  stream: (
    input: unknown,
    options: { signal: AbortSignal }
  ) => Promise<AsyncIterable<BddRunStreamChunk>>
}

interface BddRunOperation {
  streamInvoke(
    input: unknown,
    options: { signal: AbortSignal }
  ): Promise<AsyncIterable<BddRunStreamChunk>>
  streamResume(
    input: unknown,
    options: { signal: AbortSignal }
  ): Promise<AsyncIterable<BddRunStreamChunk>>
}

export interface AgentRunHandle {
  thread: RuntimeThread<
    AgentContextInclusion,
    JingleInvokeRunLifecycleInput,
    JingleResumeRunLifecycleInput
  >
}

export function createAgentRunHandle(options: CreateAgentRunHandleOptions): AgentRunHandle {
  const { runtime, threadId, workspacePath } = options

  if (!threadId) {
    throw new Error("Thread ID is required for checkpointing.")
  }

  if (!workspacePath) {
    throw new Error(
      "Workspace path is required. Please select a workspace folder before running the agent."
    )
  }

  console.log("[Runtime] Opening agent runtime thread...")
  console.log("[Runtime] Thread ID:", threadId)
  console.log("[Runtime] Workspace path:", workspacePath)

  if (!runtimeUsesCheckpointPersistence()) {
    const agent = createBddAgentRuntime({ threadId, workspacePath }) as unknown as BddAgentRuntime
    const thread = createBddHarnessThread({
      agent,
      jingleMemoryService: options.jingleMemoryService,
      threadId,
      workspacePath
    })
    return {
      thread
    }
  }

  const thread = runtime.thread({ threadId, workspacePath })

  console.log("[Runtime] Agent harness thread created at:", workspacePath)
  return {
    thread
  }
}

function createBddHarnessThread(input: {
  agent: BddAgentRuntime
  jingleMemoryService?: JingleMemoryService
  threadId: string
  workspacePath: string
}): RuntimeThread<
  AgentContextInclusion,
  JingleInvokeRunLifecycleInput,
  JingleResumeRunLifecycleInput
> {
  const createSkippedCompaction = async (
    compactInput: RuntimeCompactInput
  ): Promise<RuntimeCompactResult> => {
    const now = new Date().toISOString()
    return {
      checkpointConfig: {
        configurable: {
          model_id: compactInput.modelId,
          operation_id: compactInput.operationId,
          thread_id: input.threadId
        }
      },
      compaction: {
        compactionId: compactInput.operationId,
        compactionCount: 1,
        cutoffIndex: 0,
        createdAt: now,
        historyRef: null,
        preservedUserMessageCount: 0,
        reason: compactInput.reason ?? null,
        status: "failed",
        summaryPreview: null,
        trigger: compactInput.trigger,
        updatedAt: now,
        warning: "Checkpoint-backed harness runtime is unavailable; compact was skipped."
      },
      messageCountAfterCompaction: 0,
      messageCountBeforeCompaction: 0
    }
  }
  const createOperation = async (): Promise<BddRunOperation> => ({
    streamInvoke: (streamInput, options) =>
      input.agent.stream(streamInput, { signal: options.signal }),
    streamResume: (streamInput, options) =>
      input.agent.stream(streamInput, { signal: options.signal })
  })
  const lifecycle = createRuntimeRunLifecycleController({
    jingleMemoryService: input.jingleMemoryService
  })
  const pauseController = createRuntimePauseController()

  return createRuntimeThreadFromControls({
    compaction: { compact: createSkippedCompaction },
    createRunExecution: createOperation,
    pauseController,
    runLifecycleController: lifecycle,
    thread: {
      threadId: input.threadId,
      workspacePath: input.workspacePath
    }
  })
}
