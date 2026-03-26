import type { ReactNode } from "react"
import { launcherPluginHostContext, type LauncherPluginHostValue } from "./LauncherPluginHost"

export function LauncherPluginHostProvider(props: {
  children: ReactNode
  value: LauncherPluginHostValue
}): React.JSX.Element {
  const { children, value } = props

  return (
    <launcherPluginHostContext.Provider value={value}>
      {children}
    </launcherPluginHostContext.Provider>
  )
}
