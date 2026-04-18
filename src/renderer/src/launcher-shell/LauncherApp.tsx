import { useCallback, useRef, useState } from "react"
import { AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import { LauncherIntelligenceGlow } from "@launcher-components/LauncherIntelligenceGlow"
import { LauncherPageTransition } from "@launcher-components/LauncherPageTransition"
import { LauncherSearchPage } from "@launcher-components/LauncherSearchPage"
import { NativeExtensionPassiveCommandHosts } from "@extension-host/PassiveCommandHosts"
import { invokeThreadMessage } from "@/lib/ai-invocation"
import {
  activateHistoryThread,
  getCurrentHistoryThreadId,
  loadHistoryThreads
} from "@/lib/history-thread-ops"
import { useI18n } from "@/lib/i18n"
import { useShortcutCommandHandler } from "@/shortcuts/shortcut-context"
import { useThreadContext } from "@/lib/thread-context"
import { useLauncherClipboard } from "./LauncherClipboardContext"
import { LauncherCommandSurface } from "./LauncherCommandSurface"
import { useActiveLauncherCommand } from "./hooks/useActiveLauncherCommand"
import { useLauncherRouter } from "./hooks/useLauncherRouter"
import { useLauncherSearchPage } from "./hooks/useLauncherSearchPage"
import { useLauncherShellEffects } from "./hooks/useLauncherShellEffects"
import type { LauncherInputElement } from "./input-element"
import type { LauncherInputStatus } from "./launcher-input-status"
import { isLauncherCommandRoute } from "./pages/types"

type HomeInputFocusBehavior = "preserve" | "select-all"
type PluginInputFocusBehavior = "preserve" | "move-to-end"

interface LauncherThreadCreateInput {
  draftInput?: string
  modelId?: string
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
  const { closeActivePlugin, navigationDirection, openCommand, route, routeKey } =
    useLauncherRouter()
  const [pluginInputSurface, setPluginInputSurface] = useState<{
    routeKey: string
    status: LauncherInputStatus
  }>({
    routeKey,
    status: "idle"
  })
  const searchPage = useLauncherSearchPage({ openCommand })
  const { executeHomeCommand, handleInputCommandKeyDown } = searchPage
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
      if (isLauncherCommandRoute(route)) {
        focusPluginInput(options?.plugin ?? "move-to-end")
        return
      }

      focusHomeInput(options?.home ?? "preserve")
    },
    [focusHomeInput, focusPluginInput, route]
  )
  const hideLauncher = useCallback(() => {
    return window.api.launcher.hide()
  }, [])
  const commandState = useActiveLauncherCommand({
    closeActivePlugin,
    fallbackViewportHeight: searchPage.viewportHeight,
    hideLauncher,
    openCommand,
    route,
    routeKey,
    shellConfig: searchPage.shellConfig
  })
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.close, () => {
    if (isLauncherCommandRoute(route)) {
      closeActivePlugin()
      return
    }

    void hideLauncher()
  })
  const { shownSequence } = useLauncherShellEffects({
    focusActiveInput,
    homeInputSelectionRequestVersion: searchPage.homeInputSelectionRequestVersion,
    route,
    routeKey,
    viewportHeight: commandState.viewportHeight
  })
  const createPluginThread = useCallback(
    async (input: LauncherThreadCreateInput) => {
      const [resolvedModelId, workspacePathResult] = await Promise.all([
        input.modelId ? Promise.resolve(input.modelId) : window.api.models.getDefault("llm"),
        window.api.workspace.get()
      ])

      if (!workspacePathResult) {
        throw new Error(inputNeedsWorkspaceMessage)
      }
      const workspacePath = workspacePathResult

      const thread = await window.api.threads.create({
        model: resolvedModelId,
        source: input.source,
        title: input.title,
        visibility: input.visibility,
        workspacePath
      })

      threadContext.ensureThreadRuntime(thread.thread_id)
      const actions = threadContext.getThreadActions(thread.thread_id)
      actions.setCurrentModel(resolvedModelId)
      actions.setWorkspacePath(workspacePath)
      actions.setDraftInput(input.draftInput ?? "")

      return {
        modelId: resolvedModelId,
        threadId: thread.thread_id,
        workspacePath
      }
    },
    [inputNeedsWorkspaceMessage, threadContext]
  )
  const activatePluginThread = useCallback(
    async (threadId: string): Promise<void> => {
      await activateHistoryThread(threadId, (nextThreadId) => threadContext.reloadThread(nextThreadId))
    },
    [threadContext]
  )
  const branchPluginThread = useCallback(
    async (threadId: string) => {
      const branchedThread = await window.api.threads.clone(threadId)
      const metadata = branchedThread.metadata ?? {}
      const modelId =
        typeof metadata.model === "string" ? metadata.model : await window.api.models.getDefault("llm")
      const workspacePath = typeof metadata.workspacePath === "string" ? metadata.workspacePath : null

      if (!workspacePath) {
        throw new Error(inputNeedsWorkspaceMessage)
      }

      threadContext.ensureThreadRuntime(branchedThread.thread_id)
      await activateHistoryThread(branchedThread.thread_id, (nextThreadId) =>
        threadContext.reloadThread(nextThreadId)
      )

      return {
        modelId,
        threadId: branchedThread.thread_id,
        workspacePath
      }
    },
    [inputNeedsWorkspaceMessage, threadContext]
  )
  const listPluginThreads = useCallback(async () => {
    return loadHistoryThreads()
  }, [])
  const getCurrentPluginThreadId = useCallback(() => {
    return getCurrentHistoryThreadId()
  }, [])
  const submitPluginThread = useCallback(
    async (input: LauncherThreadSubmitInput): Promise<void> => {
      await invokeThreadMessage({
        input: {
          refs: [],
          text: input.message
        },
        threadContext,
        threadId: input.threadId
      })
    },
    [threadContext]
  )

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
                activatePluginThread={activatePluginThread}
                branchPluginThread={branchPluginThread}
                clipboard={clipboard}
                closeActivePlugin={closeActivePlugin}
                commandState={commandState}
                createPluginThread={createPluginThread}
                getCurrentPluginThreadId={getCurrentPluginThreadId}
                hideLauncher={hideLauncher}
                listPluginThreads={listPluginThreads}
                openCommand={openCommand}
                pluginInputRef={pluginInputRef}
                pluginInputStatus={pluginInputStatus}
                reloadThread={(threadId: string) => threadContext.reloadThread(threadId)}
                route={route}
                searchShellConfig={searchPage.shellConfig}
                setPluginInputStatus={setPluginInputStatus}
                shownSequence={shownSequence}
                submitPluginThread={submitPluginThread}
              />
            ) : (
              <LauncherSearchPage
                executeHomeCommand={executeHomeCommand}
                executeItem={searchPage.executeItem}
                inputRef={searchInputRef}
                inputValue={searchPage.query}
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

        <div className="hidden" aria-hidden="true">
          <NativeExtensionPassiveCommandHosts openCommand={openCommand} />
        </div>
      </div>
    </div>
  )
}
