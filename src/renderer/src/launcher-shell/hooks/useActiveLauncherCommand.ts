import { useEffect, useMemo, useRef, useState } from "react"
import type { LauncherShellConfig } from "@shared/launcher"
import type { LauncherCommandOwnerCapability } from "@shared/launcher-command-owner"
import { getLauncherCommandDefinition, getLauncherCommandOwnerId } from "../pages"
import type {
  LauncherCommandAddress,
  LauncherCommandOpenOptions,
  LauncherCommandOwnerDefinition,
  LauncherRoute,
  LauncherViewCommandDefinition
} from "../pages/types"
import {
  isLauncherBuiltInCommandAddress,
  isLauncherCommandRoute,
  isLauncherExtensionCommandRoute,
  isLauncherNoViewCommand,
  isLauncherViewCommand
} from "../pages/types"

const EMPTY_COMMAND_PREFERENCES: Record<string, unknown> = {}

interface UseActiveLauncherCommandProps {
  closeActivePlugin: () => void
  fallbackViewportHeight: number
  hideLauncher: () => Promise<void>
  openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions) => void
  route: LauncherRoute
  routeKey: string
  shellConfig: LauncherShellConfig
}

interface CommandPreferencesState {
  error: string | null
  routeKey: string
  value: Record<string, unknown> | null
}

export interface ActiveLauncherCommandState {
  activeBuiltInCommand: boolean
  activeCommandCapabilities: readonly LauncherCommandOwnerCapability[] | null
  activeCommandClipboardEnabled: boolean
  activeCommandError: string | null
  activeCommandErrorTitle: string
  activeCommandHostReady: boolean
  activeCommandNavigationEnabled: boolean
  activeCommandOwner: LauncherCommandOwnerDefinition | null
  activeCommandOwnerId: string | null
  activeCommandPreferences: Record<string, unknown> | null
  activeCommandSurfaceEnabled: boolean
  activeCommandThreadsEnabled: boolean
  activeViewCommand: LauncherViewCommandDefinition | null
  viewportHeight: number
}

/**
 * 收口当前 route 对应的命令运行态，包括 owner、能力、偏好设置和 no-view 执行。
 */
export function useActiveLauncherCommand(
  props: UseActiveLauncherCommandProps
): ActiveLauncherCommandState {
  const {
    closeActivePlugin,
    fallbackViewportHeight,
    hideLauncher,
    openCommand,
    route,
    routeKey,
    shellConfig
  } = props
  const [activeCommandPreferencesState, setActiveCommandPreferencesState] =
    useState<CommandPreferencesState>({
      error: null,
      routeKey: "",
      value: null
    })
  const lastExecutedNoViewRouteKeyRef = useRef<string | null>(null)
  const latestRouteKeyRef = useRef(routeKey)
  const activeCommandRecord = useMemo(() => {
    if (!isLauncherCommandRoute(route)) {
      return null
    }

    return getLauncherCommandDefinition(route)
  }, [route])
  const activeCommand = activeCommandRecord?.command ?? null
  const activeCommandOwner = activeCommandRecord?.owner ?? null
  const activeCommandOwnerId = isLauncherCommandRoute(route)
    ? getLauncherCommandOwnerId(route)
    : null
  const activeViewCommand =
    activeCommand && isLauncherViewCommand(activeCommand) ? activeCommand : null
  const activeNoViewCommand =
    activeCommand && isLauncherNoViewCommand(activeCommand) ? activeCommand : null
  const activeCommandPreferences =
    isLauncherCommandRoute(route) && activeCommand?.loadCommandPreferences
      ? activeCommandPreferencesState.routeKey === routeKey
        ? activeCommandPreferencesState.value
        : null
      : EMPTY_COMMAND_PREFERENCES
  const activeCommandPreferencesLoadError =
    isLauncherCommandRoute(route) && activeCommand?.loadCommandPreferences
      ? activeCommandPreferencesState.routeKey === routeKey
        ? activeCommandPreferencesState.error
        : null
      : null
  const activeCommandValidationError =
    activeCommandPreferences && activeCommand?.validateCommandPreferences
      ? activeCommand.validateCommandPreferences(activeCommandPreferences)
      : null
  const activeCommandError = activeCommandPreferencesLoadError ?? activeCommandValidationError
  const activeManifestCommand =
    isLauncherCommandRoute(route) && activeCommandOwner
      ? (activeCommandOwner.manifest.commands.find(
          (command) => command.name === route.commandName
        ) ?? null)
      : null
  const activeCommandCapabilities =
    isLauncherCommandRoute(route) && activeCommandOwner
      ? activeCommandOwner.manifest.capabilities
      : null
  const activeCommandHostReady = Boolean(
    isLauncherCommandRoute(route) &&
    activeCommand &&
    activeCommandOwner &&
    (!activeCommand.loadCommandPreferences || (activeCommandPreferences && !activeCommandError))
  )
  const activeBuiltInCommand =
    isLauncherCommandRoute(route) && isLauncherBuiltInCommandAddress(route)
  const activeCommandNavigationEnabled = activeCommandCapabilities?.includes("navigation") ?? false
  const activeCommandClipboardEnabled = activeCommandCapabilities?.includes("clipboard") ?? false
  const activeCommandSurfaceEnabled = activeCommandCapabilities?.includes("surface") ?? false
  const activeCommandThreadsEnabled = activeCommandCapabilities?.includes("threads") ?? false
  const activeCommandErrorTitle =
    activeManifestCommand?.title ?? (isLauncherCommandRoute(route) ? route.commandName : "Command")
  const viewportHeight = !isLauncherCommandRoute(route)
    ? fallbackViewportHeight
    : (activeViewCommand?.getViewportHeight(shellConfig) ?? fallbackViewportHeight)

  useEffect(() => {
    if (!isLauncherCommandRoute(route) || !activeCommand?.loadCommandPreferences) {
      return
    }

    let cancelled = false
    const loadActiveCommandPreferences = activeCommand.loadCommandPreferences
    const loadCommandPreferences = (): void => {
      void loadActiveCommandPreferences()
        .then((value) => {
          if (!cancelled) {
            setActiveCommandPreferencesState({
              error: null,
              routeKey,
              value
            })
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setActiveCommandPreferencesState({
              error: error instanceof Error ? error.message : String(error),
              routeKey,
              value: null
            })
          }
        })
    }

    loadCommandPreferences()
    const unsubscribe = window.api.nativeExtensions.onPreferencesChanged((event) => {
      if (!isLauncherExtensionCommandRoute(route)) {
        return
      }

      if (event.extensionName !== route.extensionName) {
        return
      }

      if (event.scope === "command" && event.commandName !== route.commandName) {
        return
      }

      loadCommandPreferences()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeCommand, route, routeKey])

  useEffect(() => {
    latestRouteKeyRef.current = routeKey
  }, [routeKey])

  useEffect(() => {
    if (!activeNoViewCommand || !activeCommandHostReady || !isLauncherCommandRoute(route)) {
      return
    }

    if (lastExecutedNoViewRouteKeyRef.current === routeKey) {
      return
    }

    lastExecutedNoViewRouteKeyRef.current = routeKey

    let didNavigate = false
    const navigation = activeCommandNavigationEnabled
      ? {
          goHome: () => {
            didNavigate = true
            closeActivePlugin()
          },
          hideLauncher,
          openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions) => {
            didNavigate = true
            openCommand(address, options)
          }
        }
      : undefined

    void Promise.resolve(
      activeNoViewCommand.run({
        commandPreferences: activeCommandPreferences ?? {},
        initialAction: route.initialAction,
        launchProps: route.launchProps,
        navigation,
        seedQuery: route.seedQuery
      })
    )
      .catch((error) => {
        console.error(
          `[Launcher] No-view command "${activeCommandOwner?.manifest.id ?? "unknown"}:${route.commandName}" failed:`,
          error
        )
      })
      .finally(() => {
        if (!didNavigate && latestRouteKeyRef.current === routeKey) {
          closeActivePlugin()
        }
      })
  }, [
    activeCommandHostReady,
    activeCommandNavigationEnabled,
    activeCommandOwner?.manifest.id,
    activeCommandPreferences,
    activeNoViewCommand,
    closeActivePlugin,
    hideLauncher,
    openCommand,
    route,
    routeKey
  ])

  return {
    activeBuiltInCommand,
    activeCommandCapabilities,
    activeCommandClipboardEnabled,
    activeCommandError,
    activeCommandErrorTitle,
    activeCommandHostReady,
    activeCommandNavigationEnabled,
    activeCommandOwner,
    activeCommandOwnerId,
    activeCommandPreferences,
    activeCommandSurfaceEnabled,
    activeCommandThreadsEnabled,
    activeViewCommand,
    viewportHeight
  }
}
