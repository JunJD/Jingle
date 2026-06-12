import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "@shared/launcher-ai"
import { hasComposerMessageInputContent, type ComposerMessageInput } from "@shared/message-content"
import type { PermissionModeName } from "@shared/permission-mode"
import type { AgentControl, UpdateAgentThreadRecord } from "@/lib/agent-control"
import type { HITLDecision } from "@/types"
import type { AiCoreThreadCreateInput, AiCoreThreadHandle } from "./AiCoreHost"
import type { LauncherAiActiveTarget } from "./useLauncherAiThreadNavigation"

type LauncherAiDraftTarget = Extract<LauncherAiActiveTarget, { kind: "draft" }>

export interface LauncherAiControllerInput {
  agentControl: Pick<AgentControl, "clearError" | "invoke" | "resume">
  branchThreadUntilMessage: (threadId: string, messageId: string) => Promise<AiCoreThreadHandle>
  createBranchThread: (threadId: string) => Promise<AiCoreThreadHandle>
  createThread: (input: AiCoreThreadCreateInput) => Promise<AiCoreThreadHandle>
  currentModelId: string | null
  currentPermissionMode: PermissionModeName
  defaultDraftPermissionMode: PermissionModeName
  draftTarget: LauncherAiDraftTarget | null
  goToNextThread: () => Promise<string | null>
  goToPreviousThread: () => Promise<string | null>
  hasPendingApproval: boolean
  isBusy: boolean
  onDidInvoke?: () => void
  setNavigationError: (error: string | null) => void
  setLocalComposerText: (input: string) => void
  threadId: string | null
  title: string
  updateThread: UpdateAgentThreadRecord
  updateAgentThreadModel: (input: {
    modelId: string
    threadId: string
    updateThread: UpdateAgentThreadRecord
  }) => Promise<void>
  updateAgentThreadPermissionMode: (input: {
    permissionMode: PermissionModeName
    threadId: string
    updateThread: UpdateAgentThreadRecord
  }) => Promise<void>
  updateFreshDraft: (
    input: Partial<{
      modelId: string | null
      permissionMode: PermissionModeName
    }>
  ) => void
  startFreshDraftTarget: (input: {
    modelId: string | null
    permissionMode: PermissionModeName
  }) => Promise<void>
}

export interface LauncherAiController {
  branchThread: (messageId?: string) => Promise<string | null>
  clearVisibleError: () => void
  goToNextChat: () => Promise<string | null>
  goToPreviousChat: () => Promise<string | null>
  handleApprovalDecision: (decision: HITLDecision) => Promise<boolean>
  runPrimaryAction: (input: ComposerMessageInput) => void
  selectModel: (modelId: string) => Promise<boolean>
  selectPermissionMode: (permissionMode: PermissionModeName) => Promise<boolean>
  setQuery: (value: string) => void
  startFreshDraft: () => Promise<boolean>
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createLauncherAiController(input: LauncherAiControllerInput): LauncherAiController {
  let invokeInFlight = false

  const ensureThreadForInvoke = async (): Promise<string> => {
    if (input.threadId) {
      return input.threadId
    }

    const createdThread = await input.createThread({
      modelId: input.draftTarget?.modelId ?? undefined,
      permissionMode: input.draftTarget?.permissionMode ?? input.defaultDraftPermissionMode,
      source: AI_THREAD_SOURCE,
      title: input.title,
      visibility: AI_THREAD_VISIBILITY
    })

    return createdThread.threadId
  }

  const invokeLauncherInput = async (messageInput: ComposerMessageInput): Promise<boolean> => {
    if (!hasComposerMessageInputContent(messageInput)) {
      return false
    }

    try {
      input.setNavigationError(null)
      const targetThreadId = await ensureThreadForInvoke()
      return await input.agentControl.invoke(messageInput, { threadId: targetThreadId })
    } catch (error) {
      input.setNavigationError(toErrorMessage(error))
      return false
    }
  }

  return {
    async branchThread(messageId) {
      if (!input.threadId) {
        return null
      }

      try {
        input.setNavigationError(null)
        const branchedThread = messageId
          ? await input.branchThreadUntilMessage(input.threadId, messageId)
          : await input.createBranchThread(input.threadId)
        return branchedThread.threadId
      } catch (error) {
        input.setNavigationError(toErrorMessage(error))
        return null
      }
    },
    clearVisibleError() {
      input.setNavigationError(null)
      input.agentControl.clearError()
    },
    async goToNextChat() {
      try {
        input.setNavigationError(null)
        return await input.goToNextThread()
      } catch (error) {
        input.setNavigationError(toErrorMessage(error))
        return null
      }
    },
    async goToPreviousChat() {
      try {
        input.setNavigationError(null)
        return await input.goToPreviousThread()
      } catch (error) {
        input.setNavigationError(toErrorMessage(error))
        return null
      }
    },
    async handleApprovalDecision(decision) {
      return input.agentControl.resume(decision)
    },
    runPrimaryAction(messageInput) {
      if (
        invokeInFlight ||
        input.isBusy ||
        input.hasPendingApproval ||
        !hasComposerMessageInputContent(messageInput)
      ) {
        return
      }

      invokeInFlight = true
      void invokeLauncherInput(messageInput)
        .then((didInvoke) => {
          if (didInvoke) {
            input.setLocalComposerText("")
            input.onDidInvoke?.()
          }
        })
        .finally(() => {
          invokeInFlight = false
        })
    },
    async selectModel(modelId) {
      if (input.threadId) {
        try {
          input.setNavigationError(null)
          await input.updateAgentThreadModel({
            modelId,
            threadId: input.threadId,
            updateThread: input.updateThread
          })
          return true
        } catch (error) {
          input.setNavigationError(toErrorMessage(error))
          return false
        }
      }

      input.updateFreshDraft({ modelId })
      return true
    },
    async selectPermissionMode(permissionMode) {
      if (input.threadId) {
        try {
          input.setNavigationError(null)
          await input.updateAgentThreadPermissionMode({
            permissionMode,
            threadId: input.threadId,
            updateThread: input.updateThread
          })
          return true
        } catch (error) {
          input.setNavigationError(toErrorMessage(error))
          return false
        }
      }

      input.updateFreshDraft({ permissionMode })
      return true
    },
    setQuery(value) {
      input.setNavigationError(null)
      input.setLocalComposerText(value)
    },
    async startFreshDraft() {
      try {
        input.setNavigationError(null)
        await input.startFreshDraftTarget({
          modelId: input.currentModelId,
          permissionMode: input.currentPermissionMode
        })
        input.setLocalComposerText("")
        return true
      } catch (error) {
        input.setNavigationError(toErrorMessage(error))
        return false
      }
    }
  }
}
