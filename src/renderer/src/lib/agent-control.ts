import type { HITLDecision } from "@/types"
import {
  buildJingleAgentCommandEnvelope,
  buildJingleAgentCommandMessage,
  buildJingleAgentModelMetadataUpdate,
  buildJingleAgentPermissionMetadataUpdate,
  buildJingleAgentResumeDecision,
  resolveJingleAgentEditReadiness,
  resolveJingleAgentFollowUpPlan,
  resolveJingleAgentInvokeReadiness,
  resolveJingleAgentResumeReadiness,
  type JingleAgentFollowUpAction,
  type JingleAgentFollowUpMode,
  type JingleAgentRunValidationInput,
  type JingleAgentRunValidator
} from "@jingle/agent-client"
import type { ComposerMessageInput } from "@shared/message-content"
import { type PermissionModeName } from "@shared/permission-mode"
import type { AgentCommandLifecycleEvent, AgentCommandOutcome } from "@shared/agent-command"
import type { ThreadContextValue } from "./thread-context"

export type AgentRunValidationInput = JingleAgentRunValidationInput

export type AgentRunValidator = JingleAgentRunValidator

export interface AgentCommandActivity {
  commandId: string
  threadId: string
}

interface AgentCommandLifecycleCallbacks {
  onCommandAdmitted?: (activity: AgentCommandActivity) => void
  onCommandSettled?: (activity: AgentCommandActivity) => void
}

export interface AgentControl {
  clearError: () => void
  editLastUserMessageAndInvoke: (
    input: EditLastUserMessageAndInvokeInput,
    options?: AgentCommandLifecycleCallbacks & { threadId?: string }
  ) => Promise<boolean>
  invoke: (
    input: ComposerMessageInput,
    options?: {
      followUpAction?: JingleAgentFollowUpAction
      threadId?: string
    } & AgentCommandLifecycleCallbacks
  ) => Promise<boolean>
  resume: (decision: HITLDecision, options?: AgentCommandLifecycleCallbacks) => Promise<boolean>
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
  followUpAction?: JingleAgentFollowUpAction
  onQueueFollowUp?: (messageInput: ComposerMessageInput) => Promise<void> | void
  onLocalError?: (error: string | null) => void
  onCommandAdmitted?: (activity: AgentCommandActivity) => void
  onCommandSettled?: (activity: AgentCommandActivity) => void
  temporaryMode?: boolean
  threadContext: Pick<
    ThreadContextValue,
    "awaitThreadRuntime" | "getAgentCommandState" | "loadThreadData"
  >
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

function acceptAgentCommandOutcome(
  outcome: AgentCommandOutcome,
  onLocalError?: (error: string | null) => void
): boolean {
  if (outcome.type === "rejected") {
    onLocalError?.(outcome.error.message)
    return false
  }

  return true
}

type AgentCommandProjectionEvent = Extract<
  AgentCommandLifecycleEvent,
  { type: "projection_applied" | "projection_failed" }
>

function observeAgentCommandLifecycle(input: {
  commandId: string
  onAdmitted?: (activity: AgentCommandActivity) => void
  threadId: string
}): {
  dispose(): void
  projection: Promise<AgentCommandProjectionEvent>
} {
  let resolveProjection!: (event: AgentCommandProjectionEvent) => void
  let projectionSettled = false
  const projection = new Promise<AgentCommandProjectionEvent>((resolve) => {
    resolveProjection = resolve
  })
  const dispose = window.api.agent.observeCommandLifecycle(input.commandId, (event) => {
    if (event.threadId !== input.threadId) {
      return
    }

    if (event.type === "admitted") {
      input.onAdmitted?.({ commandId: input.commandId, threadId: input.threadId })
      return
    }

    if (!projectionSettled) {
      projectionSettled = true
      resolveProjection(event)
    }
  })

  return { dispose, projection }
}

async function resolveAgentCommandProjection(input: {
  event: AgentCommandProjectionEvent
  onLocalError?: (error: string | null) => void
  threadContext: Pick<ThreadContextValue, "loadThreadData">
  threadId: string
}): Promise<void> {
  const projectionError =
    input.event.type === "projection_failed" ? input.event.error.message : null
  if (projectionError) {
    input.onLocalError?.(projectionError)
  }

  try {
    await input.threadContext.loadThreadData(input.threadId)
    if (projectionError === null) {
      input.onLocalError?.(null)
    }
  } catch (error) {
    const synchronizationError = toErrorMessage(error)
    input.onLocalError?.(
      projectionError
        ? `${projectionError} Thread reload failed: ${synchronizationError}`
        : `Agent command projection could not be synchronized: ${synchronizationError}`
    )
  }
}

async function updateAgentThreadMetadata(input: {
  metadata: (currentMetadata: Record<string, unknown> | undefined) => Record<string, unknown>
  threadContext: Pick<ThreadContextValue, "loadThreadData">
  threadId: string
  updateThread: UpdateAgentThreadRecord
}): Promise<void> {
  const thread = await window.api.threads.get(input.threadId)
  if (!thread) {
    throw new Error(`Agent thread is not found: ${input.threadId}`)
  }

  await input.updateThread(input.threadId, {
    metadata: input.metadata(thread.metadata)
  })
  await input.threadContext.loadThreadData(input.threadId)
}

export async function updateAgentThreadModel(input: UpdateAgentThreadModelInput): Promise<void> {
  await updateAgentThreadMetadata({
    metadata: (currentMetadata) =>
      buildJingleAgentModelMetadataUpdate({
        currentMetadata,
        modelId: input.modelId
      }),
    threadContext: input.threadContext,
    threadId: input.threadId,
    updateThread: input.updateThread
  })
}

export async function updateAgentThreadPermissionMode(
  input: UpdateAgentThreadPermissionModeInput
): Promise<void> {
  await updateAgentThreadMetadata({
    metadata: (currentMetadata) =>
      buildJingleAgentPermissionMetadataUpdate({
        currentMetadata,
        permissionMode: input.permissionMode
      }),
    threadContext: input.threadContext,
    threadId: input.threadId,
    updateThread: input.updateThread
  })
}

export async function invokeAgentThread(input: InvokeAgentThreadInput): Promise<boolean> {
  const { messageInput, threadContext } = input
  const commandEnvelope = buildJingleAgentCommandEnvelope({
    messageInput
  })

  if (!commandEnvelope) {
    return false
  }

  if (!input.threadId) {
    input.onLocalError?.("Agent thread is not selected")
    return false
  }

  try {
    await threadContext.awaitThreadRuntime(input.threadId)

    const agentState = threadContext.getAgentCommandState(input.threadId)
    const readiness = resolveJingleAgentInvokeReadiness({
      state: agentState,
      threadId: input.threadId
    })
    if (readiness.type === "error") {
      throw new Error(readiness.message)
    }
    if (readiness.type === "blocked") {
      return false
    }
    const commandState = readiness.state

    const isRunningFollowUp = commandState.activeRun?.status === "running"
    const configuredFollowUpMode: JingleAgentFollowUpMode | undefined =
      isRunningFollowUp && !input.followUpAction
        ? (await window.api.settings.getAgentConfig()).followUpMode
        : undefined
    const followUpPlan = resolveJingleAgentFollowUpPlan({
      configuredMode: configuredFollowUpMode,
      isRunning: isRunningFollowUp,
      requestedAction: input.followUpAction
    })

    const validationError = input.validateRun?.({
      message: commandEnvelope.validationText,
      threadId: input.threadId,
      workspacePath: commandState.workspacePath
    })

    if (validationError) {
      input.onLocalError?.(validationError)
      return false
    }

    input.onLocalError?.(null)

    if (followUpPlan.type === "queue") {
      if (!input.onQueueFollowUp) {
        throw new Error("Agent follow-up queue control is not available")
      }
      await input.onQueueFollowUp(messageInput)
      return true
    }

    const commandId = crypto.randomUUID()
    const activity = { commandId, threadId: input.threadId }
    const lifecycle = observeAgentCommandLifecycle({
      commandId,
      onAdmitted: input.onCommandAdmitted,
      threadId: input.threadId
    })
    try {
      const outcome: AgentCommandOutcome = await window.api.agent.invoke(
        input.threadId,
        buildJingleAgentCommandMessage({
          envelope: commandEnvelope,
          messageId: commandId
        }),
        commandState.currentModel,
        commandState.permissionMode,
        input.temporaryMode ?? false,
        followUpPlan.action,
        followUpPlan.action === "steer" && commandState.activeRun
          ? commandState.activeRun.runId
          : undefined,
        followUpPlan.action === "steer" && commandState.activeRun
          ? commandState.activeRun.turnId
          : undefined
      )

      if (!acceptAgentCommandOutcome(outcome, input.onLocalError)) {
        return false
      }
      await resolveAgentCommandProjection({
        event: await lifecycle.projection,
        onLocalError: input.onLocalError,
        threadContext,
        threadId: input.threadId
      })
      return true
    } finally {
      lifecycle.dispose()
      input.onCommandSettled?.(activity)
    }
  } catch (error) {
    input.onLocalError?.(toErrorMessage(error))
    return false
  }
}

export async function editLastUserMessageAndInvokeAgentThread(
  input: InvokeAgentThreadInput & { messageId: string }
): Promise<boolean> {
  const { messageInput, threadContext } = input
  const commandEnvelope = buildJingleAgentCommandEnvelope({
    messageInput
  })

  if (!commandEnvelope) {
    return false
  }

  if (!input.threadId) {
    input.onLocalError?.("Agent thread is not selected")
    return false
  }

  try {
    await threadContext.awaitThreadRuntime(input.threadId)

    const agentState = threadContext.getAgentCommandState(input.threadId)
    const readiness = resolveJingleAgentEditReadiness({
      state: agentState,
      threadId: input.threadId
    })
    if (readiness.type === "error") {
      throw new Error(readiness.message)
    }
    if (readiness.type === "blocked") {
      return false
    }
    const commandState = readiness.state

    const validationError = input.validateRun?.({
      message: commandEnvelope.validationText,
      threadId: input.threadId,
      workspacePath: commandState.workspacePath
    })

    if (validationError) {
      input.onLocalError?.(validationError)
      return false
    }

    input.onLocalError?.(null)

    const commandId = input.messageId
    const activity = { commandId, threadId: input.threadId }
    const lifecycle = observeAgentCommandLifecycle({
      commandId,
      onAdmitted: input.onCommandAdmitted,
      threadId: input.threadId
    })
    try {
      const outcome = await window.api.agent.editLastUserMessageAndInvoke(
        input.threadId,
        buildJingleAgentCommandMessage({
          envelope: commandEnvelope,
          messageId: input.messageId
        }),
        commandState.currentModel,
        commandState.permissionMode,
        input.temporaryMode ?? false
      )

      if (!acceptAgentCommandOutcome(outcome, input.onLocalError)) {
        return false
      }
      await resolveAgentCommandProjection({
        event: await lifecycle.projection,
        onLocalError: input.onLocalError,
        threadContext,
        threadId: input.threadId
      })
      return true
    } finally {
      lifecycle.dispose()
      input.onCommandSettled?.(activity)
    }
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
  onCommandAdmitted?: (activity: AgentCommandActivity) => void
  onCommandSettled?: (activity: AgentCommandActivity) => void
  onLocalError?: (error: string | null) => void
  threadContext: Pick<ThreadContextValue, "getAgentCommandState" | "loadThreadData">
  threadId: string | null
}): Promise<boolean> {
  if (!input.threadId) {
    input.onLocalError?.("Agent thread is not selected")
    return false
  }

  const agentState = input.threadContext.getAgentCommandState(input.threadId)
  const readiness = resolveJingleAgentResumeReadiness({
    state: agentState,
    threadId: input.threadId
  })
  if (readiness.type === "error") {
    input.onLocalError?.(readiness.message)
    return false
  }
  if (readiness.type === "blocked") {
    return false
  }
  const commandState = readiness.state

  try {
    input.onLocalError?.(null)
    const commandId = commandState.pendingApproval.id
    const activity = { commandId, threadId: input.threadId }
    const lifecycle = observeAgentCommandLifecycle({
      commandId,
      onAdmitted: input.onCommandAdmitted,
      threadId: input.threadId
    })
    try {
      const outcome = await window.api.agent.resume(
        input.threadId,
        buildJingleAgentResumeDecision({
          decision: input.decision,
          pendingApproval: commandState.pendingApproval
        }),
        commandState.currentModel
      )
      if (!acceptAgentCommandOutcome(outcome, input.onLocalError)) {
        return false
      }
      await resolveAgentCommandProjection({
        event: await lifecycle.projection,
        onLocalError: input.onLocalError,
        threadContext: input.threadContext,
        threadId: input.threadId
      })
      return true
    } finally {
      lifecycle.dispose()
      input.onCommandSettled?.(activity)
    }
  } catch (error) {
    input.onLocalError?.(toErrorMessage(error))
    return false
  }
}
