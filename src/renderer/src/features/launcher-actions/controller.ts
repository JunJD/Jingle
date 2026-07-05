import { useCallback, useEffect, useEffectEvent, useState } from "react"
import { useLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
import { useShortcutCommandHandler } from "@/shortcuts/shortcut-context"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import {
  findFirstExecutableLauncherAction,
  hasLauncherActionPanelEntries,
  resolveActionPanelShortcutOpenState,
  resolveLauncherActionShortcutMatch
} from "./controller-core"
import type { LauncherActionController, LauncherActionDescriptor } from "./model"

function isRichTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target instanceof HTMLTextAreaElement || target.isContentEditable
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

function hasModifierKey(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
}

export function useLauncherActionController(params: {
  actions: LauncherActionDescriptor[]
  primaryAction?: LauncherActionDescriptor | null
  primaryActionFallbackTitle: string
}): LauncherActionController {
  const { actions, primaryAction: explicitPrimaryAction, primaryActionFallbackTitle } = params
  const [showActions, setShowActions] = useState(false)
  const enabledActions = actions.filter((action) => !action.disabled)
  const primaryAction =
    explicitPrimaryAction && !explicitPrimaryAction.disabled
      ? explicitPrimaryAction
      : explicitPrimaryAction === undefined
        ? findFirstExecutableLauncherAction(enabledActions)
        : null
  const canOpenActions =
    explicitPrimaryAction !== undefined && explicitPrimaryAction !== null
      ? enabledActions.length > 0
      : hasLauncherActionPanelEntries(enabledActions)
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
  const handleActionShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        (isTextInputTarget(event.target) && !hasModifierKey(event))
      ) {
        return
      }

      const action = resolveLauncherActionShortcutMatch(enabledActions, event)
      if (!action) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      void Promise.resolve(action.onAction()).finally(closeActions)
    },
    [closeActions, enabledActions]
  )
  const handleActionShortcutEvent = useEffectEvent(handleActionShortcut)

  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.actionsOpen, handleOpenActionsShortcut)
  useShortcutCommandHandler(
    LAUNCHER_COMMAND_IDS.actionsExecutePrimary,
    handleExecutePrimaryShortcut
  )
  useEffect(() => {
    window.addEventListener("keydown", handleActionShortcutEvent, { capture: true })

    return () => {
      window.removeEventListener("keydown", handleActionShortcutEvent, { capture: true })
    }
  }, [])

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
