import { Fragment, createElement, type ReactNode } from "react"
import { useLauncherActionController } from "@/features/launcher-actions/controller"
import type { LauncherActionDescriptor } from "@/features/launcher-actions/model"
import { NativeSurfaceHeaderLeading } from "./chrome"
import { NativeSurfaceActionLayer, NativeSurfaceActionsFooter } from "./surface-actions"

export type NativeSurfacePrimaryActionPresentation =
  | {
      execute: () => void
      kind: "ready"
      shortcut: string | null
      title: string
    }
  | {
      kind: "invalid"
      title: string
    }

export interface NativeSurfaceActionController {
  actionPanelShortcut: string | null
  actions: LauncherActionDescriptor[]
  canOpenActions: boolean
  closeActions: () => void
  openActions: () => void
  primaryActionPresentation: NativeSurfacePrimaryActionPresentation
  showActions: boolean
}

export interface NativeSurfaceController {
  actionController: NativeSurfaceActionController
  actionLayer: React.JSX.Element | null
  footer: React.JSX.Element
  headerLeading: React.JSX.Element
}

export function useNativeSurfaceActionController(params: {
  actions: LauncherActionDescriptor[]
  invalidPrimaryActionTitle: string
}): NativeSurfaceActionController {
  const { actions, invalidPrimaryActionTitle } = params
  const controller = useLauncherActionController({
    actions,
    primaryActionFallbackTitle: invalidPrimaryActionTitle
  })
  const primaryActionPresentation: NativeSurfacePrimaryActionPresentation =
    controller.primaryAction === null
      ? {
          kind: "invalid",
          title: invalidPrimaryActionTitle
        }
      : {
          execute: controller.executePrimaryAction,
          kind: "ready",
          shortcut: controller.primaryActionShortcut,
          title: controller.primaryAction.title
        }

  return {
    actionPanelShortcut: controller.actionPanelShortcut,
    actions: controller.actions,
    canOpenActions: controller.canOpenActions,
    closeActions: controller.closeActions,
    openActions: controller.openActions,
    primaryActionPresentation,
    showActions: controller.showActions
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
        className: "truncate [font-size:var(--jingle-font-meta)] font-medium text-muted-foreground"
      },
      footerLabel
    ),
    footerCount
      ? createElement(
          "div",
          {
            className: "shrink-0 [font-size:var(--jingle-font-meta)] font-medium text-muted-foreground"
          },
          footerCount
        )
      : null
  )
}

export function useNativeSurfaceController(params: {
  actions: LauncherActionDescriptor[]
  footerCount?: string | null
  footerLabel: string
  headerLabel?: string
  invalidPrimaryActionTitle: string
}): NativeSurfaceController {
  const { actions, footerCount, footerLabel, headerLabel, invalidPrimaryActionTitle } = params
  const actionController = useNativeSurfaceActionController({
    actions,
    invalidPrimaryActionTitle
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
