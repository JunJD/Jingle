import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { AiCoreHostProvider } from "./AiCoreHost"
import { getAiShellConfig } from "./ai-config"
import { LazyLauncherAiPage } from "./LazyLauncherAiPage"
import { useAiCoreThreadHost } from "./useAiCoreThreadHost"
import { useThreadContext } from "@/lib/thread-context"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import type { ComposerAreaHandle } from "@/composer-area"
import { AI_CHAT_COMMAND_NAME, AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { FALLBACK_SHELL_CONFIG } from "@shared/launcher"
import type { ClipboardContext } from "@shared/clipboard"

const PINNED_SESSION_VIEWPORT_HEIGHT = 640
const EMPTY_CLIPBOARD_CONTEXT: ClipboardContext = {
  kind: "none"
}

function readPinnedSessionThreadId(): string | null {
  const threadId = new URLSearchParams(window.location.search).get("threadId")?.trim()
  return threadId && threadId.length > 0 ? threadId : null
}

function readPinnedSessionWindowId(): string | null {
  const windowId = new URLSearchParams(window.location.search).get("pinnedWindowId")?.trim()
  return windowId && windowId.length > 0 ? windowId : null
}

function PinnedAiSessionWindowError(props: { message: string }): React.JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background px-[var(--ow-space-6)] text-center text-muted-foreground">
      <div className="max-w-[320px] [font-size:var(--ow-font-body)] leading-[var(--ow-line-body)]">
        {props.message}
      </div>
    </div>
  )
}

export function PinnedAiSessionWindowApp(): React.JSX.Element {
  const pinnedSession = useMemo(() => {
    const initialThreadId = readPinnedSessionThreadId()
    const pinnedWindowId = readPinnedSessionWindowId()
    return {
      handleBeforeActivateThread: async (threadId: string): Promise<boolean> => {
        if (!pinnedWindowId) {
          throw new Error("Pinned AI session window id is missing.")
        }

        const result = await window.api.aiSessionWindows.updatePinnedThread({
          threadId,
          windowId: pinnedWindowId
        })
        return result.ok
      },
      initialThreadId,
      pinnedWindowId
    }
  }, [])
  const { handleBeforeActivateThread, initialThreadId, pinnedWindowId } = pinnedSession
  const inputRef = useRef<LauncherInputElement | ComposerAreaHandle | null>(null)
  const previousActiveThreadIdRef = useRef<string | null>(null)
  const [activeThreadId, setActiveThreadId] = useState(initialThreadId)
  const [inputStatus, setInputStatus] = useState<LauncherInputStatus>("idle")
  const threadContext = useThreadContext()

  const threads = useAiCoreThreadHost({
    activeThreadId,
    mode: "pinned-thread",
    setActiveThreadId
  })

  useEffect(() => {
    const previousThreadId = previousActiveThreadIdRef.current
    previousActiveThreadIdRef.current = activeThreadId

    if (previousThreadId && previousThreadId !== activeThreadId) {
      threadContext.cleanupThread(previousThreadId)
    }
  }, [activeThreadId, threadContext])

  if (!initialThreadId) {
    return <PinnedAiSessionWindowError message="Missing AI session thread." />
  }

  if (!pinnedWindowId) {
    return <PinnedAiSessionWindowError message="Missing pinned session window." />
  }

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
              goHome: () => {
                window.close()
              },
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
              viewportHeight: PINNED_SESSION_VIEWPORT_HEIGHT
            },
            threads: {
              ...threads,
              onBeforeActivate: handleBeforeActivateThread
            }
          }}
        >
          <Suspense fallback={<div aria-busy="true" className="h-full w-full" />}>
            <LazyLauncherAiPage />
          </Suspense>
        </AiCoreHostProvider>
      </div>
    </div>
  )
}
