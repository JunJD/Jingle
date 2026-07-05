import type { JingleRunFinishStatus, JingleRuntimeStatus, JingleTokenUsage } from "./profile"
import type { JingleToolExecutionError } from "./tool-execution"
import type {
  JingleActiveAgentRun,
  JingleActiveAgentToolCall,
  JingleAgentRunPhase
} from "./live-state"

type JingleWithoutRevision<TEvent> = TEvent extends { revision: number }
  ? Omit<TEvent, "revision">
  : never

export type JingleAgentThreadEvent<
  TContextInclusion = unknown,
  TError = unknown,
  TFollowUpQueue = unknown,
  TMessage = unknown,
  TPendingApproval = unknown,
  TRun = JingleActiveAgentRun,
  TTodo = unknown,
  TTokenUsage = JingleTokenUsage,
  TStatus = JingleRuntimeStatus,
  TDecision = unknown,
  TToolCall = JingleActiveAgentToolCall
> =
  | {
      error: TError | null
      revision: number
      status: TStatus
      type: "thread.statusChanged"
    }
  | {
      revision: number
      run: TRun
      type: "run.started"
    }
  | {
      revision: number
      run: TRun
      type: "run.resumed"
    }
  | {
      revision: number
      runId: string
      type: "run.idAssigned"
    }
  | {
      phase: JingleAgentRunPhase
      revision: number
      runId: string | null
      startedAt: Date
      type: "run.phaseChanged"
    }
  | {
      revision: number
      tokenUsage: TTokenUsage | null
      type: "run.tokenUsageUpdated"
    }
  | {
      message: TMessage
      revision: number
      type: "message.upserted"
    }
  | {
      appliedAt: Date
      messageId: string
      revision: number
      runId: string | null
      type: "steer.applied"
    }
  | {
      messageId: string
      revision: number
      type: "message.truncatedAfter"
    }
  | {
      delta: string
      deltaAt: Date
      field: "text"
      messageId: string
      partId: string
      revision: number
      type: "message.part.delta"
    }
  | {
      revision: number
      toolCall: TToolCall
      type: "tool.callUpdated"
    }
  | {
      messageId: string | null
      revision: number
      runId: string | null
      startedAt: Date
      toolCallId: string
      type: "tool.started"
    }
  | {
      completedAt: Date
      durationMs: number | null
      error: JingleToolExecutionError | null
      messageId: string | null
      revision: number
      runId: string | null
      startedAt: Date | null
      status: "completed" | "failed"
      toolCallId: string
      toolName: string | null
      type: "tool.updated"
    }
  | {
      approval: TPendingApproval
      revision: number
      requestedAt: Date
      runId: string | null
      type: "approval.requested"
    }
  | {
      decision: TDecision
      revision: number
      resolvedAt: Date
      type: "approval.cleared"
    }
  | {
      revision: number
      todos: TTodo[]
      type: "todos.replaced"
    }
  | {
      inclusions: TContextInclusion[]
      revision: number
      type: "context.inclusionsReplaced"
    }
  | {
      revision: number
      summary: TFollowUpQueue
      type: "followUp.queueChanged"
    }
  | {
      completedAt: Date
      durationMs: number | null
      error: TError | null
      revision: number
      runId: string | null
      status: JingleRunFinishStatus
      type: "run.finished"
    }

export type JingleAgentThreadEventDraft<
  TContextInclusion = unknown,
  TError = unknown,
  TFollowUpQueue = unknown,
  TMessage = unknown,
  TPendingApproval = unknown,
  TRun = JingleActiveAgentRun,
  TTodo = unknown,
  TTokenUsage = JingleTokenUsage,
  TStatus = JingleRuntimeStatus,
  TDecision = unknown,
  TToolCall = JingleActiveAgentToolCall
> = JingleWithoutRevision<
  JingleAgentThreadEvent<
    TContextInclusion,
    TError,
    TFollowUpQueue,
    TMessage,
    TPendingApproval,
    TRun,
    TTodo,
    TTokenUsage,
    TStatus,
    TDecision,
    TToolCall
  >
>
