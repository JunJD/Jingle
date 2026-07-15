import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "@shared/launcher-ai"
import { hasComposerMessageInputContent, type ComposerMessageInput } from "@shared/message-content"
import type { PermissionModeName } from "@shared/permission-mode"
import type { ThreadWorkspaceKind } from "@shared/thread-workspace"
import type {
  AgentCommandActivity,
  AgentControl,
  EditLastUserMessageAndInvokeInput,
  UpdateAgentThreadRecord
} from "@/lib/agent-control"
import type { HITLDecision } from "@/types"
import type { AiCoreThreadCreateInput, AiCoreThreadHandle } from "./AiCoreHost"
import type { LauncherAiActiveTarget } from "./useLauncherAiThreadNavigation"

type LauncherAiDraftTarget = Extract<LauncherAiActiveTarget, { kind: "draft" }>

export function isLauncherCommandTargetCurrent(input: {
  acceptedThreadId: string
  currentTarget: LauncherAiActiveTarget | null
  submittedTarget: LauncherAiActiveTarget | null
}): boolean {
  if (input.submittedTarget?.kind === "thread") {
    return (
      input.currentTarget === input.submittedTarget &&
      input.submittedTarget.threadId === input.acceptedThreadId
    )
  }

  return (
    input.submittedTarget?.kind === "draft" &&
    input.currentTarget?.kind === "thread" &&
    input.currentTarget.threadId === input.acceptedThreadId
  )
}

interface LauncherCommandSubmissionLease {
  release(): void
}

export interface LauncherCommandSubmissionGate {
  tryAcquire(): LauncherCommandSubmissionLease | null
}

export interface LauncherComposerRevisionLedger {
  markChanged(): void
  register(input: ComposerMessageInput): void
  takeIfCurrent(input: ComposerMessageInput): boolean
}

export function createLauncherComposerRevisionLedger(): LauncherComposerRevisionLedger {
  let revision = 0
  const submitted = new WeakMap<ComposerMessageInput, number>()

  return {
    markChanged() {
      revision += 1
    },
    register(input) {
      submitted.set(input, revision)
    },
    takeIfCurrent(input) {
      const submittedRevision = submitted.get(input)
      submitted.delete(input)
      return submittedRevision !== undefined && submittedRevision === revision
    }
  }
}

export function createLauncherCommandSubmissionGate(): LauncherCommandSubmissionGate {
  let activeLease: symbol | null = null

  return {
    tryAcquire() {
      if (activeLease !== null) {
        return null
      }

      const lease = Symbol("launcher-command-submission")
      activeLease = lease
      return {
        release() {
          if (activeLease === lease) {
            activeLease = null
          }
        }
      }
    }
  }
}

export interface LauncherAiControllerInput {
  agentControl: Pick<
    AgentControl,
    "clearError" | "editLastUserMessageAndInvoke" | "invoke" | "resume"
  >
  branchThreadUntilMessage: (threadId: string, messageId: string) => Promise<AiCoreThreadHandle>
  commandSubmissionGate: LauncherCommandSubmissionGate
  createBranchThread: (threadId: string) => Promise<AiCoreThreadHandle>
  createThread: (input: AiCoreThreadCreateInput) => Promise<AiCoreThreadHandle>
  currentModelId: string | null
  currentPermissionMode: PermissionModeName
  defaultDraftPermissionMode: PermissionModeName
  draftTarget: LauncherAiDraftTarget | null
  goToNextThread: () => Promise<string | null>
  goToPreviousThread: () => Promise<string | null>
  hasPendingCommand: boolean
  hasPendingApproval: boolean
  isBusy: boolean
  onCommandAdmitted?: (activity: AgentCommandActivity) => void
  onCommandSettled?: (activity: AgentCommandActivity) => void
  onDidInvoke?: (messageInput: ComposerMessageInput, threadId: string) => void
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
      workspaceKind: ThreadWorkspaceKind
      workspacePath: string | null
    }>
  ) => void
  startFreshDraftTarget: (input: {
    modelId: string | null
    permissionMode: PermissionModeName
    workspaceKind?: ThreadWorkspaceKind
    workspacePath?: string | null
  }) => Promise<void>
}

export interface LauncherAiController {
  branchThread: (messageId?: string) => Promise<string | null>
  clearVisibleError: () => void
  editLastUserMessage: (input: EditLastUserMessageAndInvokeInput) => Promise<boolean>
  goToNextChat: () => Promise<string | null>
  goToPreviousChat: () => Promise<string | null>
  handleApprovalDecision: (decision: HITLDecision) => Promise<boolean>
  runPrimaryAction: (input: ComposerMessageInput) => void
  selectModel: (modelId: string) => Promise<boolean>
  selectPermissionMode: (permissionMode: PermissionModeName) => Promise<boolean>
  setQuery: (value: string) => void
  startFreshDraft: (input?: {
    workspaceKind?: ThreadWorkspaceKind
    workspacePath?: string | null
  }) => Promise<boolean>
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveDraftWorkspacePath(draftTarget: LauncherAiDraftTarget | null): string | undefined {
  if (!draftTarget || draftTarget.workspacePath === null) {
    return undefined
  }

  if (draftTarget.workspacePath.trim().length === 0) {
    throw new Error("Workspace path cannot be empty.")
  }

  return draftTarget.workspacePath
}

export function createLauncherAiController(input: LauncherAiControllerInput): LauncherAiController {
  const ensureThreadForInvoke = async (): Promise<string> => {
    if (input.threadId) {
      return input.threadId
    }

    const createInput: AiCoreThreadCreateInput = {
      modelId: input.draftTarget?.modelId ?? undefined,
      permissionMode: input.draftTarget?.permissionMode ?? input.defaultDraftPermissionMode,
      source: AI_THREAD_SOURCE,
      title: input.title,
      visibility: AI_THREAD_VISIBILITY,
      workspaceKind: input.draftTarget?.workspaceKind ?? "projectless"
    }
    const workspacePath = resolveDraftWorkspacePath(input.draftTarget)
    if (workspacePath !== undefined) {
      createInput.workspacePath = workspacePath
    }

    const createdThread = await input.createThread(createInput)

    return createdThread.threadId
  }

  const invokeLauncherInput = async (
    messageInput: ComposerMessageInput
  ): Promise<{ accepted: boolean; threadId: string | null }> => {
    if (!hasComposerMessageInputContent(messageInput)) {
      return { accepted: false, threadId: null }
    }

    try {
      input.setNavigationError(null)
      const targetThreadId = await ensureThreadForInvoke()
      return {
        accepted: await input.agentControl.invoke(messageInput, {
          onCommandAdmitted: input.onCommandAdmitted,
          onCommandSettled: input.onCommandSettled,
          threadId: targetThreadId
        }),
        threadId: targetThreadId
      }
    } catch (error) {
      input.setNavigationError(toErrorMessage(error))
      return { accepted: false, threadId: null }
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
    async editLastUserMessage(editInput) {
      if (
        input.isBusy ||
        input.hasPendingCommand ||
        input.hasPendingApproval ||
        !input.threadId ||
        !hasComposerMessageInputContent(editInput.messageInput)
      ) {
        return false
      }

      const submissionLease = input.commandSubmissionGate.tryAcquire()
      if (submissionLease === null) {
        return false
      }

      try {
        input.setNavigationError(null)
        return await input.agentControl.editLastUserMessageAndInvoke(editInput, {
          onCommandAdmitted: input.onCommandAdmitted,
          onCommandSettled: input.onCommandSettled,
          threadId: input.threadId
        })
      } catch (error) {
        input.setNavigationError(toErrorMessage(error))
        return false
      } finally {
        submissionLease.release()
      }
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
      if (input.hasPendingCommand) {
        return false
      }

      const submissionLease = input.commandSubmissionGate.tryAcquire()
      if (submissionLease === null) {
        return false
      }

      try {
        return await input.agentControl.resume(decision, {
          onCommandAdmitted: input.onCommandAdmitted,
          onCommandSettled: input.onCommandSettled
        })
      } finally {
        submissionLease.release()
      }
    },
    runPrimaryAction(messageInput) {
      if (
        input.hasPendingCommand ||
        input.hasPendingApproval ||
        !hasComposerMessageInputContent(messageInput)
      ) {
        return
      }

      const submissionLease = input.commandSubmissionGate.tryAcquire()
      if (submissionLease === null) {
        return
      }

      void invokeLauncherInput(messageInput)
        .then((result) => {
          if (result.accepted && result.threadId) {
            input.onDidInvoke?.(messageInput, result.threadId)
          }
        })
        .finally(() => {
          submissionLease.release()
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
    async startFreshDraft(draftInput) {
      try {
        input.setNavigationError(null)
        await input.startFreshDraftTarget({
          modelId: input.currentModelId,
          permissionMode: input.currentPermissionMode,
          workspaceKind: draftInput?.workspaceKind,
          workspacePath: draftInput?.workspacePath
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
