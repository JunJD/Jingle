import { Fragment, createElement, useCallback, useState, type ReactNode } from "react"
import { formatLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
import { useShortcutCommandHandler } from "@/shortcuts/shortcut-context"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import type { NativeActionDescriptor } from "./actions"
import { NativeSurfaceHeaderLeading } from "./chrome"
import { NativeSurfaceActionLayer, NativeSurfaceActionsFooter } from "./surface-actions"

export interface NativeSurfaceActionController {
  actionPanelShortcut: string | null
  actions: NativeActionDescriptor[]
  canOpenActions: boolean
  closeActions: () => void
  executePrimaryAction: () => void
  openActions: () => void
  primaryAction: NativeActionDescriptor | null
  primaryActionFallbackTitle: string
  primaryActionShortcut: string | null
  showActions: boolean
}

export interface NativeSurfaceController {
  actionController: NativeSurfaceActionController
  actionLayer: React.JSX.Element | null
  footer: React.JSX.Element
  headerLeading: React.JSX.Element
}

function isRichTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target instanceof HTMLTextAreaElement || target.isContentEditable
}

export function useNativeSurfaceActionController(params: {
  actions: NativeActionDescriptor[]
  primaryActionFallbackTitle: string
}): NativeSurfaceActionController {
  const { actions, primaryActionFallbackTitle } = params
  const [showActions, setShowActions] = useState(false)
  const primaryAction = actions[0] ?? null
  const canOpenActions = actions.length > 1
  const actionPanelShortcut = formatLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.actionsOpen)
  const primaryActionShortcut = formatLauncherCommandShortcut(
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
  const handleOpenActionsShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!canOpenActions) {
        return
      }

      event.preventDefault()
      openActions()
    },
    [canOpenActions, openActions]
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

function createFooterLeading(params: {
  footerCount?: string | null
  footerLabel: string
}): ReactNode {
  const { footerCount, footerLabel } = params

  return createElement(
    Fragment,
    null,
    createElement(
      "div",
      {
        className: "truncate text-[12px] uppercase tracking-[0.12em] text-muted-foreground"
      },
      footerLabel
    ),
    footerCount
      ? createElement(
          "div",
          {
            className: "shrink-0 text-[12px] text-muted-foreground"
          },
          footerCount
        )
      : null
  )
}

export function useNativeSurfaceController(params: {
  actions: NativeActionDescriptor[]
  footerCount?: string | null
  footerLabel: string
  headerLabel?: string
  primaryActionFallbackTitle: string
}): NativeSurfaceController {
  const { actions, footerCount, footerLabel, headerLabel, primaryActionFallbackTitle } = params
  const actionController = useNativeSurfaceActionController({
    actions,
    primaryActionFallbackTitle
  })

  return {
    actionController,
    actionLayer: createElement(NativeSurfaceActionLayer, { controller: actionController }),
    footer: createElement(NativeSurfaceActionsFooter, {
      controller: actionController,
      leading: createFooterLeading({ footerCount, footerLabel })
    }),
    headerLeading: createElement(NativeSurfaceHeaderLeading, { label: headerLabel })
  }
}
