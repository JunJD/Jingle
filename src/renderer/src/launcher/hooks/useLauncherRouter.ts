import { useCallback, useMemo, useState } from "react"
import { getLauncherPluginEntryDefinition } from "../pages"
import {
  isLauncherPluginRoute,
  type LauncherPluginEntryAddress,
  type LauncherPluginEntryDefinition,
  LauncherPluginOpenOptions,
  LauncherNavigationDirection,
  LauncherRoute
} from "../pages/types"

const HOME_ROUTE: LauncherRoute = { id: "home" }

export function useLauncherRouter(): {
  activeEntry: LauncherPluginEntryDefinition | null
  closeActivePlugin: () => void
  navigationDirection: LauncherNavigationDirection
  openEntry: (
    address: LauncherPluginEntryAddress,
    options?: LauncherPluginOpenOptions
  ) => void
  route: LauncherRoute
  routeKey: string
} {
  const [navigationDirection, setNavigationDirection] =
    useState<LauncherNavigationDirection>("forward")
  const [route, setRoute] = useState<LauncherRoute>(HOME_ROUTE)

  const openEntry = useCallback(
    (address: LauncherPluginEntryAddress, options?: LauncherPluginOpenOptions): void => {
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

  const activeEntry = useMemo(() => {
    if (!isLauncherPluginRoute(route)) {
      return null
    }

    return getLauncherPluginEntryDefinition(route).entry
  }, [route])

  return {
    activeEntry,
    closeActivePlugin,
    navigationDirection,
    openEntry,
    route,
    routeKey: isLauncherPluginRoute(route)
      ? `${route.pluginId}:${route.entryId}:${route.initialAction}:${route.seedQuery}`
      : route.id
  }
}
