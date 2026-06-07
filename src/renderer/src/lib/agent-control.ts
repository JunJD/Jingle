import type { HITLDecision } from "@/types"
import {
  hasComposerMessageInputContent,
  hasMessageContent,
  toAgentMessageContentWithRefs,
  toMessageContent,
  type ComposerMessageInput
} from "@shared/message-content"
import type { ThreadActions, ThreadContextValue, ThreadState } from "./thread-context"

export interface AgentRunValidationInput {
  actions: ThreadActions
  message: string
  threadId: string
  threadState: ThreadState
}

export type AgentRunValidator = (input: AgentRunValidationInput) => string | null

export interface AgentControl {
  clearError: () => void
  invoke: (input: ComposerMessageInput, options?: { threadId?: string }) => Promise<boolean>
  resume: (decision: HITLDecision) => Promise<void>
  stop: () => Promise<void>
}

export type UpdateAgentThreadRecord = (
  threadId: string,
  updates: { metadata: Record<string, unknown> }
) => Promise<void>

export interface UpdateAgentThreadModelInput {
  modelId: string
  threadContext: Pick<ThreadContextValue, "loadThreadData">
  threadId: string
  updateThread: UpdateAgentThreadRecord
}

export interface InvokeAgentThreadInput {
  getIsPreparing?: () => boolean
  onLocalError?: (error: string | null) => void
  onPreparingChange?: (isPreparing: boolean) => void
  temporaryMode?: boolean
  threadContext: Pick<
    ThreadContextValue,
    "awaitThreadRuntime" | "getThreadActions" | "getThreadState"
  >
  threadId: string | null
  validateRun?: AgentRunValidator
  messageInput: ComposerMessageInput
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function updateAgentThreadModel(
  input: UpdateAgentThreadModelInput
): Promise<void> {
  const thread = await window.api.threads.get(input.threadId)
  if (!thread) {
    throw new Error(`Agent thread is not found: ${input.threadId}`)
  }

  await input.updateThread(input.threadId, {
    metadata: {
      ...(thread.metadata ?? {}),
      model: input.modelId
    }
  })
  await input.threadContext.loadThreadData(input.threadId)
}

export async function invokeAgentThread(input: InvokeAgentThreadInput): Promise<boolean> {
  const { messageInput, threadContext } = input
  const message = messageInput.text.trim()
  const displayContent = toMessageContent(messageInput)
  const submitContent = toAgentMessageContentWithRefs(displayContent, messageInput.refs)

  if (
    input.getIsPreparing?.() ||
    !hasComposerMessageInputContent(messageInput) ||
    !hasMessageContent(submitContent)
  ) {
    return false
  }

  if (!input.threadId) {
    input.onLocalError?.("Agent thread is not selected")
    return false
  }

  input.onPreparingChange?.(true)

  try {
    await threadContext.awaitThreadRuntime(input.threadId)

    const threadState = threadContext.getThreadState(input.threadId)
    if (!threadState) {
      throw new Error(`Agent thread state is not initialized: ${input.threadId}`)
    }

    if (threadState.agent.activeRun?.status === "running" || threadState.agent.pendingApproval) {
      return false
    }

    const actions = threadContext.getThreadActions(input.threadId)
    const validationError = input.validateRun?.({
      actions,
      message,
      threadId: input.threadId,
      threadState
    })

    if (validationError) {
      actions.setError(validationError)
      return false
    }

    input.onLocalError?.(null)
    window.api.agent.invoke(
      input.threadId,
      {
        content: submitContent,
        id: crypto.randomUUID(),
        ...(messageInput.refs.length > 0 ? { additional_kwargs: { refs: messageInput.refs } } : {})
      },
      threadState.agent.currentModel,
      threadState.agent.permissionMode,
      input.temporaryMode ?? false
    )

    return true
  } catch (error) {
    input.onLocalError?.(toErrorMessage(error))
    return false
  } finally {
    input.onPreparingChange?.(false)
  }
}

export function clearAgentThreadError(input: {
  onLocalError?: (error: string | null) => void
  threadContext: Pick<ThreadContextValue, "getThreadActions">
  threadId: string | null
}): void {
  input.onLocalError?.(null)
  if (input.threadId) {
    input.threadContext.getThreadActions(input.threadId).clearError()
  }
}

export async function stopAgentThread(threadId: string | null): Promise<void> {
  if (threadId) {
    await window.api.agent.cancel(threadId)
  }
}

export async function resumeAgentThread(input: {
  decision: HITLDecision
  onLocalError?: (error: string | null) => void
  threadContext: Pick<ThreadContextValue, "getThreadState">
  threadId: string | null
}): Promise<boolean> {
  if (!input.threadId) {
    input.onLocalError?.("Agent thread is not selected")
    return false
  }

  const threadState = input.threadContext.getThreadState(input.threadId)
  if (!threadState) {
    input.onLocalError?.(`Agent thread state is not initialized: ${input.threadId}`)
    return false
  }

  if (!threadState.agent.pendingApproval) {
    return false
  }

  if (!threadState.agent.currentModel) {
    return false
  }

  try {
    input.onLocalError?.(null)
    window.api.agent.resume(
      input.threadId,
      {
        ...input.decision,
        request_id: threadState.agent.pendingApproval.id,
        tool_call_id: threadState.agent.pendingApproval.tool_call.id
      },
      threadState.agent.currentModel
    )
    return true
  } catch (error) {
    input.onLocalError?.(toErrorMessage(error))
    return false
  }
}
