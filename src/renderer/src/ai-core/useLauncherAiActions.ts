import { Check, Eye, ShieldCheck, ShieldQuestion } from "lucide-react"
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
  openMainChat: () => Promise<void>
  openModelPicker: () => Promise<void>
  query: string
  runPrimaryAction: () => void
  selectPermissionMode: (permissionMode: PermissionModeName) => Promise<boolean>
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

  return root.contains(target as Node)
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

function isInteractiveSubmitTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false
  }

  const closest = (target as { closest?: (selector: string) => Element | null }).closest
  return (
    typeof closest === "function" &&
    closest.call(
      target,
      "button,input,textarea,select,a[href],[role='button'],[role='menuitem'],[role='option'],[role='tab']"
    ) !== null
  )
}

export function shouldHandleLauncherAiSubmitShortcut(
  target: EventTarget | null,
  input: LauncherInputElement | ComposerAreaHandle | null
): boolean {
  return isLauncherAiInputEventTarget(target, input) || !isInteractiveSubmitTarget(target)
}

interface PermissionModeLabels {
  askToEdit: string
  auto: string
  explore: string
}

function getPermissionModeLabelFromLabels(
  labels: PermissionModeLabels,
  mode: PermissionModeName
): string {
  switch (mode) {
    case "explore":
      return labels.explore
    case "ask-to-edit":
      return labels.askToEdit
    case "auto":
      return labels.auto
  }
}

function getPermissionModeIcon(mode: PermissionModeName): React.ReactNode {
  const className = "size-[var(--jingle-icon-action)]"

  switch (mode) {
    case "explore":
      return createElement(Eye, { className })
    case "ask-to-edit":
      return createElement(ShieldQuestion, { className })
    case "auto":
      return createElement(ShieldCheck, { className })
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
    openMainChat,
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
      if (!shouldHandleLauncherAiSubmitShortcut(event.target, inputRef.current)) {
        return
      }

      if (isApprovalPending) {
        return
      }

      event.preventDefault()
      runPrimaryAction()
    },
    [inputRef, isApprovalPending, runPrimaryAction]
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

  const permissionModeLabels = useMemo<PermissionModeLabels>(
    () => ({
      askToEdit: copy.permissionModeAskToEdit,
      auto: copy.permissionModeAuto,
      explore: copy.permissionModeExplore
    }),
    [copy.permissionModeAskToEdit, copy.permissionModeAuto, copy.permissionModeExplore]
  )
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
      {
        children: LAUNCHER_PERMISSION_MODE_ORDER.map(
          (permissionMode) =>
            ({
              accessory:
                permissionMode === currentPermissionMode
                  ? createElement(Check, { className: "size-[var(--jingle-icon-sm)]" })
                  : undefined,
              checked: permissionMode === currentPermissionMode,
              icon: getPermissionModeIcon(permissionMode),
              id: `launcher-ai-permission-mode-${permissionMode}`,
              onAction: async () => {
                await selectPermissionMode(permissionMode)
              },
              title: getPermissionModeLabelFromLabels(permissionModeLabels, permissionMode)
            }) satisfies LauncherActionDescriptor
        ),
        icon: getPermissionModeIcon(currentPermissionMode),
        id: "launcher-ai-permission-mode",
        onAction: () => {},
        title: copy.permissionModeSection
      },
      {
        id: "launcher-ai-open-main-history",
        onAction: openMainChat,
        shortcut: openMainHistoryShortcut,
        title: copy.openMainChat
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
    copy.openMainChat,
    copy.permissionModeSection,
    currentPermissionMode,
    goToNextChat,
    goToPreviousChat,
    isApprovalPending,
    copy.newQuestion,
    newQuestion,
    newQuestionShortcut,
    nextChatShortcut,
    openMainChat,
    openModelPicker,
    openMainHistoryShortcut,
    permissionModeLabels,
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
    permissionModeLabel: getPermissionModeLabelFromLabels(
      permissionModeLabels,
      currentPermissionMode
    ),
    submitShortcut
  }
}
