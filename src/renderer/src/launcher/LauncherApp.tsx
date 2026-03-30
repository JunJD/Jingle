import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AI_LAUNCHER_PLUGIN_ID } from "../../../plugins/ai/manifest"
import { useLauncherClipboard } from "./LauncherClipboardContext"
import { deriveLauncherPluginClipboardContext } from "../../../shared/clipboard-derivations"
import {
  type LauncherPluginInputElement,
  type LauncherPluginThreadCreateInput,
  type LauncherPluginThreadSubmitInput
} from "./LauncherPluginHost"
import { LauncherPluginHostProvider } from "./LauncherPluginHostContext"
import type { LauncherInputStatus } from "./launcher-input-status"
import { LauncherIntelligenceGlow } from "./components/LauncherIntelligenceGlow"
import { LauncherPageTransition } from "./components/LauncherPageTransition"
import { LauncherSearchPage } from "./components/LauncherSearchPage"
import { useLauncherRouter } from "./hooks/useLauncherRouter"
import { useLauncherSearchPage } from "./hooks/useLauncherSearchPage"
import { getLauncherPluginDefinition } from "./pages"
import { isLauncherPluginRoute } from "./pages/types"
import { invokeThreadMessage } from "@/lib/ai-invocation"
import { useI18n } from "@/lib/i18n"
import { useThreadContext } from "@/lib/thread-context"

type HomeInputFocusBehavior = "preserve" | "select-all"
type PluginInputFocusBehavior = "preserve" | "move-to-end"

export default function LauncherApp(): React.JSX.Element {
  const { copy } = useI18n()
  const inputNeedsWorkspaceMessage = copy.chat.inputNeedsWorkspace
  const clipboard = useLauncherClipboard()
  const threadContext = useThreadContext()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pluginInputRef = useRef<LauncherPluginInputElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const viewportHeightRef = useRef(0)
  const [shownSequence, setShownSequence] = useState(0)
  const { activeEntry, closeActivePlugin, navigationDirection, openEntry, route, routeKey } =
    useLauncherRouter()
  const [pluginInputSurface, setPluginInputSurface] = useState<{
    routeKey: string
    status: LauncherInputStatus
  }>({
    routeKey,
    status: "idle"
  })
  const searchPage = useLauncherSearchPage({ openEntry })
  const previousRouteRef = useRef(route)
  const previousRouteKeyRef = useRef<string | null>(null)
  const lastHandledShownSequenceRef = useRef(shownSequence)
  const lastHandledHomeSelectionRequestRef = useRef(searchPage.homeInputSelectionRequestVersion)
  const activePluginId = isLauncherPluginRoute(route) ? route.pluginId : null
  const activePluginDefinition = activePluginId ? getLauncherPluginDefinition(activePluginId) : null
  const ActivePluginComponent = activeEntry?.Component ?? null
  const viewportHeight = !isLauncherPluginRoute(route)
    ? searchPage.viewportHeight
    : (activeEntry?.getViewportHeight(searchPage.shellConfig) ?? searchPage.viewportHeight)
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
      const caretPosition = input.value.length
      input.setSelectionRange(caretPosition, caretPosition)
    }
  }, [])
  const focusActiveInput = useCallback(
    (options?: { home?: HomeInputFocusBehavior; plugin?: PluginInputFocusBehavior }): void => {
      if (isLauncherPluginRoute(route)) {
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
    async (input: LauncherPluginThreadCreateInput) => {
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
    async (input: LauncherPluginThreadSubmitInput): Promise<void> => {
      await invokeThreadMessage({
        message: input.message,
        threadContext,
        threadId: input.threadId
      })
    },
    [threadContext]
  )
  const activePluginHost = useMemo(() => {
    if (!activeEntry || !activePluginDefinition || !isLauncherPluginRoute(route)) {
      return null
    }

    const capabilities = activePluginDefinition.manifest.capabilities

    return {
      capabilities,
      clipboard: capabilities.includes("clipboard")
        ? {
            clearContext: clipboard.clearContext,
            context: deriveLauncherPluginClipboardContext(
              clipboard.context,
              activePluginDefinition.manifest.clipboard
            )
          }
        : undefined,
      entryId: route.entryId,
      initialAction: route.initialAction,
      navigation: capabilities.includes("navigation")
        ? {
            goHome: closeActivePlugin,
            hideLauncher,
            openEntry
          }
        : undefined,
      pluginId: route.pluginId,
      seedQuery: route.seedQuery,
      surface: capabilities.includes("surface")
        ? {
            inputRef: pluginInputRef,
            inputStatus: pluginInputStatus,
            shellConfig: searchPage.shellConfig,
            setInputStatus: setPluginInputStatus,
            shownSequence,
            viewportHeight
          }
        : undefined,
      threads: capabilities.includes("threads")
        ? {
            create: createPluginThread,
            reload: (threadId: string) => threadContext.reloadThread(threadId),
            submit: submitPluginThread
          }
        : undefined
    }
  }, [
    activeEntry,
    activePluginDefinition,
    clipboard.clearContext,
    clipboard.context,
    closeActivePlugin,
    createPluginThread,
    hideLauncher,
    openEntry,
    pluginInputStatus,
    setPluginInputStatus,
    route,
    searchPage.shellConfig,
    shownSequence,
    submitPluginThread,
    threadContext,
    viewportHeight
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
      isLauncherPluginRoute(previousRouteRef.current) &&
      !isLauncherPluginRoute(route)
    const shownChanged = shownSequence !== lastHandledShownSequenceRef.current
    const homeSelectionRequested =
      searchPage.homeInputSelectionRequestVersion !== lastHandledHomeSelectionRequestRef.current

    if (shownChanged) {
      focusActiveInput({
        home: "select-all",
        plugin: "move-to-end"
      })
      lastHandledShownSequenceRef.current = shownSequence
    } else if (!isLauncherPluginRoute(route) && homeSelectionRequested) {
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
        if (isLauncherPluginRoute(route)) {
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
        data-active-plugin={activePluginId ?? "home"}
      >
        <div className="launcher-shell-content">
          <LauncherPageTransition direction={navigationDirection} pageKey={routeKey}>
            {activeEntry && ActivePluginComponent && activePluginHost ? (
              <LauncherPluginHostProvider value={activePluginHost}>
                <ActivePluginComponent />
              </LauncherPluginHostProvider>
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

        {activePluginId === AI_LAUNCHER_PLUGIN_ID ? (
          <LauncherIntelligenceGlow
            key={routeKey}
            status={pluginInputStatus}
            targetRef={shellRef}
          />
        ) : null}
      </div>
    </div>
  )
}
