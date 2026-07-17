import type { RuntimeRecordingRef } from "@jingle/langchain-agent-harness"
import type { RuntimeRunLifecycleController } from "@jingle/langchain-agent-harness"
import { createJingleAgentTraceRecordingRef } from "@jingle/langchain-agent-harness/transitional"
import type { HITLDecision } from "@shared/hitl"
import type { AgentContextInclusion } from "@shared/jingle-memory"
import type { ResolvedExtensionAiCapability } from "@shared/extension-sources"
import type { PermissionModeName } from "@shared/permission-mode"
import type {
  JingleMemoryContextPack,
  JingleMemoryContextSnapshot,
  JingleWorkspaceIdentity
} from "@shared/jingle-memory"
import { runtimeUsesCheckpointPersistence } from "../checkpointer/runtime-checkpointer-manager"
import { enqueueAssistantContentProjection } from "../content-cards/projection-queue"
import { JingleIpcError } from "../ipc/error"
import type { JingleMemoryService } from "../jingle-memory/service"
import type { createExtensionAiRuntime } from "./extension-ai-runtime"
import { recordRunFinished, recordRunInterrupted } from "./event-recorder"
import {
  beginAgentRun,
  commitAgentResumeDecision,
  finalizeRunWithoutCheckpoint,
  markRunAborted,
  markRunCancelled,
  markRunFailed,
  syncRunFromLatestCheckpointFacts
} from "./persistence"
import { toAgentRunFailure } from "./errors"

export interface JingleInvokeRunLifecycleInput {
  aiCapabilities: ResolvedExtensionAiCapability[]
  extensionAiRuntime: ReturnType<typeof createExtensionAiRuntime>
  jingleMemoryContextPack: JingleMemoryContextPack | null
  jingleMemoryContextSnapshot: JingleMemoryContextSnapshot | null
  jingleMemoryTemporaryMode: boolean
  modelId: string
  permissionMode: PermissionModeName
  userMessage: {
    contentPreview: string
    id: string
    refs: unknown[]
  }
  workspaceIdentity: JingleWorkspaceIdentity
}

export interface JingleResumeRunLifecycleInput {
  aiCapabilities: ResolvedExtensionAiCapability[]
  decision: HITLDecision & { request_id: string; tool_call_id: string }
  extensionAiRuntime: ReturnType<typeof createExtensionAiRuntime>
  jingleMemoryContextPack: JingleMemoryContextPack | null
  jingleMemoryTemporaryMode: boolean
  modelId: string
  permissionMode: PermissionModeName
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
}): JingleRuntimeRunLifecycleController {
  const jingleMemoryService = input.jingleMemoryService ?? null

  return {
    beginInvokeRun: async ({ invoke, threadId }) => {
      const { run, runId } = await beginAgentRun(threadId, invoke.modelId, {
        aiCapabilities: invoke.aiCapabilities,
        jingleMemoryContextSnapshot: invoke.jingleMemoryContextSnapshot,
        jingleMemoryTemporaryMode: invoke.jingleMemoryTemporaryMode,
        permissionMode: invoke.permissionMode,
        startEvent: {
          contentPreview: invoke.userMessage.contentPreview,
          refs: invoke.userMessage.refs,
          userMessageId: invoke.userMessage.id
        }
      })
      return {
        modelId: invoke.modelId,
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
      const committed = await commitAgentResumeDecision(
        threadId,
        resume.runId,
        resume.decision,
        {
          source: resume.source,
          modelId: resume.modelId ?? null,
          requestId: resume.decision.request_id
        },
        {
          resumeEvent: {
            modelId: resume.modelId
          }
        }
      )
      if (!committed) {
        throw new JingleIpcError({
          channel: "agent:resume",
          code: "CONFLICT",
          message: `[Agent] HITL request "${resume.decision.request_id}" was resolved by another resume request.`
        })
      }
      const { run, runId } = committed
      const declinedDecision = resume.decision.type === "user_declined" ? resume.decision : null
      return {
        ...(declinedDecision
          ? {
              cancelAfterDecision: async () => {
                void enqueueAssistantContentProjection({ runId })
              }
            }
          : {}),
        executionDisposition: declinedDecision ? "terminal" : "resume",
        modelId: resume.modelId,
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
    },
    markRunFailed: async ({ error, runId, threadId }) => {
      const failure = toAgentRunFailure("agent:runtime", error)
      const status = await markRunFailed(threadId, runId, failure)
      void enqueueAssistantContentProjection({ runId })
      return { failure, status }
    },
    markRunCancelled: async ({ runId, threadId }) => {
      await markRunCancelled(threadId, runId)
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
      void enqueueAssistantContentProjection({ runId: event.runId })
    },
    recordRunInterrupted,
    settleRun: () => undefined,
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
