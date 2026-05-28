import {
  type LauncherCommandAddress,
  type LauncherCommandOpenOptions,
  type LauncherNavigationDirection,
  type LauncherRoute
} from "../pages/types"

const HOME_ROUTE: LauncherRoute = { id: "home" }

export interface LauncherRouterState {
  closeActivePlugin: () => void
  navigationDirection: LauncherNavigationDirection
  openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions) => void
  route: LauncherRoute
  routeKey: string
}

export interface LauncherRouterStore {
  getState: () => LauncherRouterState
  subscribe: (listener: () => void) => () => void
}

interface LauncherRouterData {
  navigationDirection: LauncherNavigationDirection
  route: LauncherRoute
}

function getLauncherCommandOwnerId(address: LauncherCommandAddress): string {
  return address.kind === "built-in-command" ? address.builtInId : address.extensionName
}

function resolveRouteKey(route: LauncherRoute): string {
  if ("id" in route) {
    return route.id
  }

  return `${route.kind}:${getLauncherCommandOwnerId(route)}:${route.commandName}:${route.initialAction}:${route.seedQuery}:${stringifyRouteLaunchProps(route.launchProps)}`
}

function stringifyRouteLaunchProps(launchProps: LauncherCommandOpenOptions["launchProps"]): string {
  return launchProps ? JSON.stringify(launchProps) : ""
}

export function createLauncherRouterStore(): LauncherRouterStore {
  const listeners = new Set<() => void>()
  let data: LauncherRouterData = {
    navigationDirection: "forward",
    route: HOME_ROUTE
  }
  let snapshot: LauncherRouterState

  const emit = (): void => {
    snapshot = {
      ...data,
      routeKey: resolveRouteKey(data.route),
      ...actions
    }
    listeners.forEach((listener) => listener())
  }

  const setData = (
    update:
      | Partial<LauncherRouterData>
      | ((current: LauncherRouterData) => Partial<LauncherRouterData>)
  ): void => {
    const nextPartial = typeof update === "function" ? update(data) : update
    let changed = false

    for (const key of Object.keys(nextPartial) as (keyof LauncherRouterData)[]) {
      if (!Object.is(data[key], nextPartial[key])) {
        changed = true
        break
      }
    }

    if (!changed) {
      return
    }

    data = {
      ...data,
      ...nextPartial
    }
    emit()
  }

  const actions = {
    openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions): void => {
      setData({
        navigationDirection: "forward",
        route: withOptionalLaunchProps(
          {
            ...address,
            initialAction: options?.initialAction ?? "focus",
            seedQuery: options?.seedQuery ?? ""
          },
          options?.launchProps
        )
      })
    },
    closeActivePlugin: (): void => {
      setData({
        navigationDirection: "backward",
        route: HOME_ROUTE
      })
    }
  }

  snapshot = {
    ...data,
    routeKey: resolveRouteKey(data.route),
    ...actions
  }

  return {
    getState: (): LauncherRouterState => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

function withOptionalLaunchProps<T extends LauncherRoute>(
  route: T,
  launchProps: LauncherCommandOpenOptions["launchProps"]
): T {
  return launchProps ? { ...route, launchProps } : route
}
