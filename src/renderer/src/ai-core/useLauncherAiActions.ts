import { useCallback, useMemo, type RefObject } from "react"
import type { AppCopy } from "@/lib/i18n/messages"
import { useLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
import { useShortcutCommandHandler } from "@/shortcuts/shortcut-context"
import { useLauncherActionController } from "@/features/launcher-actions/controller"
import type {
  LauncherActionController,
  LauncherActionDescriptor
} from "@/features/launcher-actions/model"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"

interface UseLauncherAiActionsOptions {
  branchThread: () => Promise<void>
  canBranchThread: boolean
  canGoToNextChat: boolean
  canGoToPreviousChat: boolean
  canStartNewQuestion: boolean
  copy: AppCopy["launcher"]
  goToNextChat: () => Promise<void>
  goToPreviousChat: () => Promise<void>
  inputRef: RefObject<LauncherInputElement | null>
  isBusy: boolean
  navigateHome: () => void
  newQuestion: () => Promise<void>
  openAttachmentPicker: () => void
  openModelPicker: () => Promise<void>
  query: string
  runPrimaryAction: () => void
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

export function useLauncherAiActions(
  options: UseLauncherAiActionsOptions
): {
  actionController: LauncherActionController
  addAttachmentShortcut: string | null
  submitShortcut: string | null
} {
  const {
    branchThread,
    canBranchThread,
    canGoToNextChat,
    canGoToPreviousChat,
    canStartNewQuestion,
    copy,
    goToNextChat,
    goToPreviousChat,
    inputRef,
    isBusy,
    navigateHome,
    newQuestion,
    openAttachmentPicker,
    openModelPicker,
    query,
    runPrimaryAction
  } = options
  const submitShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiSubmit)
  const addAttachmentShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiAddAttachment)
  const previousChatShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiGoToPreviousChat)
  const nextChatShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiGoToNextChat)
  const newQuestionShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiNewQuestion)
  const changeModelShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiChangeModel)
  const branchChatShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiBranchChat)
  const isAiInputTarget = useCallback(
    (target: EventTarget | null): boolean => target === inputRef.current,
    [inputRef]
  )

  const handleSubmitShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!isAiInputTarget(event.target)) {
        return
      }

      event.preventDefault()
      runPrimaryAction()
    },
    [isAiInputTarget, runPrimaryAction]
  )
  const handleAddAttachmentShortcut = useCallback(
    (event: KeyboardEvent): void => {
      event.preventDefault()
      openAttachmentPicker()
    },
    [openAttachmentPicker]
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

  const actions = useMemo<LauncherActionDescriptor[]>(
    () => [
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
    ],
    [
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
      goToNextChat,
      goToPreviousChat,
      copy.newQuestion,
      newQuestion,
      newQuestionShortcut,
      nextChatShortcut,
      openModelPicker,
      previousChatShortcut
    ]
  )
  const primaryAction = useMemo<LauncherActionDescriptor>(
    () => ({
      id: "launcher-ai-submit",
      onAction: runPrimaryAction,
      shortcut: submitShortcut,
      title: copy.aiPrimaryLabel
    }),
    [copy.aiPrimaryLabel, runPrimaryAction, submitShortcut]
  )
  const actionController = useLauncherActionController({
    actions,
    primaryAction,
    primaryActionFallbackTitle: copy.aiPrimaryLabel
  })

  return {
    actionController,
    addAttachmentShortcut,
    submitShortcut
  }
}
