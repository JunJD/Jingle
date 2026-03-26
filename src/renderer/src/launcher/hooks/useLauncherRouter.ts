import { useCallback, useMemo, useState } from "react"
import { getLauncherPluginDefinition } from "../pages"
import {
  isLauncherPluginRoute,
  type LauncherPluginDefinition,
  LauncherPluginOpenOptions,
  LauncherPluginId,
  LauncherNavigationDirection,
  LauncherRoute
} from "../pages/types"

const HOME_ROUTE: LauncherRoute = { id: "home" }

export function useLauncherRouter(): {
  activePlugin: LauncherPluginDefinition | null
  closeActivePlugin: () => void
  navigationDirection: LauncherNavigationDirection
  openPlugin: (pluginId: LauncherPluginId, options?: LauncherPluginOpenOptions) => void
  route: LauncherRoute
  routeKey: string
} {
  const [navigationDirection, setNavigationDirection] =
    useState<LauncherNavigationDirection>("forward")
  const [route, setRoute] = useState<LauncherRoute>(HOME_ROUTE)

  const openPlugin = useCallback(
    (pluginId: LauncherPluginId, options?: LauncherPluginOpenOptions): void => {
      setNavigationDirection("forward")
      setRoute({ id: pluginId, seedQuery: options?.seedQuery ?? "" })
    },
    []
  )

  const closeActivePlugin = useCallback((): void => {
    setNavigationDirection("backward")
    setRoute(HOME_ROUTE)
  }, [])

  const activePlugin = useMemo(() => {
    if (!isLauncherPluginRoute(route)) {
      return null
    }

    return getLauncherPluginDefinition(route.id)
  }, [route])

  return {
    activePlugin,
    closeActivePlugin,
    navigationDirection,
    openPlugin,
    route,
    routeKey: isLauncherPluginRoute(route) ? `${route.id}:${route.seedQuery}` : route.id
  }
}
