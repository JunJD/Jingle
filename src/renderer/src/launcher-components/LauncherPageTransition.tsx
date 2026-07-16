import { useState, type ReactNode } from "react"
import type { LauncherNavigationDirection } from "@launcher-shell/pages/types"

function LauncherPageTransitionPanel(props: {
  children: ReactNode
  direction: LauncherNavigationDirection
}): React.JSX.Element {
  const { children, direction } = props
  const [motion] = useState(() => {
    return document.documentElement.dataset.inputModality === "pointer" ? "animate" : "instant"
  })

  return (
    <div className="launcher-page-transition-panel" data-direction={direction} data-motion={motion}>
      {children}
    </div>
  )
}

export function LauncherPageTransition(props: {
  children: ReactNode
  direction: LauncherNavigationDirection
  pageKey: string
}): React.JSX.Element {
  const { children, direction, pageKey } = props

  return (
    <div className="launcher-page-transition">
      <LauncherPageTransitionPanel key={pageKey} direction={direction}>
        {children}
      </LauncherPageTransitionPanel>
    </div>
  )
}
