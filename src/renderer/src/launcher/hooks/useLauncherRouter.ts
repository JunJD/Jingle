import { useCallback, useMemo, useState } from "react"
import { getLauncherPluginCommandDefinition } from "../pages"
import {
  type LauncherCommandAddress,
  isLauncherPluginRoute,
  type LauncherPluginCommandDefinition,
  LauncherPluginOpenOptions,
  LauncherNavigationDirection,
  LauncherRoute
} from "../pages/types"

const HOME_ROUTE: LauncherRoute = { id: "home" }

export function useLauncherRouter(): {
  activeCommand: LauncherPluginCommandDefinition | null
  closeActivePlugin: () => void
  navigationDirection: LauncherNavigationDirection
  openCommand: (address: LauncherCommandAddress, options?: LauncherPluginOpenOptions) => void
  route: LauncherRoute
  routeKey: string
} {
  const [navigationDirection, setNavigationDirection] =
    useState<LauncherNavigationDirection>("forward")
  const [route, setRoute] = useState<LauncherRoute>(HOME_ROUTE)

  const openCommand = useCallback(
    (address: LauncherCommandAddress, options?: LauncherPluginOpenOptions): void => {
      setNavigationDirection("forward")
      setRoute({
        ...address,
        initialAction: options?.initialAction ?? "focus",
        seedQuery: options?.seedQuery ?? ""
      })
    },
    []
  )

  const closeActivePlugin = useCallback((): void => {
    setNavigationDirection("backward")
    setRoute(HOME_ROUTE)
  }, [])

  const activeCommand = useMemo(() => {
    if (!isLauncherPluginRoute(route)) {
      return null
    }

    return getLauncherPluginCommandDefinition(route).command
  }, [route])
  const routeKey = useMemo(() => {
    if ("id" in route) {
      return route.id
    }

    return `${route.pluginId}:${route.commandName}:${route.initialAction}:${route.seedQuery}`
  }, [route])

  return {
    activeCommand,
    closeActivePlugin,
    navigationDirection,
    openCommand,
    route,
    routeKey
  }
}
