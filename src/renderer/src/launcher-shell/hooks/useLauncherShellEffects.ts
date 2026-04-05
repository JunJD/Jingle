import { useEffect, useRef, useState } from "react"
import type { LauncherRoute } from "../pages/types"
import { isLauncherCommandRoute } from "../pages/types"

interface LauncherFocusOptions {
  home?: "preserve" | "select-all"
  plugin?: "preserve" | "move-to-end"
}

interface UseLauncherShellEffectsProps {
  closeActivePlugin: () => void
  focusActiveInput: (options?: LauncherFocusOptions) => void
  hideLauncher: () => Promise<void>
  homeInputSelectionRequestVersion: number
  route: LauncherRoute
  routeKey: string
  viewportHeight: number
}

/**
 * 管理 launcher 壳层副作用：窗口高度、shown/focus 生命周期，以及 Escape / 路由切换焦点。
 */
export function useLauncherShellEffects(props: UseLauncherShellEffectsProps): {
  shownSequence: number
} {
  const {
    closeActivePlugin,
    focusActiveInput,
    hideLauncher,
    homeInputSelectionRequestVersion,
    route,
    routeKey,
    viewportHeight
  } = props
  const appliedViewportHeightRef = useRef(0)
  const previousRouteRef = useRef(route)
  const previousRouteKeyRef = useRef<string | null>(null)
  const lastHandledShownSequenceRef = useRef(0)
  const lastHandledHomeSelectionRequestRef = useRef(homeInputSelectionRequestVersion)
  const [shownSequence, setShownSequence] = useState(0)

  useEffect(() => {
    const nextHeight = Math.round(viewportHeight)
    if (nextHeight <= 0 || nextHeight === appliedViewportHeightRef.current) {
      return
    }

    appliedViewportHeightRef.current = nextHeight
    void window.api.launcher.setViewportHeight(nextHeight)
  }, [viewportHeight])

  useEffect(() => {
    const cleanupShown = window.api.launcher.onShown(() => {
      setShownSequence((value) => value + 1)

      if (appliedViewportHeightRef.current > 0) {
        void window.api.launcher.setViewportHeight(appliedViewportHeightRef.current)
      }
    })
    const handleWindowFocus = (): void => {
      focusActiveInput({
        home: "preserve",
        plugin: "preserve"
      })
    }
    window.addEventListener("focus", handleWindowFocus)

    return () => {
      cleanupShown()
      window.removeEventListener("focus", handleWindowFocus)
    }
  }, [focusActiveInput])

  useEffect(() => {
    const routeChanged = previousRouteKeyRef.current !== routeKey
    const returnedHome =
      routeChanged &&
      isLauncherCommandRoute(previousRouteRef.current) &&
      !isLauncherCommandRoute(route)
    const shownChanged = shownSequence !== lastHandledShownSequenceRef.current
    const homeSelectionRequested =
      homeInputSelectionRequestVersion !== lastHandledHomeSelectionRequestRef.current

    if (shownChanged) {
      focusActiveInput({
        home: "select-all",
        plugin: "move-to-end"
      })
      lastHandledShownSequenceRef.current = shownSequence
    } else if (!isLauncherCommandRoute(route) && homeSelectionRequested) {
      focusActiveInput({
        home: "select-all",
        plugin: "preserve"
      })
      lastHandledHomeSelectionRequestRef.current = homeInputSelectionRequestVersion
    } else if (returnedHome) {
      focusActiveInput({
        home: "select-all",
        plugin: "preserve"
      })
    } else if (routeChanged) {
      focusActiveInput({
        home: "preserve",
        plugin: "move-to-end"
      })
    }

    previousRouteRef.current = route
    previousRouteKeyRef.current = routeKey

    if (!homeSelectionRequested) {
      lastHandledHomeSelectionRequestRef.current = homeInputSelectionRequestVersion
    }
  }, [focusActiveInput, homeInputSelectionRequestVersion, route, routeKey, shownSequence])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault()
        if (isLauncherCommandRoute(route)) {
          closeActivePlugin()
          return
        }

        void hideLauncher()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [closeActivePlugin, hideLauncher, route])

  return { shownSequence }
}
