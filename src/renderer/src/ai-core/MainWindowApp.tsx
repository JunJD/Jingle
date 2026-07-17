import { Suspense, useEffect, useRef, useState } from "react"
import type { ClipboardContext } from "@shared/clipboard"
import { AI_CHAT_COMMAND_NAME, AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { FALLBACK_SHELL_CONFIG } from "@shared/launcher"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import type { ComposerAreaHandle } from "@/composer-area"
import { useThreadContext } from "@/lib/thread-context"
import { historyShellStore } from "@/lib/history-shell-store"
import { AiCoreHostProvider } from "./AiCoreHost"
import { getAiShellConfig } from "./ai-config"
import { LazyLauncherAiPage } from "./LazyLauncherAiPage"
import { useAiCoreThreadHost } from "./useAiCoreThreadHost"

const EMPTY_CLIPBOARD_CONTEXT: ClipboardContext = { kind: "none" }

function readInitialThreadId(): string | null {
  const value = new URLSearchParams(window.location.search).get("threadId")?.trim()
  return value || null
}

export function DurableWindowApp(): React.JSX.Element {
  const inputRef = useRef<LauncherInputElement | ComposerAreaHandle | null>(null)
  const previousActiveThreadIdRef = useRef<string | null>(null)
  const [activeThreadId, setActiveThreadId] = useState(readInitialThreadId)
  const [inputStatus, setInputStatus] = useState<LauncherInputStatus>("idle")
  const threadContext = useThreadContext()
  const threads = useAiCoreThreadHost({ activeThreadId, mode: "main", setActiveThreadId })

  useEffect(
    () =>
      window.api.durableWindow.onThreadChanged(({ threadId }) => {
        void threads.activate(threadId).catch((error: unknown) => {
          console.error("[DurableWindow] Failed to activate the main thread.", error)
        })
        void historyShellStore
          .getState()
          .loadSidebarView()
          .catch((error: unknown) => {
            console.error("[DurableWindow] Failed to refresh the main sidebar.", error)
          })
      }),
    [threads]
  )

  useEffect(
    () =>
      window.api.threadWorkflow.onChanged(() => {
        void historyShellStore
          .getState()
          .loadSidebarView()
          .catch((error: unknown) => {
            console.error("[ThreadWorkflow] Failed to refresh the main sidebar.", error)
          })
      }),
    []
  )

  useEffect(() => {
    const previousThreadId = previousActiveThreadIdRef.current
    previousActiveThreadIdRef.current = activeThreadId
    if (previousThreadId && previousThreadId !== activeThreadId)
      threadContext.cleanupThread(previousThreadId)
  }, [activeThreadId, threadContext])

  return (
    <div className="launcher-window-frame">
      <div className="launcher-window-shell" data-active-plugin={AI_LAUNCHER_PLUGIN_ID}>
        <AiCoreHostProvider
          value={{
            clipboard: {
              acceptedContext: EMPTY_CLIPBOARD_CONTEXT,
              candidateContext: EMPTY_CLIPBOARD_CONTEXT,
              clearContext: () => {}
            },
            chrome: {
              autoOpenSidebarMinWidth: 1040,
              initialSidebarOpen: true,
              showBackButton: false
            },
            commandName: AI_CHAT_COMMAND_NAME,
            initialAction: "focus",
            navigation: {
              goHome: () => {},
              hideLauncher: () => Promise.resolve(),
              openCommand: () => {}
            },
            seedQuery: "",
            surface: {
              inputRef,
              inputStatus,
              setInputStatus,
              shellConfig: getAiShellConfig(FALLBACK_SHELL_CONFIG),
              shownSequence: 0,
              viewportHeight: window.innerHeight
            },
            threads: {
              ...threads,
              onBeforeActivate: async (threadId) => {
                await window.api.durableWindow.setThread({ threadId })
                return true
              }
            }
          }}
        >
          <Suspense fallback={<div aria-busy="true" className="h-full w-full" />}>
            <LazyLauncherAiPage key={activeThreadId ?? "empty"} />
          </Suspense>
        </AiCoreHostProvider>
      </div>
    </div>
  )
}
