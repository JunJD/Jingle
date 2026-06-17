import type { HITLDecision } from "@/types"
import {
  hasComposerMessageInputContent,
  hasMessageContent,
  toAgentMessageContentWithRefs,
  toMessageContent,
  type ComposerMessageInput
} from "@shared/message-content"
import {
  THREAD_PERMISSION_MODE_METADATA_KEY,
  type PermissionModeName
} from "@shared/permission-mode"
import type { ThreadContextValue } from "./thread-context"

export interface AgentRunValidationInput {
  message: string
  threadId: string
  workspacePath: string | null
}

export type AgentRunValidator = (input: AgentRunValidationInput) => string | null

export interface AgentControl {
  clearError: () => void
  editLastUserMessageAndInvoke: (
    input: EditLastUserMessageAndInvokeInput,
    options?: { threadId?: string }
  ) => Promise<boolean>
  invoke: (input: ComposerMessageInput, options?: { threadId?: string }) => Promise<boolean>
  resume: (decision: HITLDecision) => Promise<boolean>
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

export interface UpdateAgentThreadPermissionModeInput {
  permissionMode: PermissionModeName
  threadContext: Pick<ThreadContextValue, "loadThreadData">
  threadId: string
  updateThread: UpdateAgentThreadRecord
}

export interface InvokeAgentThreadInput {
  onLocalError?: (error: string | null) => void
  temporaryMode?: boolean
  threadContext: Pick<ThreadContextValue, "awaitThreadRuntime" | "getAgentCommandState">
  threadId: string | null
  validateRun?: AgentRunValidator
  messageInput: ComposerMessageInput
}

export interface EditLastUserMessageAndInvokeInput {
  messageId: string
  messageInput: ComposerMessageInput
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function updateAgentThreadMetadata(input: {
  metadata: Record<string, unknown>
  threadContext: Pick<ThreadContextValue, "loadThreadData">
  threadId: string
  updateThread: UpdateAgentThreadRecord
}): Promise<void> {
  const thread = await window.api.threads.get(input.threadId)
  if (!thread) {
    throw new Error(`Agent thread is not found: ${input.threadId}`)
  }

  await input.updateThread(input.threadId, {
    metadata: {
      ...(thread.metadata ?? {}),
      ...input.metadata
    }
  })
  await input.threadContext.loadThreadData(input.threadId)
}

export async function updateAgentThreadModel(
  input: UpdateAgentThreadModelInput
): Promise<void> {
  await updateAgentThreadMetadata({
    metadata: { model: input.modelId },
    threadContext: input.threadContext,
    threadId: input.threadId,
    updateThread: input.updateThread
  })
}

export async function updateAgentThreadPermissionMode(
  input: UpdateAgentThreadPermissionModeInput
): Promise<void> {
  await updateAgentThreadMetadata({
    metadata: { [THREAD_PERMISSION_MODE_METADATA_KEY]: input.permissionMode },
    threadContext: input.threadContext,
    threadId: input.threadId,
    updateThread: input.updateThread
  })
}

export async function invokeAgentThread(input: InvokeAgentThreadInput): Promise<boolean> {
  const { messageInput, threadContext } = input
  const message = messageInput.text.trim()
  const displayContent = toMessageContent(messageInput)
  const submitContent = toAgentMessageContentWithRefs(displayContent, messageInput.refs)

  if (
    !hasComposerMessageInputContent(messageInput) ||
    !hasMessageContent(submitContent)
  ) {
    return false
  }

  if (!input.threadId) {
    input.onLocalError?.("Agent thread is not selected")
    return false
  }

  try {
    await threadContext.awaitThreadRuntime(input.threadId)

    const agentState = threadContext.getAgentCommandState(input.threadId)
    if (!agentState) {
      throw new Error(`Agent thread state is not initialized: ${input.threadId}`)
    }

    if (agentState.activeRun?.status === "running" || agentState.pendingApproval) {
      return false
    }

    const validationError = input.validateRun?.({
      message,
      threadId: input.threadId,
      workspacePath: agentState.workspacePath
    })

    if (validationError) {
      input.onLocalError?.(validationError)
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
      agentState.currentModel,
      agentState.permissionMode,
      input.temporaryMode ?? false
    )

    return true
  } catch (error) {
    input.onLocalError?.(toErrorMessage(error))
    return false
  }
}

export async function editLastUserMessageAndInvokeAgentThread(
  input: InvokeAgentThreadInput & { messageId: string }
): Promise<boolean> {
  const { messageInput, threadContext } = input
  const message = messageInput.text.trim()
  const displayContent = toMessageContent(messageInput)
  const submitContent = toAgentMessageContentWithRefs(displayContent, messageInput.refs)

  if (
    !hasComposerMessageInputContent(messageInput) ||
    !hasMessageContent(submitContent)
  ) {
    return false
  }

  if (!input.threadId) {
    input.onLocalError?.("Agent thread is not selected")
    return false
  }

  try {
    await threadContext.awaitThreadRuntime(input.threadId)

    const agentState = threadContext.getAgentCommandState(input.threadId)
    if (!agentState) {
      throw new Error(`Agent thread state is not initialized: ${input.threadId}`)
    }

    if (agentState.activeRun?.status === "running" || agentState.pendingApproval) {
      return false
    }

    const validationError = input.validateRun?.({
      message,
      threadId: input.threadId,
      workspacePath: agentState.workspacePath
    })

    if (validationError) {
      input.onLocalError?.(validationError)
      return false
    }

    input.onLocalError?.(null)

    window.api.agent.editLastUserMessageAndInvoke(
      input.threadId,
      {
        content: submitContent,
        id: input.messageId,
        ...(messageInput.refs.length > 0 ? { additional_kwargs: { refs: messageInput.refs } } : {})
      },
      agentState.currentModel,
      agentState.permissionMode,
      input.temporaryMode ?? false
    )

    return true
  } catch (error) {
    input.onLocalError?.(toErrorMessage(error))
    return false
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
  threadContext: Pick<ThreadContextValue, "getAgentCommandState">
  threadId: string | null
}): Promise<boolean> {
  if (!input.threadId) {
    input.onLocalError?.("Agent thread is not selected")
    return false
  }

  const agentState = input.threadContext.getAgentCommandState(input.threadId)
  if (!agentState) {
    input.onLocalError?.(`Agent thread state is not initialized: ${input.threadId}`)
    return false
  }

  if (!agentState.pendingApproval) {
    return false
  }

  if (!agentState.currentModel) {
    return false
  }

  try {
    input.onLocalError?.(null)
    window.api.agent.resume(
      input.threadId,
      {
        ...input.decision,
        request_id: agentState.pendingApproval.id,
        tool_call_id: agentState.pendingApproval.tool_call.id
      },
      agentState.currentModel
    )
    return true
  } catch (error) {
    input.onLocalError?.(toErrorMessage(error))
    return false
  }
}
