import type { LauncherCommandRoute } from "./pages/types"

function hasRouteArguments(route: LauncherCommandRoute): boolean {
  return route.launchProps?.arguments !== undefined
}

export function commandNeedsLauncherArguments(input: {
  argumentsSchema: readonly unknown[] | undefined | null
  requiresLauncherArguments: boolean
  route: LauncherCommandRoute
}): boolean {
  return (
    input.requiresLauncherArguments &&
    Boolean(input.argumentsSchema?.length) &&
    !hasRouteArguments(input.route) &&
    input.route.launchProps?.fallbackText === undefined
  )
}
