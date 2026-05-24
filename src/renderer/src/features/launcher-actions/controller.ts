import { useCallback, useState } from "react"
import { useLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
import { useShortcutCommandHandler } from "@/shortcuts/shortcut-context"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import { resolveActionPanelShortcutOpenState } from "./controller-core"
import type { LauncherActionController, LauncherActionDescriptor } from "./model"

function isRichTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target instanceof HTMLTextAreaElement || target.isContentEditable
}

export function useLauncherActionController(params: {
  actions: LauncherActionDescriptor[]
  primaryAction?: LauncherActionDescriptor | null
  primaryActionFallbackTitle: string
}): LauncherActionController {
  const { actions, primaryAction: explicitPrimaryAction, primaryActionFallbackTitle } = params
  const [showActions, setShowActions] = useState(false)
  const primaryAction = explicitPrimaryAction ?? actions[0] ?? null
  const canOpenActions =
    explicitPrimaryAction !== undefined && explicitPrimaryAction !== null ? actions.length > 0 : actions.length > 1
  const actionPanelShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.actionsOpen)
  const primaryActionShortcut = useLauncherCommandShortcut(
    LAUNCHER_COMMAND_IDS.actionsExecutePrimary
  )

  const executePrimaryAction = useCallback((): void => {
    if (primaryAction) {
      void Promise.resolve(primaryAction.onAction())
    }
  }, [primaryAction])
  const openActions = useCallback((): void => {
    if (!canOpenActions) {
      return
    }

    setShowActions(true)
  }, [canOpenActions])
  const closeActions = useCallback((): void => {
    setShowActions(false)
  }, [])
  const toggleActionsForShortcut = useCallback((): void => {
    setShowActions((currentOpen) =>
      resolveActionPanelShortcutOpenState(currentOpen, canOpenActions)
    )
  }, [canOpenActions])
  const handleOpenActionsShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!canOpenActions && !showActions) {
        return
      }

      event.preventDefault()
      toggleActionsForShortcut()
    },
    [canOpenActions, showActions, toggleActionsForShortcut]
  )
  const handleExecutePrimaryShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (isRichTextInputTarget(event.target) || !primaryAction) {
        return
      }

      event.preventDefault()
      executePrimaryAction()
    },
    [executePrimaryAction, primaryAction]
  )

  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.actionsOpen, handleOpenActionsShortcut)
  useShortcutCommandHandler(
    LAUNCHER_COMMAND_IDS.actionsExecutePrimary,
    handleExecutePrimaryShortcut
  )

  return {
    actionPanelShortcut,
    actions,
    canOpenActions,
    closeActions,
    executePrimaryAction,
    openActions,
    primaryAction,
    primaryActionFallbackTitle,
    primaryActionShortcut,
    showActions
  }
}
