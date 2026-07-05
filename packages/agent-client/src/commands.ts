import {
  buildJingleAgentDisplayMessageContent,
  buildJingleAgentSubmitMessageContentWithRefs,
  hasJingleAgentComposerMessageInputContent,
  hasJingleAgentMessageContent,
  type JingleAgentComposerMessageInput,
  type JingleAgentComposerMessageRef,
  type JingleAgentMessageContent
} from "./message-content"

export type {
  JingleAgentComposerMessageInput,
  JingleAgentComposerMessageRef,
  JingleAgentMessageContent,
  JingleAgentMessageContentBlock
} from "./message-content"

export interface JingleAgentCommandMessage {
  content: JingleAgentMessageContent
  id: string
  refs?: JingleAgentComposerMessageRef[]
}

export interface JingleAgentRunValidationInput {
  message: string
  threadId: string
  workspacePath: string | null
}

export type JingleAgentRunValidator = (input: JingleAgentRunValidationInput) => string | null

export interface JingleAgentCommandEnvelope {
  content: JingleAgentMessageContent
  refs?: JingleAgentComposerMessageRef[]
  validationText: string
}

type JingleAgentThreadMetadata = Record<string, unknown>

export type JingleAgentFollowUpMode = "queue" | "steer"

export type JingleAgentFollowUpAction = Extract<JingleAgentFollowUpMode, "steer">

export interface JingleAgentFollowUpQueueItem {
  messageInput: JingleAgentComposerMessageInput
  requestId: string
  text: string
}

export interface JingleAgentFollowUpQueueSummary {
  count: number
  items: readonly JingleAgentFollowUpQueueItem[]
  nextRequestId: string | null
}

export function summarizeJingleAgentFollowUpQueue(
  items: readonly JingleAgentFollowUpQueueItem[]
): JingleAgentFollowUpQueueSummary {
  return {
    count: items.length,
    items: [...items],
    nextRequestId: items[0]?.requestId ?? null
  }
}

export function createEmptyJingleAgentFollowUpQueueSummary(): JingleAgentFollowUpQueueSummary {
  return summarizeJingleAgentFollowUpQueue([])
}

export type JingleAgentFollowUpPlan =
  | {
      action?: JingleAgentFollowUpAction
      type: "invoke"
    }
  | {
      type: "queue"
    }

export type JingleAgentFollowUpDrainPlan =
  | {
      requestId: string
      threadId: string
      type: "drain"
    }
  | {
      type: "idle"
    }

export interface JingleAgentApprovalDecision {
  feedback?: string
  request_id?: string
  tool_call_id?: string
  type: "approve" | "reject"
}

export interface JingleAgentPendingApprovalSource {
  id: string
  tool_call: {
    id: string
  }
}

export interface JingleAgentPendingApprovalRef {
  id: string
  toolCall: {
    id: string
  }
}

export type JingleAgentResumeDecision = JingleAgentApprovalDecision & {
  request_id: string
  tool_call_id: string
}

export interface JingleAgentCommandState<TPermissionMode = string> {
  activeRun: { status: string } | null
  currentModel: string | null
  pendingApproval: JingleAgentPendingApprovalRef | null
  permissionMode: TPermissionMode
  workspacePath: string | null
}

export type JingleAgentCommandStateSource<TPermissionMode = string> = Omit<
  JingleAgentCommandState<TPermissionMode>,
  "pendingApproval"
> & {
  pendingApproval: JingleAgentPendingApprovalSource | null
}

export type JingleReadyAgentCommandState<TPermissionMode = string> =
  JingleAgentCommandState<TPermissionMode> & {
    currentModel: string
  }

export type JingleAgentCommandReadiness<TPermissionMode = string> =
  | {
      state: JingleReadyAgentCommandState<TPermissionMode>
      type: "ready"
    }
  | {
      message: string
      type: "error"
    }
  | {
      type: "blocked"
    }

export type JingleAgentResumeReadyState<TPermissionMode = string> =
  JingleReadyAgentCommandState<TPermissionMode> & {
    pendingApproval: JingleAgentPendingApprovalRef
  }

export type JingleAgentResumeReadiness<TPermissionMode = string> =
  | {
      state: JingleAgentResumeReadyState<TPermissionMode>
      type: "ready"
    }
  | {
      message: string
      type: "error"
    }
  | {
      type: "blocked"
    }

export function selectJingleAgentCommandState<TPermissionMode = string>(
  source: JingleAgentCommandStateSource<TPermissionMode> | null | undefined
): JingleAgentCommandState<TPermissionMode> | null {
  if (!source) {
    return null
  }

  return {
    activeRun: source.activeRun,
    currentModel: source.currentModel,
    pendingApproval: source.pendingApproval
      ? {
          id: source.pendingApproval.id,
          toolCall: {
            id: source.pendingApproval.tool_call.id
          }
        }
      : null,
    permissionMode: source.permissionMode,
    workspacePath: source.workspacePath
  }
}

export function resolveJingleAgentInvokeReadiness<TPermissionMode = string>(input: {
  state: JingleAgentCommandState<TPermissionMode> | null
  threadId: string
}): JingleAgentCommandReadiness<TPermissionMode> {
  if (!input.state) {
    return {
      message: `Agent thread state is not initialized: ${input.threadId}`,
      type: "error"
    }
  }

  if (!input.state.currentModel || input.state.pendingApproval) {
    return { type: "blocked" }
  }

  return {
    state: {
      ...input.state,
      currentModel: input.state.currentModel
    },
    type: "ready"
  }
}

export function resolveJingleAgentEditReadiness<TPermissionMode = string>(input: {
  state: JingleAgentCommandState<TPermissionMode> | null
  threadId: string
}): JingleAgentCommandReadiness<TPermissionMode> {
  if (!input.state) {
    return {
      message: `Agent thread state is not initialized: ${input.threadId}`,
      type: "error"
    }
  }

  if (
    !input.state.currentModel ||
    input.state.activeRun?.status === "running" ||
    input.state.pendingApproval
  ) {
    return { type: "blocked" }
  }

  return {
    state: {
      ...input.state,
      currentModel: input.state.currentModel
    },
    type: "ready"
  }
}

export function resolveJingleAgentResumeReadiness<TPermissionMode = string>(input: {
  state: JingleAgentCommandState<TPermissionMode> | null
  threadId: string
}): JingleAgentResumeReadiness<TPermissionMode> {
  if (!input.state) {
    return {
      message: `Agent thread state is not initialized: ${input.threadId}`,
      type: "error"
    }
  }

  if (!input.state.pendingApproval || !input.state.currentModel) {
    return { type: "blocked" }
  }

  return {
    state: {
      ...input.state,
      currentModel: input.state.currentModel,
      pendingApproval: input.state.pendingApproval
    },
    type: "ready"
  }
}

export function buildJingleAgentCommandEnvelope(input: {
  messageInput: JingleAgentComposerMessageInput
}): JingleAgentCommandEnvelope | null {
  const displayContent = buildJingleAgentDisplayMessageContent(input.messageInput)
  const submitContent = buildJingleAgentSubmitMessageContentWithRefs({
    content: displayContent,
    refs: input.messageInput.refs
  })

  if (
    !hasJingleAgentComposerMessageInputContent(input.messageInput) ||
    !hasJingleAgentMessageContent(submitContent)
  ) {
    return null
  }

  return {
    content: submitContent,
    ...(input.messageInput.refs.length > 0 ? { refs: input.messageInput.refs } : {}),
    validationText: input.messageInput.text.trim()
  }
}

function buildJingleAgentThreadMetadataUpdate(input: {
  currentMetadata?: JingleAgentThreadMetadata | null
  patch: JingleAgentThreadMetadata
}): JingleAgentThreadMetadata {
  return {
    ...(input.currentMetadata ?? {}),
    ...input.patch
  }
}

export function buildJingleAgentModelMetadataUpdate(input: {
  currentMetadata?: JingleAgentThreadMetadata | null
  modelId: string
}): JingleAgentThreadMetadata {
  return buildJingleAgentThreadMetadataUpdate({
    currentMetadata: input.currentMetadata,
    patch: { model: input.modelId }
  })
}

export function buildJingleAgentPermissionMetadataUpdate(input: {
  currentMetadata?: JingleAgentThreadMetadata | null
  permissionMode: string
}): JingleAgentThreadMetadata {
  return buildJingleAgentThreadMetadataUpdate({
    currentMetadata: input.currentMetadata,
    patch: { permissionMode: input.permissionMode }
  })
}

export function buildJingleAgentCommandMessage(input: {
  envelope: JingleAgentCommandEnvelope
  messageId: string
}): JingleAgentCommandMessage {
  return {
    content: input.envelope.content,
    id: input.messageId,
    ...(input.envelope.refs ? { refs: input.envelope.refs } : {})
  }
}

export function resolveJingleAgentFollowUpPlan(input: {
  configuredMode?: JingleAgentFollowUpMode
  isRunning: boolean
  requestedAction?: JingleAgentFollowUpAction
}): JingleAgentFollowUpPlan {
  if (input.requestedAction === "steer") {
    return { action: "steer", type: "invoke" }
  }

  if (!input.isRunning) {
    return { type: "invoke" }
  }

  const mode = input.requestedAction ?? input.configuredMode
  if (mode === "queue") {
    return { type: "queue" }
  }

  return mode === "steer" ? { action: "steer", type: "invoke" } : { type: "invoke" }
}

export function resolveJingleAgentFollowUpDrainPlan(input: {
  activeRequestId?: string | null
  nextRequestId?: string | null
  runtimeStatus: string | null | undefined
  threadId: string | null | undefined
}): JingleAgentFollowUpDrainPlan {
  if (
    !input.threadId ||
    input.runtimeStatus !== "idle" ||
    !input.nextRequestId ||
    input.activeRequestId
  ) {
    return { type: "idle" }
  }

  return {
    requestId: input.nextRequestId,
    threadId: input.threadId,
    type: "drain"
  }
}

export function buildJingleAgentResumeDecision(input: {
  decision: JingleAgentApprovalDecision
  pendingApproval: JingleAgentPendingApprovalRef
}): JingleAgentResumeDecision {
  return {
    ...input.decision,
    request_id: input.pendingApproval.id,
    tool_call_id: input.pendingApproval.toolCall.id
  }
}
