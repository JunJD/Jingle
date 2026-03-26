import { useCallback, useMemo, useState } from "react"
import { getLauncherPluginDefinition } from "../pages"
import type {
  LauncherPluginDefinition,
  LauncherPluginId,
  LauncherNavigationDirection,
  LauncherRoute
} from "../pages/types"

const HOME_ROUTE: LauncherRoute = { id: "home" }

export function useLauncherRouter(): {
  activePlugin: LauncherPluginDefinition | null
  closeActivePlugin: () => void
  navigationDirection: LauncherNavigationDirection
  openPlugin: (pluginId: LauncherPluginId, options?: { seedQuery?: string }) => void
  route: LauncherRoute
  routeKey: string
} {
  const [navigationDirection, setNavigationDirection] =
    useState<LauncherNavigationDirection>("forward")
  const [route, setRoute] = useState<LauncherRoute>(HOME_ROUTE)

  const openPlugin = useCallback(
    (pluginId: LauncherPluginId, options?: { seedQuery?: string }): void => {
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
    if (route.id === "home") {
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
    routeKey: route.id === "home" ? route.id : `${route.id}:${route.seedQuery}`
  }
}
