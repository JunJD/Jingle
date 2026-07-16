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
import type { HITLDecision, HITLRequest, ThreadForkBlockReason, ThreadForkState } from "@/types"
import type { AiCoreThreadCreateInput, AiCoreThreadHandle } from "./AiCoreHost"
import type { LauncherAiActiveTarget } from "./useLauncherAiThreadNavigation"

interface LauncherAiThreadConfiguration {
  modelId: string
  permissionMode: PermissionModeName
  threadId: string
  workspacePath: string | null
}

export interface LauncherApprovalActionsProjection {
  canApprove: boolean
  canCorrect: boolean
  canDeclineRun: boolean
  hasValidReview: boolean
}

export type LauncherApprovalCorrectionDrafts = ReadonlyMap<string, string>

export function createLauncherApprovalCorrectionKey(
  threadId: string,
  approvalRequestId: string
): string {
  return JSON.stringify([threadId, approvalRequestId])
}

export function getLauncherApprovalCorrectionDraft(
  drafts: LauncherApprovalCorrectionDrafts,
  key: string | null
): string {
  return key === null ? "" : (drafts.get(key) ?? "")
}

export function setLauncherApprovalCorrectionDraft(
  drafts: LauncherApprovalCorrectionDrafts,
  key: string,
  value: string
): LauncherApprovalCorrectionDrafts {
  if (drafts.get(key) === value) {
    return drafts
  }

  const nextDrafts = new Map(drafts)
  if (value.length === 0) {
    nextDrafts.delete(key)
  } else {
    nextDrafts.set(key, value)
  }
  return nextDrafts
}

export function clearLauncherApprovalCorrectionDraft(
  drafts: LauncherApprovalCorrectionDrafts,
  key: string
): LauncherApprovalCorrectionDrafts {
  if (!drafts.has(key)) {
    return drafts
  }

  const nextDrafts = new Map(drafts)
  nextDrafts.delete(key)
  return nextDrafts
}

export function projectLauncherApprovalActions(
  request: HITLRequest | null
): LauncherApprovalActionsProjection {
  if (!request) {
    return {
      canApprove: false,
      canCorrect: false,
      canDeclineRun: false,
      hasValidReview: false
    }
  }

  const hasValidReview = request.review !== null
  return {
    canApprove: hasValidReview && request.allowed_decisions.includes("approve"),
    canCorrect: hasValidReview && request.allowed_decisions.includes("corrected"),
    canDeclineRun: request.allowed_decisions.includes("user_declined"),
    hasValidReview
  }
}

export function canSubmitLauncherApprovalDecision(
  request: HITLRequest | null,
  decision: HITLDecision
): boolean {
  const actions = projectLauncherApprovalActions(request)
  switch (decision.type) {
    case "approve":
      return actions.canApprove
    case "corrected":
      return actions.canCorrect && decision.correction.trim().length > 0
    case "user_declined":
      return actions.canDeclineRun
  }
}

export type LauncherAiTargetConfigurationProjection =
  | {
      kind: "configured"
      modelId: string | null
      permissionMode: PermissionModeName
      source: "draft"
      workspaceKind: ThreadWorkspaceKind
      workspacePath: string | null
    }
  | {
      kind: "configured"
      modelId: string
      permissionMode: PermissionModeName
      source: "thread"
      threadId: string
      workspacePath: string | null
    }
  | {
      kind: "unavailable"
      reason: "target-unavailable" | "thread-hydrating" | "thread-state-unavailable"
    }

export type LauncherAiForkCapabilityProjection =
  | { kind: "available" }
  | {
      kind: "unavailable"
      reason: ThreadForkBlockReason | "blocked" | "not-loaded" | "thread-hydrating"
    }

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

export function projectLauncherAiTargetConfiguration(input: {
  isHydratingThread: boolean
  target: LauncherAiActiveTarget | null
  threadConfiguration: LauncherAiThreadConfiguration | null
}): LauncherAiTargetConfigurationProjection {
  if (input.target === null) {
    return { kind: "unavailable", reason: "target-unavailable" }
  }

  if (input.target.kind === "draft") {
    return {
      kind: "configured",
      modelId: input.target.modelId,
      permissionMode: input.target.permissionMode,
      source: "draft",
      workspaceKind: input.target.workspaceKind,
      workspacePath: input.target.workspacePath
    }
  }

  if (input.isHydratingThread) {
    return { kind: "unavailable", reason: "thread-hydrating" }
  }

  if (
    input.threadConfiguration === null ||
    input.threadConfiguration.threadId !== input.target.threadId
  ) {
    return { kind: "unavailable", reason: "thread-state-unavailable" }
  }

  return {
    kind: "configured",
    modelId: input.threadConfiguration.modelId,
    permissionMode: input.threadConfiguration.permissionMode,
    source: "thread",
    threadId: input.threadConfiguration.threadId,
    workspacePath: input.threadConfiguration.workspacePath
  }
}

export function projectLauncherAiForkCapability(input: {
  forkState: ThreadForkState | null
  isHydratingThread: boolean
}): LauncherAiForkCapabilityProjection {
  if (input.isHydratingThread) {
    return { kind: "unavailable", reason: "thread-hydrating" }
  }

  if (input.forkState === null) {
    return { kind: "unavailable", reason: "not-loaded" }
  }

  if (!input.forkState.canFork) {
    return { kind: "unavailable", reason: input.forkState.reason ?? "blocked" }
  }

  return { kind: "available" }
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
  targetConfiguration: LauncherAiTargetConfigurationProjection
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

function resolveDraftWorkspacePath(workspacePath: string | null): string | undefined {
  if (workspacePath === null) {
    return undefined
  }

  if (workspacePath.trim().length === 0) {
    throw new Error("Workspace path cannot be empty.")
  }

  return workspacePath
}

export function createLauncherAiController(input: LauncherAiControllerInput): LauncherAiController {
  const ensureThreadForInvoke = async (): Promise<string> => {
    if (input.targetConfiguration.kind === "unavailable") {
      throw new Error("Launcher target configuration is unavailable.")
    }

    if (input.threadId) {
      return input.threadId
    }

    if (input.targetConfiguration.source !== "draft") {
      throw new Error("Launcher target configuration is unavailable.")
    }

    const createInput: AiCoreThreadCreateInput = {
      modelId: input.targetConfiguration.modelId ?? undefined,
      permissionMode: input.targetConfiguration.permissionMode,
      source: AI_THREAD_SOURCE,
      title: input.title,
      visibility: AI_THREAD_VISIBILITY,
      workspaceKind: input.targetConfiguration.workspaceKind
    }
    const workspacePath = resolveDraftWorkspacePath(input.targetConfiguration.workspacePath)
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
        input.targetConfiguration.kind === "unavailable" ||
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
      if (input.targetConfiguration.kind === "unavailable") {
        return false
      }

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
      if (input.targetConfiguration.kind === "unavailable") {
        return false
      }

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
      if (input.targetConfiguration.kind === "unavailable") {
        return false
      }

      try {
        input.setNavigationError(null)
        await input.startFreshDraftTarget({
          modelId: input.targetConfiguration.modelId,
          permissionMode: input.targetConfiguration.permissionMode,
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
