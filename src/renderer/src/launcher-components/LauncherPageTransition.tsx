import type { ReactNode } from "react"
import type { LauncherNavigationDirection } from "@launcher-shell/pages/types"

export function LauncherPageTransition(props: {
  children: ReactNode
  direction: LauncherNavigationDirection
  pageKey: string
}): React.JSX.Element {
  const { children, direction, pageKey } = props

  return (
    <div className="launcher-page-transition">
      <div key={pageKey} className="launcher-page-transition-panel" data-direction={direction}>
        {children}
      </div>
    </div>
  )
}
