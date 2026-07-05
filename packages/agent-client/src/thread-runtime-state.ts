import type {
  JingleRuntimeSnapshotSourceState,
  JingleSnapshotPolicyMessage
} from "./snapshot-policy"

export type JingleAgentThreadRuntimeState<
  TContextInclusion = unknown,
  TError = unknown,
  TFollowUpQueue = unknown,
  TMessage extends JingleSnapshotPolicyMessage = JingleSnapshotPolicyMessage,
  TPendingApproval = unknown,
  TRun = unknown,
  TTodo = unknown,
  TTokenUsage = unknown,
  TStatus = string
> = JingleRuntimeSnapshotSourceState<
  TContextInclusion,
  TError,
  TFollowUpQueue,
  TMessage,
  TPendingApproval,
  TRun,
  TTodo,
  TTokenUsage,
  TStatus
> & {
  hasMoreBefore: boolean
  threadId: string
}

export interface CreateJingleAgentThreadRuntimeStateInput<
  TFollowUpQueue = unknown,
  TStatus = string
> {
  followUpQueue: TFollowUpQueue
  status: TStatus
  threadId: string
}

export function createJingleAgentThreadRuntimeState<
  TContextInclusion = unknown,
  TError = unknown,
  TFollowUpQueue = unknown,
  TMessage extends JingleSnapshotPolicyMessage = JingleSnapshotPolicyMessage,
  TPendingApproval = unknown,
  TRun = unknown,
  TTodo = unknown,
  TTokenUsage = unknown,
  TStatus = string
>(
  input: CreateJingleAgentThreadRuntimeStateInput<TFollowUpQueue, TStatus>
): JingleAgentThreadRuntimeState<
  TContextInclusion,
  TError,
  TFollowUpQueue,
  TMessage,
  TPendingApproval,
  TRun,
  TTodo,
  TTokenUsage,
  TStatus
> {
  return {
    activeRun: null,
    contextInclusions: [],
    error: null,
    followUpQueue: input.followUpQueue,
    hasMoreBefore: false,
    latestRunId: null,
    messagesPage: [],
    pendingApproval: null,
    revision: 0,
    status: input.status,
    threadId: input.threadId,
    todos: [],
    tokenUsage: null
  }
}
