import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AI_LAUNCHER_PLUGIN_ID } from "../../../plugins/ai/manifest"
import { useLauncherClipboard } from "./LauncherClipboardContext"
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
import { isLauncherPluginRoute } from "./pages/types"
import { useI18n } from "@/lib/i18n"
import { useThreadContext } from "@/lib/thread-context"

function waitForAnimationFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

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
  const activePluginId = isLauncherPluginRoute(route) ? route.pluginId : null
  const selectedItem =
    searchPage.selectedIndex >= 0 ? searchPage.items[searchPage.selectedIndex] : null
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

  const waitForThreadStream = useCallback(
    async (threadId: string) => {
      let stream = threadContext.getStreamData(threadId).stream
      while (!stream) {
        await waitForAnimationFrame()
        stream = threadContext.getStreamData(threadId).stream
      }

      return stream
    },
    [threadContext]
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
      const { message, threadId } = input
      const stream = await waitForThreadStream(threadId)
      const state = threadContext.getThreadState(threadId)
      const actions = threadContext.getThreadActions(threadId)

      // if (!state.workspacePath) {
      //   throw new Error(copy.chat.inputNeedsWorkspace)
      // }

      if (state.error) {
        actions.clearError()
      }

      if (state.pendingApproval) {
        actions.setPendingApproval(null)
      }

      actions.setDraftInput("")
      actions.appendMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        created_at: new Date()
      })

      await stream.submit(
        {
          messages: [{ type: "human", content: message }]
        },
        {
          config: {
            configurable: {
              model_id: state.currentModel,
              thread_id: threadId
            }
          }
        }
      )
    },
    [threadContext, waitForThreadStream]
  )
  const activePluginHost = useMemo(() => {
    if (!activeEntry || !isLauncherPluginRoute(route)) {
      return null
    }

    return {
      clipboard: {
        clearContext: clipboard.clearContext,
        context: clipboard.context
      },
      entryId: route.entryId,
      initialAction: route.initialAction,
      navigation: {
        goHome: closeActivePlugin,
        hideLauncher,
        openEntry
      },
      pluginId: route.pluginId,
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
        submit: submitPluginThread
      }
    }
  }, [
    activeEntry,
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
    viewportHeight
  ])

  useEffect(() => {
    setViewportHeight(viewportHeight)
  }, [setViewportHeight, viewportHeight])

  useEffect(() => {
    const focusInput = (): void => {
      const input = isLauncherPluginRoute(route) ? pluginInputRef.current : searchInputRef.current
      if (!input) {
        return
      }

      input.focus()
      const caretPosition = input.value.length
      input.setSelectionRange(caretPosition, caretPosition)
    }

    focusInput()
    const cleanupShown = window.api.launcher.onShown(() => {
      setShownSequence((value) => value + 1)
      focusInput()
      if (viewportHeightRef.current > 0) {
        setViewportHeight(viewportHeightRef.current)
      }
    })
    window.addEventListener("focus", focusInput)

    return () => {
      cleanupShown()
      window.removeEventListener("focus", focusInput)
    }
  }, [route, setViewportHeight])

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
        {activePluginId === AI_LAUNCHER_PLUGIN_ID ? (
          <LauncherIntelligenceGlow
            key={routeKey}
            status={pluginInputStatus}
            targetRef={shellRef}
          />
        ) : null}

        <div className="launcher-shell-content">
          <LauncherPageTransition direction={navigationDirection} pageKey={routeKey}>
            {activeEntry && ActivePluginComponent && activePluginHost ? (
              <LauncherPluginHostProvider value={activePluginHost}>
                <ActivePluginComponent />
              </LauncherPluginHostProvider>
            ) : (
              <LauncherSearchPage
                entries={searchPage.entries}
                executeItem={searchPage.executeItem}
                inputRef={searchInputRef}
                inputValue={searchPage.query}
                items={searchPage.items}
                onInputKeyDown={searchPage.handleInputKeyDown}
                onInputValueChange={searchPage.setQuery}
                onOpenEntry={searchPage.openEntry}
                placeholder={searchPage.placeholder}
                resultsViewportHeight={searchPage.resultsViewportHeight}
                resultsVisible={searchPage.resultsVisible}
                selectedIndex={searchPage.selectedIndex}
                selectedItem={selectedItem}
                shellConfig={searchPage.shellConfig}
              />
            )}
          </LauncherPageTransition>
        </div>
      </div>
    </div>
  )
}
