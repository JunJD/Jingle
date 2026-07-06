import type {
  RuntimeRunLifecycleController,
  RuntimeRecordingRef
} from "@jingle/langchain-agent-harness"
import { createJingleAgentTraceRecordingRef } from "@jingle/langchain-agent-harness/transitional"
import type { AgentContextInclusion } from "@shared/jingle-memory"
import type { ResolvedExtensionAiCapability } from "@shared/extension-sources"
import type { PermissionModeName } from "@shared/permission-mode"
import type {
  JingleMemoryContextPack,
  JingleMemoryContextSnapshot,
  JingleWorkspaceIdentity
} from "@shared/jingle-memory"
import { runtimeUsesCheckpointPersistence } from "../checkpointer/runtime-checkpointer-manager"
import { getRun } from "../db/runs"
import type { JingleMemoryService } from "../jingle-memory/service"
import type { createExtensionAiRuntime } from "./extension-ai-runtime"
import { recordRunFinished, recordRunInterrupted } from "./event-recorder"
import {
  beginAgentRun,
  finalizeRunWithoutCheckpoint,
  markRunAborted,
  markRunFailed,
  resumeAgentRun,
  syncRunFromLatestCheckpointFacts
} from "./persistence"

export interface AgentRuntimeRunFacts {
  aiCapabilities: ResolvedExtensionAiCapability[]
  extensionAiRuntime: ReturnType<typeof createExtensionAiRuntime>
  jingleMemoryContextPack: JingleMemoryContextPack | null
  jingleMemoryTemporaryMode: boolean
  modelId?: string
  permissionMode: PermissionModeName
  workspaceIdentity: JingleWorkspaceIdentity
}

export interface JingleInvokeRunLifecycleInput {
  aiCapabilities: ResolvedExtensionAiCapability[]
  extensionAiRuntime: ReturnType<typeof createExtensionAiRuntime>
  jingleMemoryContextPack: JingleMemoryContextPack | null
  jingleMemoryContextSnapshot: JingleMemoryContextSnapshot | null
  jingleMemoryTemporaryMode: boolean
  modelId?: string
  permissionMode: PermissionModeName
  workspaceIdentity: JingleWorkspaceIdentity
}

export interface JingleResumeRunLifecycleInput {
  aiCapabilities: ResolvedExtensionAiCapability[]
  extensionAiRuntime: ReturnType<typeof createExtensionAiRuntime>
  jingleMemoryContextPack: JingleMemoryContextPack | null
  jingleMemoryTemporaryMode: boolean
  modelId?: string
  permissionMode: PermissionModeName
  requestId: string
  runId: string
  source: "resume"
  workspaceIdentity: JingleWorkspaceIdentity
}

export type JingleRuntimeRunLifecycleController = RuntimeRunLifecycleController<
  AgentContextInclusion,
  JingleInvokeRunLifecycleInput,
  JingleResumeRunLifecycleInput
>

export function createRuntimeRunLifecycleController(input: {
  jingleMemoryService?: JingleMemoryService | null
  onRunSettled?: (input: { runId: string; threadId: string }) => void
  onRunStarted?: (input: {
    facts: AgentRuntimeRunFacts
    runId: string
    threadId: string
  }) => void
}): JingleRuntimeRunLifecycleController {
  const jingleMemoryService = input.jingleMemoryService ?? null

  return {
    beginInvokeRun: async ({ invoke, threadId }) => {
      const { run, runId } = await beginAgentRun(threadId, invoke.modelId, {
        aiCapabilities: invoke.aiCapabilities,
        jingleMemoryContextSnapshot: invoke.jingleMemoryContextSnapshot,
        jingleMemoryTemporaryMode: invoke.jingleMemoryTemporaryMode,
        permissionMode: invoke.permissionMode
      })
      input.onRunStarted?.({
        facts: {
          aiCapabilities: invoke.aiCapabilities,
          extensionAiRuntime: invoke.extensionAiRuntime,
          jingleMemoryContextPack: invoke.jingleMemoryContextPack,
          jingleMemoryTemporaryMode: invoke.jingleMemoryTemporaryMode,
          modelId: invoke.modelId,
          permissionMode: invoke.permissionMode,
          workspaceIdentity: invoke.workspaceIdentity
        },
        runId,
        threadId
      })
      return {
        recordingRefs: [
          createJingleAgentTraceRecordingRef({
            createdAt: new Date(run.created_at).toISOString(),
            runId,
            threadId
          })
        ],
        runId
      }
    },
    beginResumeRun: async ({ resume, threadId }) => {
      const runId = await resumeAgentRun(threadId, resume.runId, {
        source: resume.source,
        modelId: resume.modelId ?? null,
        requestId: resume.requestId
      })
      const run = await getRun(runId)
      if (!run) {
        throw new Error(`[Agent] Missing resumed run "${runId}".`)
      }
      input.onRunStarted?.({
        facts: {
          aiCapabilities: resume.aiCapabilities,
          extensionAiRuntime: resume.extensionAiRuntime,
          jingleMemoryContextPack: resume.jingleMemoryContextPack,
          jingleMemoryTemporaryMode: resume.jingleMemoryTemporaryMode,
          modelId: resume.modelId,
          permissionMode: resume.permissionMode,
          workspaceIdentity: resume.workspaceIdentity
        },
        runId,
        threadId
      })
      return {
        recordingRefs: [
          createJingleAgentTraceRecordingRef({
            createdAt: new Date(run.created_at).toISOString(),
            runId,
            threadId
          })
        ],
        runId
      }
    },
    finalizeRunWithoutCheckpoint: async ({
      interrupted,
      runId,
      submittedContextInclusions,
      submittedRecordingRefs,
      threadId
    }) => {
      await finalizeRunWithoutCheckpoint(threadId, runId, { interrupted })
      return {
        contextInclusions: [...submittedContextInclusions],
        recordingRefs: [...submittedRecordingRefs]
      }
    },
    markRunAborted: async ({ runId, threadId }) => {
      await markRunAborted(threadId, runId)
      input.onRunSettled?.({ runId, threadId })
    },
    markRunFailed: async ({ error, runId, threadId }) => {
      await markRunFailed(threadId, runId, error)
      input.onRunSettled?.({ runId, threadId })
    },
    recordMemoryRecordingRefs: ({ recordingRefs, runId, threadId }) =>
      recordJingleMemoryRecordingRefs({
        jingleMemoryService,
        recordingRefs,
        runId,
        threadId
      }),
    recordRunFinished: async (event) => {
      await recordRunFinished(event)
      input.onRunSettled?.({ runId: event.runId, threadId: event.threadId })
    },
    recordRunInterrupted,
    syncRunFromLatestCheckpoint: async ({
      expectedMessageId,
      interrupted,
      runId,
      submittedContextInclusions,
      submittedRecordingRefs,
      threadId
    }) => {
      const syncedFacts = await syncRunFromLatestCheckpointFacts(threadId, runId, {
        expectedMessageId,
        interrupted
      })
      if (!syncedFacts.hasCheckpoint) {
        return {
          contextInclusions: [...submittedContextInclusions],
          recordingRefs: [...submittedRecordingRefs]
        }
      }
      return {
        contextInclusions: syncedFacts.facts.contextInclusions,
        recordingRefs: syncedFacts.facts.recordingRefs
      }
    },
    useCheckpointPersistence: runtimeUsesCheckpointPersistence
  }
}

async function recordJingleMemoryRecordingRefs(input: {
  jingleMemoryService: JingleMemoryService | null
  recordingRefs: readonly RuntimeRecordingRef[]
  runId: string
  threadId: string
}): Promise<void> {
  if (!input.jingleMemoryService) {
    return
  }

  try {
    const memoryIds: string[] = []
    for (const recordingRef of input.recordingRefs) {
      if (recordingRef.domain === "memory") {
        memoryIds.push(recordingRef.refId)
      }
    }

    await input.jingleMemoryService.recordInclusions({
      memoryIds,
      runId: input.runId,
      threadId: input.threadId
    })
  } catch (error) {
    console.error("[Agent] Failed to record Jingle memory inclusions:", error)
  }
}
