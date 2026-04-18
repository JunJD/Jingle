import { Fragment, createElement, type ReactNode } from "react"
import { useLauncherActionController } from "@/features/launcher-actions/controller"
import type { LauncherActionController } from "@/features/launcher-actions/model"
import type { NativeActionDescriptor } from "./actions"
import { NativeSurfaceHeaderLeading } from "./chrome"
import { NativeSurfaceActionLayer, NativeSurfaceActionsFooter } from "./surface-actions"

export type NativeSurfaceActionController = LauncherActionController

export interface NativeSurfaceController {
  actionController: NativeSurfaceActionController
  actionLayer: React.JSX.Element | null
  footer: React.JSX.Element
  headerLeading: React.JSX.Element
}

export function useNativeSurfaceActionController(params: {
  actions: NativeActionDescriptor[]
  primaryActionFallbackTitle: string
}): NativeSurfaceActionController {
  return useLauncherActionController(params)
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
