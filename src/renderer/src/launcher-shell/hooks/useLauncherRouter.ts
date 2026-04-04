import { useCallback, useMemo, useState } from "react"
import { getLauncherCommandDefinition, getLauncherCommandOwnerId } from "../pages"
import {
  type LauncherCommandAddress,
  type LauncherCommandDefinition,
  type LauncherCommandOpenOptions,
  isLauncherCommandRoute,
  LauncherNavigationDirection,
  LauncherRoute
} from "../pages/types"

const HOME_ROUTE: LauncherRoute = { id: "home" }

export function useLauncherRouter(): {
  activeCommand: LauncherCommandDefinition | null
  closeActivePlugin: () => void
  navigationDirection: LauncherNavigationDirection
  openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions) => void
  route: LauncherRoute
  routeKey: string
} {
  const [navigationDirection, setNavigationDirection] =
    useState<LauncherNavigationDirection>("forward")
  const [route, setRoute] = useState<LauncherRoute>(HOME_ROUTE)

  const openCommand = useCallback(
    (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions): void => {
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
    if (!isLauncherCommandRoute(route)) {
      return null
    }

    return getLauncherCommandDefinition(route).command
  }, [route])
  const routeKey = useMemo(() => {
    if ("id" in route) {
      return route.id
    }

    return `${route.kind}:${getLauncherCommandOwnerId(route)}:${route.commandName}:${route.initialAction}:${route.seedQuery}`
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
