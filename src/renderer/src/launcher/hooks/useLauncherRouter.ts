import { useCallback, useMemo, useState } from "react"
import { getLauncherFeaturePageDefinition } from "../pages"
import type {
  LauncherFeaturePageDefinition,
  LauncherFeaturePageId,
  LauncherNavigationDirection,
  LauncherRoute
} from "../pages/types"

const HOME_ROUTE: LauncherRoute = { id: "home" }

export function useLauncherRouter(): {
  activeFeaturePage: LauncherFeaturePageDefinition | null
  closeActivePage: () => void
  navigationDirection: LauncherNavigationDirection
  openFeaturePage: (
    pageId: LauncherFeaturePageId,
    options?: {
      seedQuery?: string
    }
  ) => void
  route: LauncherRoute
  routeKey: string
} {
  const [navigationDirection, setNavigationDirection] =
    useState<LauncherNavigationDirection>("forward")
  const [route, setRoute] = useState<LauncherRoute>(HOME_ROUTE)

  const openFeaturePage = useCallback(
    (
      pageId: LauncherFeaturePageId,
      options?: {
        seedQuery?: string
      }
    ): void => {
      setNavigationDirection("forward")
      setRoute({
        id: pageId,
        seedQuery: options?.seedQuery ?? ""
      })
    },
    []
  )

  const closeActivePage = useCallback((): void => {
    setNavigationDirection("backward")
    setRoute(HOME_ROUTE)
  }, [])

  const activeFeaturePage = useMemo(() => {
    if (route.id === "home") {
      return null
    }

    return getLauncherFeaturePageDefinition(route.id)
  }, [route])

  return {
    activeFeaturePage,
    closeActivePage,
    navigationDirection,
    openFeaturePage,
    route,
    routeKey: route.id
  }
}
