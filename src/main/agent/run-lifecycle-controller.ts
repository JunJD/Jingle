import type {
  RuntimeRunLifecycleController,
  RuntimeRecordingRef
} from "@jingle/langchain-agent-harness"
import { createJingleAgentTraceRecordingRef } from "@jingle/langchain-agent-harness/transitional"
import type { AgentContextInclusion } from "@shared/jingle-memory"
import type { ResolvedExtensionAiCapability } from "@shared/extension-sources"
import type { PermissionModeName } from "@shared/permission-mode"
import type { JingleMemoryContextSnapshot } from "@shared/jingle-memory"
import { runtimeUsesCheckpointPersistence } from "../checkpointer/runtime-checkpointer-manager"
import { getRun } from "../db/runs"
import type { JingleMemoryService } from "../jingle-memory/service"
import { recordRunFinished, recordRunInterrupted } from "./event-recorder"
import {
  beginAgentRun,
  finalizeRunWithoutCheckpoint,
  markRunAborted,
  markRunFailed,
  resumeAgentRun,
  syncRunFromLatestCheckpointFacts
} from "./persistence"

export interface JingleInvokeRunLifecycleInput {
  aiCapabilities: ResolvedExtensionAiCapability[]
  jingleMemoryContextSnapshot: JingleMemoryContextSnapshot | null
  jingleMemoryTemporaryMode: boolean
  modelId?: string
  permissionMode: PermissionModeName
}

export interface JingleResumeRunLifecycleInput {
  modelId?: string
  requestId: string
  runId: string
  source: "resume"
}

export type JingleRuntimeRunLifecycleController = RuntimeRunLifecycleController<
  AgentContextInclusion,
  JingleInvokeRunLifecycleInput,
  JingleResumeRunLifecycleInput
>

export function createRuntimeRunLifecycleController(input: {
  jingleMemoryService?: JingleMemoryService | null
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
    markRunAborted: ({ runId, threadId }) => markRunAborted(threadId, runId),
    markRunFailed: ({ error, runId, threadId }) => markRunFailed(threadId, runId, error),
    recordMemoryRecordingRefs: ({ recordingRefs, runId, threadId }) =>
      recordJingleMemoryRecordingRefs({
        jingleMemoryService,
        recordingRefs,
        runId,
        threadId
      }),
    recordRunFinished,
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
