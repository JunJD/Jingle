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
import { resolveHitlRequest } from "../db/hitl"
import { enqueueAssistantContentProjection } from "../content-cards/projection-queue"
import { JingleIpcError } from "../ipc/error"
import type { JingleMemoryService } from "../jingle-memory/service"
import type { createExtensionAiRuntime } from "./extension-ai-runtime"
import {
  recordApprovalResolved,
  recordDeclinedApprovalOutcome,
  recordRunFinished,
  recordRunInterrupted
} from "./event-recorder"
import {
  beginAgentRun,
  finalizeRunWithoutCheckpoint,
  markRunAborted,
  markRunFailed,
  markRunCancelled,
  resumeAgentRun,
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
      const { run, runId } = await resumeAgentRun(
        threadId,
        resume.runId,
        {
          source: resume.source,
          modelId: resume.modelId ?? null,
          requestId: resume.decision.request_id
        },
        {
          resumeEvent: {
            modelId: resume.modelId,
            requestId: resume.decision.request_id
          }
        }
      )
      const declinedDecision =
        resume.decision.type === "user_declined" ? resume.decision : null
      return {
        beforePendingHitlPersistence: async () => {
          const resolvedRequest = await resolveHitlRequest(
            resume.decision.request_id,
            resolveHitlRequestStatus(resume.decision.type),
            {
              ...(resume.decision.type === "corrected"
                ? { correction: resume.decision.correction }
                : {}),
              request_id: resume.decision.request_id,
              tool_call_id: resume.decision.tool_call_id,
              type: resume.decision.type
            }
          )
          if (!resolvedRequest) {
            throw new JingleIpcError({
              channel: "agent:resume",
              code: "CONFLICT",
              message: `[Agent] HITL request "${resume.decision.request_id}" was resolved by another resume request.`
            })
          }
          if (resume.decision.type !== "user_declined") {
            void recordApprovalResolved({
              decision: resume.decision,
              requestId: resume.decision.request_id,
              runId,
              threadId
            })
          }
        },
        ...(declinedDecision
          ? {
              cancelAfterDecision: async () => {
                await markRunCancelled(threadId, runId)
                enqueueAssistantContentProjection({ runId, threadId })
                void recordDeclinedApprovalOutcome({
                  decision: declinedDecision,
                  requestId: declinedDecision.request_id,
                  runId,
                  threadId
                })
              }
            }
          : {}),
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
      await markRunFailed(threadId, runId, toAgentRunFailure("agent:runtime", error))
      enqueueAssistantContentProjection({ runId, threadId })
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
      enqueueAssistantContentProjection({ runId: event.runId, threadId: event.threadId })
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

function resolveHitlRequestStatus(
  type: HITLDecision["type"]
): "approved" | "user_declined" | "corrected" {
  switch (type) {
    case "approve":
      return "approved"
    case "user_declined":
      return "user_declined"
    case "corrected":
      return "corrected"
  }

  const unsupportedType: never = type
  throw new Error(`[Agent] Unsupported HITL decision type: ${String(unsupportedType)}`)
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
