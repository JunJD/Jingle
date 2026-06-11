import { useCallback, useRef, useState } from "react"
import { AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import {
  DEFAULT_PERMISSION_MODE,
  THREAD_PERMISSION_MODE_METADATA_KEY
} from "@shared/permission-mode"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import type { PermissionModeName } from "@shared/permission-mode"
import { LauncherIntelligenceGlow } from "@launcher-components/LauncherIntelligenceGlow"
import { LauncherPageTransition } from "@launcher-components/LauncherPageTransition"
import { LauncherSearchPage } from "@launcher-components/LauncherSearchPage"
import { invokeAgentThread } from "@/lib/agent-control"
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
import type { ComposerAreaHandle } from "@/composer-area"
import type { LauncherInputStatus } from "./launcher-input-status"
import { isLauncherCommandRoute } from "./pages/types"

type HomeInputFocusBehavior = "preserve" | "select-all"
type PluginInputFocusBehavior = "preserve" | "move-to-end"

interface LauncherThreadCreateInput {
  modelId?: string
  permissionMode?: PermissionModeName
  source: string
  title: string
  visibility: string
}

interface LauncherThreadSubmitInput {
  message: string
  threadId: string
}

export default function LauncherApp(): React.JSX.Element {
  const { copy, locale } = useI18n()
  const inputNeedsWorkspaceMessage = copy.chat.inputNeedsWorkspace
  const clipboard = useLauncherClipboard()
  const threadContext = useThreadContext()
  const { loadThreadData } = threadContext
  const searchInputRef = useRef<LauncherInputElement>(null)
  const pluginInputRef = useRef<LauncherInputElement | ComposerAreaHandle>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const { closeActivePlugin, navigationDirection, openCommand, route, routeKey } =
    useLauncherRouter()
  const [activePluginThreadId, setActivePluginThreadId] = useState<string | null>(null)
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
    return window.api.launcher.hide()
  }, [])
  const openMainHistory = useCallback((): void => {
    void window.api.mainWindow.openWindow().then(() => hideLauncher())
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
  const createPluginThread = useCallback(
    async (input: LauncherThreadCreateInput) => {
      const [resolvedModelId, workspacePathResult] = await Promise.all([
        input.modelId ? Promise.resolve(input.modelId) : window.api.models.getDefault("llm"),
        window.api.workspace.createDefault({ title: input.title })
      ])

      if (!workspacePathResult) {
        throw new Error(inputNeedsWorkspaceMessage)
      }
      const workspacePath = workspacePathResult

      const thread = await window.api.threads.create({
        model: resolvedModelId,
        [THREAD_PERMISSION_MODE_METADATA_KEY]: input.permissionMode ?? DEFAULT_PERMISSION_MODE,
        source: input.source,
        title: input.title,
        visibility: input.visibility,
        workspacePath
      })

      await loadThreadData(thread.thread_id)

      return {
        modelId: resolvedModelId,
        threadId: thread.thread_id,
        workspacePath
      }
    },
    [inputNeedsWorkspaceMessage, loadThreadData]
  )
  const activatePluginThread = useCallback(
    async (threadId: string): Promise<void> => {
      setActivePluginThreadId(threadId)
      await loadThreadData(threadId)
    },
    [loadThreadData]
  )
  const branchPluginThread = useCallback(
    async (threadId: string, messageId?: string) => {
      const branchedThread = messageId
        ? await window.api.threads.cloneUntilMessage(threadId, messageId)
        : await window.api.threads.clone(threadId)
      const metadata = branchedThread.metadata ?? {}
      const modelId =
        typeof metadata.model === "string"
          ? metadata.model
          : await window.api.models.getDefault("llm")
      const workspacePath =
        typeof metadata.workspacePath === "string" ? metadata.workspacePath : null

      if (!workspacePath) {
        throw new Error(inputNeedsWorkspaceMessage)
      }

      setActivePluginThreadId(branchedThread.thread_id)
      await loadThreadData(branchedThread.thread_id)

      return {
        modelId,
        threadId: branchedThread.thread_id,
        workspacePath
      }
    },
    [inputNeedsWorkspaceMessage, loadThreadData]
  )
  const listPluginThreads = useCallback(async () => {
    return window.api.threads.list()
  }, [])
  const getCurrentPluginThreadId = useCallback(() => {
    return activePluginThreadId
  }, [activePluginThreadId])
  const submitPluginThread = useCallback(
    async (input: LauncherThreadSubmitInput): Promise<void> => {
      await invokeAgentThread({
        messageInput: {
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
                isSearchLoading={searchPage.isSearchLoading}
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

        <div className="hidden" aria-hidden="true"></div>
      </div>
    </div>
  )
}
