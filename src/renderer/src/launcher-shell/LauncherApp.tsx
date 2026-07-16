import { useCallback, useEffect, useRef, useState } from "react"
import { AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import { LauncherIntelligenceGlow } from "@launcher-components/LauncherIntelligenceGlow"
import { LauncherPageTransition } from "@launcher-components/LauncherPageTransition"
import { sendRuntimeExtensionEvent } from "@/extension-runtime/runtime-extension-controller"
import { LauncherSearchPage } from "@launcher-components/LauncherSearchPage"
import type { ExtensionRuntimeToastRequestEvent } from "@shared/extension-runtime-protocol"
import {
  RuntimeToastOverlay,
  type RuntimeToastState
} from "@renderer/extension-runtime/runtime-toast-overlay"
import { useI18n } from "@/lib/i18n"
import { useShortcutCommandHandler } from "@/shortcuts/shortcut-context"
import { useAiCoreThreadHost } from "@/ai-core/useAiCoreThreadHost"
import { useLauncherClipboard } from "./LauncherClipboardContext"
import { useLauncherSelection } from "./LauncherSelectionContext"
import { LauncherCommandSurface } from "./LauncherCommandSurface"
import { useActiveLauncherCommand } from "./hooks/useActiveLauncherCommand"
import { useLauncherRouter } from "./hooks/useLauncherRouter"
import { useLauncherSearchPage } from "./hooks/useLauncherSearchPage"
import { useLauncherShellEffects } from "./hooks/useLauncherShellEffects"
import { launcherShellCommands } from "./launcher-shell-commands"
import { DEFAULT_HOME_COMMAND } from "./pages"
import type { LauncherInputElement } from "./input-element"
import type { ComposerAreaHandle } from "@/composer-area"
import type { LauncherInputStatus } from "./launcher-input-status"
import { isLauncherCommandRoute } from "./pages/types"

type HomeInputFocusBehavior = "preserve" | "select-all"
type PluginInputFocusBehavior = "preserve" | "move-to-end"
const NO_VIEW_TOAST_DISMISS_MS = 3200

interface NoViewToastState extends RuntimeToastState {
  sessionId: string
}

export default function LauncherApp(): React.JSX.Element {
  const { locale } = useI18n()
  const clipboard = useLauncherClipboard()
  const selection = useLauncherSelection()
  const selectionContext = selection.context
  const searchInputRef = useRef<LauncherInputElement>(null)
  const pluginInputRef = useRef<LauncherInputElement | ComposerAreaHandle>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const lastAutoOpenedSelectionIdRef = useRef<string | null>(null)
  const noViewToastDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextNoViewToastIdRef = useRef(0)
  const { closeActivePlugin, navigationDirection, openCommand, route, routeKey } =
    useLauncherRouter()
  const [activePluginThreadId, setActivePluginThreadId] = useState<string | null>(null)
  const [noViewToast, setNoViewToast] = useState<NoViewToastState | null>(null)
  const [pluginInputSurface, setPluginInputSurface] = useState<{
    routeKey: string
    status: LauncherInputStatus
  }>({
    routeKey,
    status: "idle"
  })
  const pluginInputStatus =
    pluginInputSurface.routeKey === routeKey ? pluginInputSurface.status : "idle"
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
      if ("getElement" in input) {
        return
      }

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
  const hideLauncher = useCallback(() => {
    return launcherShellCommands.hide()
  }, [])
  const clearNoViewToastDismissTimer = useCallback((): void => {
    if (!noViewToastDismissTimerRef.current) {
      return
    }

    clearTimeout(noViewToastDismissTimerRef.current)
    noViewToastDismissTimerRef.current = null
  }, [])
  const dismissNoViewToast = useCallback((): void => {
    clearNoViewToastDismissTimer()
    setNoViewToast(null)
  }, [clearNoViewToastDismissTimer])
  const showNoViewToast = useCallback(
    (event: ExtensionRuntimeToastRequestEvent): void => {
      clearNoViewToastDismissTimer()
      const id = nextNoViewToastIdRef.current++
      setNoViewToast({
        id,
        sessionId: event.sessionId,
        toast: event.toast
      })
      noViewToastDismissTimerRef.current = setTimeout(() => {
        setNoViewToast((current) => (current?.id === id ? null : current))
        noViewToastDismissTimerRef.current = null
      }, NO_VIEW_TOAST_DISMISS_MS)
    },
    [clearNoViewToastDismissTimer]
  )
  const executeNoViewToastAction = useCallback(
    (actionId: string): void => {
      const sessionId = noViewToast?.sessionId
      if (!sessionId) {
        return
      }

      sendRuntimeExtensionEvent(sessionId, {
        actionId,
        type: "toast.action.execute"
      })
      dismissNoViewToast()
    },
    [dismissNoViewToast, noViewToast?.sessionId]
  )
  const openMainHistory = useCallback((): void => {
    hideLauncher()
  }, [hideLauncher])
  const searchPage = useLauncherSearchPage({ openCommand, openMainHistory })
  const { executeHomeCommand, handleInputCommandKeyDown } = searchPage
  const commandState = useActiveLauncherCommand({
    closeActivePlugin,
    fallbackViewportHeight: searchPage.viewportHeight,
    hideLauncher,
    locale,
    openCommand,
    route,
    routeKey,
    showNoViewToast,
    shellConfig: searchPage.shellConfig
  })
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.close, () => {
    if (isLauncherCommandRoute(route)) {
      closeActivePlugin()
      return
    }

    void hideLauncher()
  })
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.searchOpenMainHistory, (event) => {
    event.preventDefault()
    openMainHistory()
  })
  const { shownSequence } = useLauncherShellEffects({
    focusActiveInput,
    homeInputSelectionRequestVersion: searchPage.homeInputSelectionRequestVersion,
    route,
    routeKey,
    viewportHeight: commandState.viewportHeight
  })
  const pluginThreads = useAiCoreThreadHost({
    activeThreadId: activePluginThreadId,
    setActiveThreadId: setActivePluginThreadId
  })

  useEffect(() => {
    if (!selectionContext || lastAutoOpenedSelectionIdRef.current === selectionContext.id) {
      return
    }

    lastAutoOpenedSelectionIdRef.current = selectionContext.id
    openCommand(
      DEFAULT_HOME_COMMAND,
      {
        initialAction: "focus",
        seedQuery: ""
      }
    )
  }, [openCommand, selectionContext])

  return (
    <div className="launcher-window-frame">
      <div
        ref={shellRef}
        className="launcher-window-shell"
        data-active-plugin={commandState.activeCommandOwnerId ?? "home"}
        data-active-command-owner={commandState.activeCommandOwnerId ?? "home"}
      >
        <div className="launcher-shell-content">
          <LauncherPageTransition direction={navigationDirection} pageKey={routeKey}>
            {isLauncherCommandRoute(route) ? (
              <LauncherCommandSurface
                activatePluginThread={pluginThreads.activate}
                branchPluginThread={(threadId, messageId) =>
                  messageId
                    ? pluginThreads.cloneUntilMessage(threadId, messageId)
                    : pluginThreads.clone(threadId)
                }
                clipboard={clipboard}
                closeActivePlugin={closeActivePlugin}
                commandState={commandState}
                selection={selection}
                createPluginThread={pluginThreads.create}
                getCurrentPluginThreadId={pluginThreads.getActiveThreadId}
                hideLauncher={hideLauncher}
                listPluginThreads={pluginThreads.list}
                openCommand={openCommand}
                pluginInputRef={pluginInputRef}
                pluginInputStatus={pluginInputStatus}
                route={route}
                searchShellConfig={searchPage.shellConfig}
                setPluginInputStatus={setPluginInputStatus}
                shownSequence={shownSequence}
                submitPluginThread={pluginThreads.submit}
              />
            ) : (
              <LauncherSearchPage
                executeHomeCommand={executeHomeCommand}
                executeItem={searchPage.executeItem}
                inputRef={searchInputRef}
                inputValue={searchPage.query}
                isSearchLoading={searchPage.isSearchLoading}
                onAcceptClipboardContext={searchPage.acceptClipboardCandidate}
                onClearClipboardContext={searchPage.clearClipboardContext}
                onInputKeyDown={handleInputCommandKeyDown}
                onInputValueChange={searchPage.setQuery}
                onRemoveHistoryItem={searchPage.removeHistoryItem}
                onSetHistoryItemPinned={searchPage.setHistoryItemPinned}
                previewClipboardContext={searchPage.previewClipboardContext}
                resultsViewportHeight={searchPage.resultsViewportHeight}
                selectedIndex={searchPage.selectedIndex}
                shellConfig={searchPage.shellConfig}
                surface={searchPage.surface}
                useWithManager={searchPage.useWithManager}
              />
            )}
          </LauncherPageTransition>
        </div>

        {commandState.activeCommandOwnerId === AI_LAUNCHER_PLUGIN_ID ? (
          <LauncherIntelligenceGlow
            key={routeKey}
            status={pluginInputStatus}
            targetRef={shellRef}
          />
        ) : null}

        <RuntimeToastOverlay
          onAction={executeNoViewToastAction}
          onDismiss={dismissNoViewToast}
          toast={noViewToast}
        />

        <div className="hidden" aria-hidden="true"></div>
      </div>
    </div>
  )
}
