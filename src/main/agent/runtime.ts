import { randomUUID } from "node:crypto"
import {
  getCheckpointer,
  runtimeUsesCheckpointPersistence
} from "../checkpointer/runtime-checkpointer-manager"
import { LocalSandbox } from "./local-sandbox"
import { getChatModelInstance } from "../llm/get-chat-model"

import { createBddAgentRuntime } from "./bdd-runtime"
import { createNativeExtensionToolRegistry } from "../extension-tools/native-extension-tools"
import {
  listNativeExtensionMainDefinitions,
  listNativeExtensionManifests
} from "../services/native-extensions"
import { createExtensionAiRuntime } from "./extension-ai-runtime"
import { createAgentRuntime } from "./runtime-assembly"
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
  RuntimeCompactInput,
  RuntimeCompactResult,
  RuntimeThread
} from "@jingle/langchain-agent-harness"
import type { PermissionModeName } from "@shared/permission-mode"
import type { JingleMemoryContextPack, JingleWorkspaceIdentity } from "@shared/jingle-memory"
import type { AgentContextInclusion } from "@shared/jingle-memory"
import type { JingleMemoryService } from "../jingle-memory/service"
import type { WorkspaceService } from "../workspace/service"
import type {
  ExtensionAiCapabilityCatalogItem,
  ResolvedExtensionAiCapability
} from "@shared/extension-sources"
import type { NativeExtensionExecutionContext } from "@shared/native-extensions"
import type { LoadedExtensionAiCapabilitiesChange } from "./extension-ai-session"

export interface CreateAgentRunHandleOptions {
  /** Thread ID - REQUIRED for per-thread checkpointing */
  threadId: string
  /** Model ID to use (defaults to configured default model) */
  modelId?: string
  runtimeModules: CreateAgentRunHandleRuntimeModules
  steeringBuffer?: AgentRunSteeringBufferPort
  /** Workspace path - REQUIRED for agent to operate on files */
  workspacePath: string
}

export interface CreateAgentRunHandleRuntimeModules {
  approval: {
    permissionMode: PermissionModeName
  }
  extensionAi: {
    capabilityCatalog?: ExtensionAiCapabilityCatalogItem[]
    capabilitySnapshot: ResolvedExtensionAiCapability[]
    getCapabilityByExtensionName?: (extensionName: string) => ResolvedExtensionAiCapability | null
    getExecutionContext?: (extensionName: string) => NativeExtensionExecutionContext
    getPreferences?: (extensionName: string) => Record<string, unknown>
    onLoadedCapabilitiesChanged?: (
      change: LoadedExtensionAiCapabilitiesChange
    ) => Promise<void> | void
  }
  memory: {
    contextPack?: JingleMemoryContextPack | null
    service: JingleMemoryService | null
    temporaryMode: boolean
    workspaceIdentity?: JingleWorkspaceIdentity
  }
  workspaceContext: {
    service: WorkspaceService | null
  }
}

interface BddAgentRuntime {
  stream: (input: unknown, options: { signal: AbortSignal }) => Promise<AsyncIterable<unknown>>
}

interface BddRunOperationInput {
  runId: string
}

interface BddRunOperation {
  compact(input: RuntimeCompactInput): Promise<RuntimeCompactResult>
  streamInvoke(input: unknown, options: { signal: AbortSignal }): Promise<AsyncIterable<unknown>>
  streamResume(input: unknown, options: { signal: AbortSignal }): Promise<AsyncIterable<unknown>>
}

export interface AgentRunHandle {
  thread: RuntimeThread<
    AgentContextInclusion,
    JingleInvokeRunLifecycleInput,
    JingleResumeRunLifecycleInput
  >
}

export async function createAgentRunHandle(
  options: CreateAgentRunHandleOptions
): Promise<AgentRunHandle> {
  const { threadId, modelId, workspacePath } = options
  const runtimeModules = options.runtimeModules
  const permissionMode = runtimeModules.approval.permissionMode
  const aiCapabilities = runtimeModules.extensionAi.capabilitySnapshot
  const workspaceService = runtimeModules.workspaceContext.service
  const memoryModule = runtimeModules.memory

  if (!threadId) {
    throw new Error("Thread ID is required for checkpointing.")
  }

  if (!workspacePath) {
    throw new Error(
      "Workspace path is required. Please select a workspace folder before running the agent."
    )
  }

  console.log("[Runtime] Creating agent runtime...")
  console.log("[Runtime] Thread ID:", threadId)
  console.log("[Runtime] Workspace path:", workspacePath)

  if (!runtimeUsesCheckpointPersistence()) {
    const agent = createBddAgentRuntime({ threadId, workspacePath }) as unknown as BddAgentRuntime
    const thread = createBddHarnessThread({
      agent,
      jingleMemoryService: memoryModule.service ?? undefined,
      threadId,
      workspacePath
    })
    return {
      thread
    }
  }

  const model = getChatModelInstance({ modelId, parallelToolCalls: false })
  console.log("[Runtime] Model instance created:", typeof model)

  const checkpointer = await getCheckpointer(threadId)
  console.log("[Runtime] Checkpointer ready for thread:", threadId)

  const backend = new LocalSandbox({
    rootDir: workspacePath,
    virtualMode: false, // Use absolute system paths for consistency with shell commands
    timeout: 120_000, // 2 minutes
    maxOutputBytes: 100_000 // ~100KB
  })
  const extensionManifests = listNativeExtensionManifests(process.platform)
  const extensionMainDefinitions = await listNativeExtensionMainDefinitions(process.platform)
  const extensionToolRegistry = createNativeExtensionToolRegistry({
    definitions: extensionMainDefinitions,
    manifests: extensionManifests
  })
  const extensionAiRuntime = createExtensionAiRuntime({
    aiCapabilities,
    aiCapabilityCatalog: runtimeModules.extensionAi.capabilityCatalog
      ? extensionToolRegistry.withCatalogToolAccess(runtimeModules.extensionAi.capabilityCatalog)
      : undefined,
    getAiCapabilityByExtensionName: runtimeModules.extensionAi.getCapabilityByExtensionName,
    getExtensionExecutionContext: runtimeModules.extensionAi.getExecutionContext,
    getExtensionPreferences: runtimeModules.extensionAi.getPreferences,
    onLoadedAiCapabilitiesChanged: runtimeModules.extensionAi.onLoadedCapabilitiesChanged,
    registry: extensionToolRegistry,
    threadId,
    workspacePath
  })

  console.log("[Runtime] Jingle memory items:", memoryModule.contextPack?.items.length ?? 0)

  const runtime = createAgentRuntime({
    capabilities: {
      approval: {
        permissionMode
      },
      checkpoint: {
        checkpointer
      },
      extensionAi: {
        capabilitySnapshot: aiCapabilities,
        runtime: extensionAiRuntime
      },
      memory: {
        contextPack: memoryModule.contextPack,
        service: memoryModule.service,
        temporaryMode: memoryModule.temporaryMode,
        workspaceIdentity: memoryModule.workspaceIdentity
      },
      model: {
        model,
        modelId
      },
      workspaceContext: {
        backend,
        service: workspaceService,
        workspacePath
      }
    }
  })

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
  const createSkippedCompaction =
    (operationInput: BddRunOperationInput): BddRunOperation["compact"] =>
    async (compactInput) => {
      const now = new Date().toISOString()
      return {
        checkpointConfig: {
          configurable: {
            run_id: operationInput.runId,
            thread_id: input.threadId
          }
        },
        compaction: {
          compactionId: `bdd-skipped:${operationInput.runId}:${randomUUID()}`,
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
      } satisfies RuntimeCompactResult
    }
  const createOperation = (operationInput: BddRunOperationInput): BddRunOperation => ({
    compact: createSkippedCompaction(operationInput),
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
    createRunExecution: createOperation,
    pauseController,
    runLifecycleController: lifecycle,
    thread: {
      threadId: input.threadId,
      workspacePath: input.workspacePath
    }
  })
}
