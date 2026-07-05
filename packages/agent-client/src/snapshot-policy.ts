export interface JingleSnapshotPolicyMessage {
  content: unknown
  id: string
}

export interface JingleSnapshotApplicationPolicyInput {
  current: {
    activeRun: unknown | null
    messagesPage: readonly JingleSnapshotPolicyMessage[]
    revision: number
  }
  snapshot: {
    messages: readonly JingleSnapshotPolicyMessage[]
    status: "busy" | "error" | "idle" | "interrupted" | string
  }
}

export interface JingleSnapshotApplicationPolicy {
  canApplyContent: boolean
  canApplyRuntimeState: boolean
  isLiveSnapshot: boolean
  wouldRollbackRuntimeMessages: boolean
}

export interface JingleRuntimeSnapshotSourceState<
  TContextInclusion = unknown,
  TError = unknown,
  TFollowUpQueue = unknown,
  TMessage extends JingleSnapshotPolicyMessage = JingleSnapshotPolicyMessage,
  TPendingApproval = unknown,
  TRun = unknown,
  TTodo = unknown,
  TTokenUsage = unknown,
  TStatus = string
> {
  activeRun: TRun | null
  contextInclusions: TContextInclusion[]
  error: TError | null
  followUpQueue: TFollowUpQueue
  latestRunId: string | null
  messagesPage: TMessage[]
  pendingApproval: TPendingApproval | null
  revision: number
  status: TStatus
  todos: TTodo[]
  tokenUsage: TTokenUsage | null
}

export interface JingleRuntimeSnapshotFacts<
  TContextInclusion = unknown,
  TError = unknown,
  TMessage extends JingleSnapshotPolicyMessage = JingleSnapshotPolicyMessage,
  TStatus = string
> {
  contextInclusions: TContextInclusion[]
  error: TError | null
  messagesPage: TMessage[]
  sourceStatus: TStatus
  threadStatus: "busy" | "error" | "idle" | "interrupted" | string
}

export interface JingleRuntimeSnapshotSourceStateApplication<
  TContextInclusion = unknown,
  TError = unknown,
  TFollowUpQueue = unknown,
  TMessage extends JingleSnapshotPolicyMessage = JingleSnapshotPolicyMessage,
  TPendingApproval = unknown,
  TRun = unknown,
  TTodo = unknown,
  TTokenUsage = unknown,
  TStatus = string
> {
  policy: JingleSnapshotApplicationPolicy
  state: JingleRuntimeSnapshotSourceState<
    TContextInclusion,
    TError,
    TFollowUpQueue,
    TMessage,
    TPendingApproval,
    TRun,
    TTodo,
    TTokenUsage,
    TStatus
  >
}

function wouldRollbackMessages(input: {
  currentMessages: readonly JingleSnapshotPolicyMessage[]
  snapshotMessages: readonly JingleSnapshotPolicyMessage[]
}): boolean {
  if (input.currentMessages.length === 0) {
    return false
  }

  const snapshotMessageEntries = input.snapshotMessages.map(
    (message, index) => [message.id, { index, message }] as const
  )
  const snapshotMessagesById = new Map(snapshotMessageEntries)
  let lastSnapshotIndex = -1

  return input.currentMessages.some((currentMessage) => {
    const snapshotEntry = snapshotMessagesById.get(currentMessage.id)
    if (!snapshotEntry || snapshotEntry.index < lastSnapshotIndex) {
      return true
    }

    lastSnapshotIndex = snapshotEntry.index
    const snapshotMessage = snapshotEntry.message

    return (
      typeof currentMessage.content === "string" &&
      typeof snapshotMessage.content === "string" &&
      currentMessage.content.startsWith(snapshotMessage.content) &&
      snapshotMessage.content.length < currentMessage.content.length
    )
  })
}

export function resolveJingleSnapshotApplicationPolicy(
  input: JingleSnapshotApplicationPolicyInput
): JingleSnapshotApplicationPolicy {
  const hasRuntimeRun = input.current.activeRun !== null
  const wouldRollbackRuntimeMessages =
    input.current.revision > 0 &&
    wouldRollbackMessages({
      currentMessages: input.current.messagesPage,
      snapshotMessages: input.snapshot.messages
    })
  const isLiveSnapshot =
    input.snapshot.status === "busy" || input.snapshot.status === "interrupted"
  const canApplySnapshotFacts =
    !hasRuntimeRun && !wouldRollbackRuntimeMessages && !isLiveSnapshot

  return {
    canApplyContent: canApplySnapshotFacts,
    canApplyRuntimeState: canApplySnapshotFacts,
    isLiveSnapshot,
    wouldRollbackRuntimeMessages
  }
}

export function applyJingleRuntimeSnapshotSourceState<
  TContextInclusion = unknown,
  TError = unknown,
  TFollowUpQueue = unknown,
  TMessage extends JingleSnapshotPolicyMessage = JingleSnapshotPolicyMessage,
  TPendingApproval = unknown,
  TRun = unknown,
  TTodo = unknown,
  TTokenUsage = unknown,
  TStatus = string
>(input: {
  current: JingleRuntimeSnapshotSourceState<
    TContextInclusion,
    TError,
    TFollowUpQueue,
    TMessage,
    TPendingApproval,
    TRun,
    TTodo,
    TTokenUsage,
    TStatus
  >
  snapshot: JingleRuntimeSnapshotFacts<TContextInclusion, TError, TMessage, TStatus>
}): JingleRuntimeSnapshotSourceStateApplication<
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
  const policy = resolveJingleSnapshotApplicationPolicy({
    current: {
      activeRun: input.current.activeRun,
      messagesPage: input.current.messagesPage,
      revision: input.current.revision
    },
    snapshot: {
      messages: input.snapshot.messagesPage,
      status: input.snapshot.threadStatus
    }
  })

  return {
    policy,
    state: {
      ...input.current,
      contextInclusions: policy.canApplyRuntimeState
        ? input.snapshot.contextInclusions
        : input.current.contextInclusions,
      error: policy.canApplyRuntimeState ? input.snapshot.error : input.current.error,
      messagesPage: policy.canApplyContent
        ? input.snapshot.messagesPage
        : input.current.messagesPage,
      status: policy.canApplyRuntimeState ? input.snapshot.sourceStatus : input.current.status
    }
  }
}
