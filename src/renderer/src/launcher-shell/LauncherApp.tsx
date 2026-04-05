import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AiCoreHostProvider } from "@ai-core/AiCoreHost"
import { AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { useLauncherClipboard } from "./LauncherClipboardContext"
import { deriveLauncherCommandOwnerClipboardContext } from "../../../shared/clipboard-derivations"
import type { LauncherInputStatus } from "./launcher-input-status"
import type { LauncherInputElement } from "./input-element"
import { LauncherCommandErrorPage } from "@launcher-components/LauncherCommandErrorPage"
import { LauncherIntelligenceGlow } from "@launcher-components/LauncherIntelligenceGlow"
import { LauncherPageTransition } from "@launcher-components/LauncherPageTransition"
import { LauncherSearchPage } from "@launcher-components/LauncherSearchPage"
import { useLauncherRouter } from "./hooks/useLauncherRouter"
import { useLauncherSearchPage } from "./hooks/useLauncherSearchPage"
import { NativeExtensionHostProvider } from "@extension-host/NativeExtensionHost"
import { NativeExtensionPassiveCommandHosts } from "@extension-host/PassiveCommandHosts"
import { getLauncherCommandDefinition, getLauncherCommandOwnerId } from "./pages"
import {
  isLauncherBuiltInCommandAddress,
  isLauncherCommandRoute,
  isLauncherExtensionCommandRoute,
  isLauncherNoViewCommand,
  isLauncherViewCommand
} from "./pages/types"
import { invokeThreadMessage } from "@/lib/ai-invocation"
import { useI18n } from "@/lib/i18n"
import { useThreadContext } from "@/lib/thread-context"

type HomeInputFocusBehavior = "preserve" | "select-all"
type PluginInputFocusBehavior = "preserve" | "move-to-end"

const EMPTY_COMMAND_PREFERENCES: Record<string, unknown> = {}

interface LauncherThreadCreateInput {
  draftInput?: string
  source: string
  title: string
  visibility: string
}

interface LauncherThreadSubmitInput {
  message: string
  threadId: string
}

export default function LauncherApp(): React.JSX.Element {
  const { copy } = useI18n()
  const inputNeedsWorkspaceMessage = copy.chat.inputNeedsWorkspace
  const clipboard = useLauncherClipboard()
  const threadContext = useThreadContext()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pluginInputRef = useRef<LauncherInputElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const viewportHeightRef = useRef(0)
  const [shownSequence, setShownSequence] = useState(0)
  const { activeCommand, closeActivePlugin, navigationDirection, openCommand, route, routeKey } =
    useLauncherRouter()
  const [pluginInputSurface, setPluginInputSurface] = useState<{
    routeKey: string
    status: LauncherInputStatus
  }>({
    routeKey,
    status: "idle"
  })
  const [activeCommandPreferencesState, setActiveCommandPreferencesState] = useState<{
    error: string | null
    routeKey: string
    value: Record<string, unknown> | null
  }>({
    error: null,
    routeKey: "",
    value: null
  })
  const searchPage = useLauncherSearchPage({ openCommand })
  const previousRouteRef = useRef(route)
  const previousRouteKeyRef = useRef<string | null>(null)
  const lastHandledShownSequenceRef = useRef(shownSequence)
  const lastHandledHomeSelectionRequestRef = useRef(searchPage.homeInputSelectionRequestVersion)
  const lastExecutedNoViewRouteKeyRef = useRef<string | null>(null)
  const latestRouteKeyRef = useRef(routeKey)
  const activeCommandRecord = useMemo(() => {
    if (!isLauncherCommandRoute(route)) {
      return null
    }

    return getLauncherCommandDefinition(route)
  }, [route])
  const activeCommandOwnerId = isLauncherCommandRoute(route)
    ? getLauncherCommandOwnerId(route)
    : null
  const activeCommandOwner = activeCommandRecord?.owner ?? null
  const activeViewCommand =
    activeCommand && isLauncherViewCommand(activeCommand) ? activeCommand : null
  const activeNoViewCommand =
    activeCommand && isLauncherNoViewCommand(activeCommand) ? activeCommand : null
  const ActivePluginComponent = activeViewCommand?.Component ?? null
  const viewportHeight = !isLauncherCommandRoute(route)
    ? searchPage.viewportHeight
    : (activeViewCommand?.getViewportHeight(searchPage.shellConfig) ?? searchPage.viewportHeight)
  const pluginInputStatus =
    pluginInputSurface.routeKey === routeKey ? pluginInputSurface.status : "idle"
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
  const setPluginInputStatus = useCallback(
    (status: LauncherInputStatus): void => {
      setPluginInputSurface({
        routeKey,
        status
      })
    },
    [routeKey]
  )
  const focusHomeInput = useCallback((behavior: HomeInputFocusBehavior): void => {
    const input = searchInputRef.current
    if (!input) {
      return
    }

    input.focus()

    if (behavior === "select-all") {
      input.select()
    }
  }, [])
  const focusPluginInput = useCallback((behavior: PluginInputFocusBehavior): void => {
    const input = pluginInputRef.current
    if (!input) {
      return
    }

    input.focus()

    if (behavior === "move-to-end") {
      const caretPosition = input.value.length
      input.setSelectionRange(caretPosition, caretPosition)
    }
  }, [])
  const focusActiveInput = useCallback(
    (options?: { home?: HomeInputFocusBehavior; plugin?: PluginInputFocusBehavior }): void => {
      if (isLauncherCommandRoute(route)) {
        focusPluginInput(options?.plugin ?? "move-to-end")
        return
      }

      focusHomeInput(options?.home ?? "preserve")
    },
    [focusHomeInput, focusPluginInput, route]
  )

  const setViewportHeight = useCallback((height: number): void => {
    const nextHeight = Math.round(height)
    if (nextHeight <= 0 || nextHeight === viewportHeightRef.current) {
      return
    }

    viewportHeightRef.current = nextHeight
    void window.api.launcher.setViewportHeight(nextHeight)
  }, [])
  const hideLauncher = useCallback(() => {
    return window.api.launcher.hide()
  }, [])
  const createPluginThread = useCallback(
    async (input: LauncherThreadCreateInput) => {
      const [defaultModelId, workspacePathResult] = await Promise.all([
        window.api.models.getDefault(),
        window.api.workspace.get()
      ])

      if (!workspacePathResult) {
        throw new Error(inputNeedsWorkspaceMessage)
      }
      const workspacePath = workspacePathResult

      const thread = await window.api.threads.create({
        model: defaultModelId,
        source: input.source,
        title: input.title,
        visibility: input.visibility,
        workspacePath
      })

      threadContext.initializeThread(thread.thread_id)
      const actions = threadContext.getThreadActions(thread.thread_id)
      actions.setCurrentModel(defaultModelId)
      actions.setWorkspacePath(workspacePath)
      actions.setDraftInput(input.draftInput ?? "")

      return {
        modelId: defaultModelId,
        threadId: thread.thread_id,
        workspacePath
      }
    },
    [inputNeedsWorkspaceMessage, threadContext]
  )
  const submitPluginThread = useCallback(
    async (input: LauncherThreadSubmitInput): Promise<void> => {
      await invokeThreadMessage({
        message: input.message,
        threadContext,
        threadId: input.threadId
      })
    },
    [threadContext]
  )

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

    const navigation = activeCommandNavigationEnabled
      ? {
          goHome: closeActivePlugin,
          hideLauncher,
          openCommand
        }
      : undefined

    void Promise.resolve(
      activeNoViewCommand.run({
        commandPreferences: activeCommandPreferences ?? {},
        initialAction: route.initialAction,
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
        if (latestRouteKeyRef.current === routeKey) {
          closeActivePlugin()
        }
      })
  }, [
    activeCommandHostReady,
    activeCommandNavigationEnabled,
    activeNoViewCommand,
    activeCommandPreferences,
    activeCommandOwner?.manifest.id,
    closeActivePlugin,
    hideLauncher,
    openCommand,
    route,
    routeKey
  ])

  useEffect(() => {
    setViewportHeight(viewportHeight)
  }, [setViewportHeight, viewportHeight])

  useEffect(() => {
    const cleanupShown = window.api.launcher.onShown(() => {
      setShownSequence((value) => value + 1)
      if (viewportHeightRef.current > 0) {
        setViewportHeight(viewportHeightRef.current)
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
  }, [focusActiveInput, setViewportHeight])

  useEffect(() => {
    const routeChanged = previousRouteKeyRef.current !== routeKey
    const returnedHome =
      routeChanged &&
      isLauncherCommandRoute(previousRouteRef.current) &&
      !isLauncherCommandRoute(route)
    const shownChanged = shownSequence !== lastHandledShownSequenceRef.current
    const homeSelectionRequested =
      searchPage.homeInputSelectionRequestVersion !== lastHandledHomeSelectionRequestRef.current

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
      lastHandledHomeSelectionRequestRef.current = searchPage.homeInputSelectionRequestVersion
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
      lastHandledHomeSelectionRequestRef.current = searchPage.homeInputSelectionRequestVersion
    }
  }, [
    focusActiveInput,
    route,
    routeKey,
    searchPage.homeInputSelectionRequestVersion,
    shownSequence
  ])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault()
        if (isLauncherCommandRoute(route)) {
          closeActivePlugin()
          return
        }

        void window.api.launcher.hide()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [closeActivePlugin, route])

  return (
    <div className="launcher-window-frame">
      <div
        ref={shellRef}
        className="launcher-window-shell"
        data-active-plugin={activeCommandOwnerId ?? "home"}
        data-active-command-owner={activeCommandOwnerId ?? "home"}
      >
        <div className="launcher-shell-content">
          <LauncherPageTransition direction={navigationDirection} pageKey={routeKey}>
            {activeCommandError ? (
              <LauncherCommandErrorPage
                description={activeCommandError}
                onBack={closeActivePlugin}
                onOpenSettings={() => {
                  if (!isLauncherExtensionCommandRoute(route)) {
                    return
                  }

                  void window.api.settings.openWindow({
                    tab: "extensions",
                    target: {
                      commandName: route.commandName,
                      extensionName: route.extensionName
                    }
                  })
                }}
                title={activeCommandErrorTitle}
              />
            ) : activeViewCommand && ActivePluginComponent ? (
              isLauncherExtensionCommandRoute(route) &&
              activeCommandOwner &&
              activeCommandCapabilities &&
              activeCommandHostReady ? (
                <NativeExtensionHostProvider
                  value={{
                    capabilities: activeCommandCapabilities,
                    clipboard: activeCommandClipboardEnabled
                      ? {
                          clearContext: clipboard.clearContext,
                          context: deriveLauncherCommandOwnerClipboardContext(
                            clipboard.context,
                            activeCommandOwner.manifest.clipboard
                          )
                        }
                      : undefined,
                    commandName: route.commandName,
                    commandPreferences: activeCommandPreferences ?? {},
                    extensionName: route.extensionName,
                    initialAction: route.initialAction,
                    navigation: activeCommandNavigationEnabled
                      ? {
                          goHome: closeActivePlugin,
                          hideLauncher,
                          openCommand
                        }
                      : undefined,
                    seedQuery: route.seedQuery,
                    surface: activeCommandSurfaceEnabled
                      ? {
                          inputRef: pluginInputRef,
                          inputStatus: pluginInputStatus,
                          shellConfig: searchPage.shellConfig,
                          setInputStatus: setPluginInputStatus,
                          shownSequence,
                          viewportHeight
                        }
                      : undefined,
                    threads: activeCommandThreadsEnabled
                      ? {
                          create: createPluginThread,
                          reload: (threadId: string) => threadContext.reloadThread(threadId),
                          submit: submitPluginThread
                        }
                      : undefined
                  }}
                >
                  <ActivePluginComponent />
                </NativeExtensionHostProvider>
              ) : activeBuiltInCommand &&
                activeCommandHostReady &&
                activeCommandClipboardEnabled &&
                activeCommandNavigationEnabled &&
                activeCommandSurfaceEnabled &&
                activeCommandThreadsEnabled ? (
                <AiCoreHostProvider
                  value={{
                    clipboard: {
                      clearContext: clipboard.clearContext,
                      context: deriveLauncherCommandOwnerClipboardContext(
                        clipboard.context,
                        activeCommandOwner?.manifest.clipboard
                      )
                    },
                    commandName: route.commandName,
                    initialAction: route.initialAction,
                    navigation: {
                      goHome: closeActivePlugin,
                      hideLauncher,
                      openCommand
                    },
                    seedQuery: route.seedQuery,
                    surface: {
                      inputRef: pluginInputRef,
                      inputStatus: pluginInputStatus,
                      shellConfig: searchPage.shellConfig,
                      setInputStatus: setPluginInputStatus,
                      shownSequence,
                      viewportHeight
                    },
                    threads: {
                      create: createPluginThread,
                      reload: (threadId: string) => threadContext.reloadThread(threadId),
                      submit: submitPluginThread
                    }
                  }}
                >
                  <ActivePluginComponent />
                </AiCoreHostProvider>
              ) : (
                <div aria-busy="true" className="h-full w-full" />
              )
            ) : isLauncherCommandRoute(route) ? (
              <div aria-busy="true" className="h-full w-full" />
            ) : (
              <LauncherSearchPage
                executeItem={searchPage.executeItem}
                inputRef={searchInputRef}
                inputValue={searchPage.query}
                onClearClipboardContext={searchPage.clearClipboardContext}
                onInputKeyDown={searchPage.handleInputKeyDown}
                onInputValueChange={searchPage.setQuery}
                onRemoveHistoryItem={searchPage.removeHistoryItem}
                onSetHistoryItemPinned={searchPage.setHistoryItemPinned}
                placeholder={searchPage.placeholder}
                previewClipboardContext={searchPage.previewClipboardContext}
                resultsViewportHeight={searchPage.resultsViewportHeight}
                selectedIndex={searchPage.selectedIndex}
                shellConfig={searchPage.shellConfig}
                surface={searchPage.surface}
              />
            )}
          </LauncherPageTransition>
        </div>

        {activeCommandOwnerId === AI_LAUNCHER_PLUGIN_ID ? (
          <LauncherIntelligenceGlow
            key={routeKey}
            status={pluginInputStatus}
            targetRef={shellRef}
          />
        ) : null}

        <div className="hidden" aria-hidden="true">
          <NativeExtensionPassiveCommandHosts openCommand={openCommand} />
        </div>
      </div>
    </div>
  )
}
