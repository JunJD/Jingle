import { Check } from "lucide-react"
import { createElement, useCallback, useMemo, type RefObject } from "react"
import type { AppCopy } from "@/lib/i18n/messages"
import type { PermissionModeName } from "@shared/permission-mode"
import { useLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
import { useShortcutCommandHandler } from "@/shortcuts/shortcut-context"
import { useLauncherActionController } from "@/features/launcher-actions/controller"
import type {
  LauncherActionController,
  LauncherActionDescriptor
} from "@/features/launcher-actions/model"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type { ComposerAreaHandle } from "@/composer-area"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"

interface UseLauncherAiActionsOptions {
  branchThread: (messageId?: string) => Promise<void>
  canBranchThread: boolean
  canGoToNextChat: boolean
  canGoToPreviousChat: boolean
  canStartNewQuestion: boolean
  copy: AppCopy["launcher"]
  currentPermissionMode: PermissionModeName
  goToNextChat: () => Promise<void>
  goToPreviousChat: () => Promise<void>
  inputRef: RefObject<LauncherInputElement | ComposerAreaHandle | null>
  isApprovalPending: boolean
  isBusy: boolean
  navigateHome: () => void
  newQuestion: () => Promise<void>
  openAttachmentPicker: () => void
  openModelPicker: () => Promise<void>
  query: string
  runPrimaryAction: () => void
  selectPermissionMode: (permissionMode: PermissionModeName) => void
}

const LAUNCHER_PERMISSION_MODE_ORDER: PermissionModeName[] = ["ask-to-edit", "explore", "auto"]

function isElementTargetInsideRoot(target: EventTarget | null, root: Element | null): boolean {
  if (!target || !root) {
    return false
  }

  if (target === root) {
    return true
  }

  if (typeof Node !== "undefined" && !(target instanceof Node)) {
    return false
  }

  const nodeTarget = target as Node
  return root.contains(nodeTarget)
}

export function isLauncherAiInputEventTarget(
  target: EventTarget | null,
  input: LauncherInputElement | ComposerAreaHandle | null
): boolean {
  if (!input) {
    return false
  }

  return isElementTargetInsideRoot(target, "getElement" in input ? input.getElement() : input)
}

function isPlainBackspaceShortcut(event: KeyboardEvent): boolean {
  return (
    event.key === "Backspace" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  )
}

function getPermissionModeLabel(copy: AppCopy["launcher"], mode: PermissionModeName): string {
  switch (mode) {
    case "explore":
      return copy.permissionModeExplore
    case "ask-to-edit":
      return copy.permissionModeAskToEdit
    case "auto":
      return copy.permissionModeAuto
  }
}

export function useLauncherAiActions(options: UseLauncherAiActionsOptions): {
  actionController: LauncherActionController
  addAttachmentShortcut: string | null
  permissionModeLabel: string
  submitShortcut: string | null
} {
  const {
    branchThread,
    canBranchThread,
    canGoToNextChat,
    canGoToPreviousChat,
    canStartNewQuestion,
    copy,
    currentPermissionMode,
    goToNextChat,
    goToPreviousChat,
    inputRef,
    isApprovalPending,
    isBusy,
    navigateHome,
    newQuestion,
    openAttachmentPicker,
    openModelPicker,
    query,
    runPrimaryAction,
    selectPermissionMode
  } = options
  const submitShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiSubmit)
  const addAttachmentShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiAddAttachment)
  const previousChatShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiGoToPreviousChat)
  const nextChatShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiGoToNextChat)
  const newQuestionShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiNewQuestion)
  const changeModelShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiChangeModel)
  const branchChatShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiBranchChat)
  const openMainHistoryShortcut = useLauncherCommandShortcut(
    LAUNCHER_COMMAND_IDS.searchOpenMainHistory
  )
  const isAiInputTarget = useCallback(
    (target: EventTarget | null): boolean => {
      return isLauncherAiInputEventTarget(target, inputRef.current)
    },
    [inputRef]
  )

  const handleSubmitShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!isAiInputTarget(event.target)) {
        return
      }

      if (isApprovalPending) {
        return
      }

      event.preventDefault()
      runPrimaryAction()
    },
    [isAiInputTarget, isApprovalPending, runPrimaryAction]
  )
  const handleAddAttachmentShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (isApprovalPending) {
        return
      }

      event.preventDefault()
      openAttachmentPicker()
    },
    [isApprovalPending, openAttachmentPicker]
  )
  const handleGoHomeShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (isPlainBackspaceShortcut(event)) {
        if (!isAiInputTarget(event.target) || query || isBusy) {
          return
        }
      }

      event.preventDefault()
      navigateHome()
    },
    [isAiInputTarget, isBusy, navigateHome, query]
  )
  const handleNewQuestionShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!canStartNewQuestion) {
        return
      }

      event.preventDefault()
      void newQuestion()
    },
    [canStartNewQuestion, newQuestion]
  )
  const handleChangeModelShortcut = useCallback(
    (event: KeyboardEvent): void => {
      event.preventDefault()
      void openModelPicker()
    },
    [openModelPicker]
  )
  const handleBranchChatShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!canBranchThread) {
        return
      }

      event.preventDefault()
      void branchThread()
    },
    [branchThread, canBranchThread]
  )
  const handlePreviousChatShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!canGoToPreviousChat) {
        return
      }

      event.preventDefault()
      void goToPreviousChat()
    },
    [canGoToPreviousChat, goToPreviousChat]
  )
  const handleNextChatShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!canGoToNextChat) {
        return
      }

      event.preventDefault()
      void goToNextChat()
    },
    [canGoToNextChat, goToNextChat]
  )

  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.aiSubmit, handleSubmitShortcut)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.aiAddAttachment, handleAddAttachmentShortcut)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.aiGoHome, handleGoHomeShortcut)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.aiGoToPreviousChat, handlePreviousChatShortcut)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.aiGoToNextChat, handleNextChatShortcut)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.aiNewQuestion, handleNewQuestionShortcut)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.aiChangeModel, handleChangeModelShortcut)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.aiBranchChat, handleBranchChatShortcut)

  const actions = useMemo<LauncherActionDescriptor[]>(() => {
    if (isApprovalPending) {
      return []
    }

    return [
      ...(canGoToPreviousChat
        ? [
            {
              id: "launcher-ai-go-to-previous-chat",
              onAction: goToPreviousChat,
              shortcut: previousChatShortcut,
              title: copy.goToPreviousChat
            } satisfies LauncherActionDescriptor
          ]
        : []),
      ...(canGoToNextChat
        ? [
            {
              id: "launcher-ai-go-to-next-chat",
              onAction: goToNextChat,
              shortcut: nextChatShortcut,
              title: copy.goToNextChat
            } satisfies LauncherActionDescriptor
          ]
        : []),
      ...(canStartNewQuestion
        ? [
            {
              id: "launcher-ai-new-question",
              onAction: newQuestion,
              shortcut: newQuestionShortcut,
              title: copy.newQuestion
            } satisfies LauncherActionDescriptor
          ]
        : []),
      ...LAUNCHER_PERMISSION_MODE_ORDER.map(
        (permissionMode) =>
          ({
            icon:
              permissionMode === currentPermissionMode
                ? createElement(Check, { className: "size-[var(--ow-icon-sm)]" })
                : undefined,
            id: `launcher-ai-permission-mode-${permissionMode}`,
            onAction: () => selectPermissionMode(permissionMode),
            sectionTitle: copy.permissionModeSection,
            title: getPermissionModeLabel(copy, permissionMode)
          }) satisfies LauncherActionDescriptor
      ),
      {
        id: "launcher-ai-open-main-history",
        onAction: async () => {
          await window.api.mainWindow.openWindow()
          await window.api.launcher.hide()
        },
        shortcut: openMainHistoryShortcut,
        title: copy.openAiHistory
      },
      {
        id: "launcher-ai-change-model",
        onAction: openModelPicker,
        shortcut: changeModelShortcut,
        title: copy.changeModel
      },
      ...(canBranchThread
        ? [
            {
              id: "launcher-ai-branch-chat",
              onAction: branchThread,
              shortcut: branchChatShortcut,
              title: copy.branchChat
            } satisfies LauncherActionDescriptor
          ]
        : [])
    ]
  }, [
    branchChatShortcut,
    branchThread,
    canBranchThread,
    canGoToNextChat,
    canGoToPreviousChat,
    canStartNewQuestion,
    changeModelShortcut,
    copy.branchChat,
    copy.changeModel,
    copy.goToNextChat,
    copy.goToPreviousChat,
    copy.openAiHistory,
    copy.permissionModeAskToEdit,
    copy.permissionModeAuto,
    copy.permissionModeExplore,
    copy.permissionModeSection,
    currentPermissionMode,
    goToNextChat,
    goToPreviousChat,
    isApprovalPending,
    copy.newQuestion,
    newQuestion,
    newQuestionShortcut,
    nextChatShortcut,
    openModelPicker,
    openMainHistoryShortcut,
    previousChatShortcut,
    selectPermissionMode
  ])
  const primaryAction = useMemo<LauncherActionDescriptor | null>(
    () =>
      isApprovalPending
        ? null
        : {
            id: "launcher-ai-submit",
            onAction: runPrimaryAction,
            shortcut: submitShortcut,
            title: copy.aiPrimaryLabel
          },
    [copy.aiPrimaryLabel, isApprovalPending, runPrimaryAction, submitShortcut]
  )
  const actionController = useLauncherActionController({
    actions,
    primaryAction,
    primaryActionFallbackTitle: copy.aiPrimaryLabel
  })

  return {
    actionController,
    addAttachmentShortcut,
    permissionModeLabel: getPermissionModeLabel(copy, currentPermissionMode),
    submitShortcut
  }
}
