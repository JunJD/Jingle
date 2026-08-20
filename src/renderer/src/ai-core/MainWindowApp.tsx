import { Suspense, useEffect, useEffectEvent, useRef, useState } from "react"
import type { DurableWindowThreadBindingSnapshot } from "@shared/durable-window"
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
import {
  createDurableWindowThreadActivationCoordinator,
  type DurableWindowThreadActivationCoordinator,
  type DurableWindowThreadActivationProjection
} from "./durable-window-thread-activation"
import {
  startDurableWindowThreadBindingProjection,
  type DurableWindowThreadBindingProjection
} from "./durable-window-thread-binding"

const EMPTY_CLIPBOARD_CONTEXT: ClipboardContext = { kind: "none" }

export function DurableWindowApp(): React.JSX.Element {
  const inputRef = useRef<LauncherInputElement | ComposerAreaHandle | null>(null)
  const activationCoordinatorRef = useRef<DurableWindowThreadActivationCoordinator | null>(null)
  const bindingProjectionRef = useRef<DurableWindowThreadBindingProjection | null>(null)
  const previousActiveThreadIdRef = useRef<string | null>(null)
  const [activation, setActivation] = useState<DurableWindowThreadActivationProjection>({
    bindingRevision: null,
    error: null,
    phase: "initializing",
    threadId: null
  })
  const [inputStatus, setInputStatus] = useState<LauncherInputStatus>("idle")
  const threadContext = useThreadContext()
  const threads = useAiCoreThreadHost({
    activeThreadId: activation.threadId,
    hydrateCreatedThread: false,
    mode: "main",
    setActiveThreadId: () => {}
  })

  const refreshSidebar = useEffectEvent(() => {
    void historyShellStore
      .getState()
      .loadSidebarView()
      .catch((error: unknown) => {
        console.error("[DurableWindow] Failed to refresh the main sidebar.", error)
      })
  })

  const projectBinding = useEffectEvent((snapshot: DurableWindowThreadBindingSnapshot) => {
    void activationCoordinatorRef.current?.acceptBinding(snapshot).catch((error: unknown) => {
      console.error("[DurableWindow] Failed to activate the bound thread.", error)
    })
  })

  useEffect(() => {
    const coordinator = createDurableWindowThreadActivationCoordinator({
      bind: (threadId) => window.api.durableWindow.setThread({ threadId }),
      cleanup: threadContext.cleanupThread,
      hydrate: threadContext.loadThreadData,
      onBinding: (snapshot) => {
        bindingProjectionRef.current?.acknowledge(snapshot)
      },
      onState: setActivation
    })
    activationCoordinatorRef.current = coordinator

    const projection = startDurableWindowThreadBindingProjection({
      onError: (error) => {
        console.error("[DurableWindow] Failed to read the durable thread binding.", error)
        setActivation({
          bindingRevision: null,
          error: error instanceof Error ? error.message : String(error),
          phase: "failed",
          threadId: null
        })
      },
      onSnapshot: projectBinding,
      read: window.api.durableWindow.getThreadBinding,
      subscribe: window.api.durableWindow.onThreadBindingChanged
    })
    bindingProjectionRef.current = projection
    return () => {
      if (bindingProjectionRef.current === projection) bindingProjectionRef.current = null
      if (activationCoordinatorRef.current === coordinator) activationCoordinatorRef.current = null
      projection.dispose()
      coordinator.dispose()
    }
  }, [threadContext])

  useEffect(() => {
    if (activation.bindingRevision !== null) refreshSidebar()
  }, [activation.bindingRevision])

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
    previousActiveThreadIdRef.current = activation.threadId
    if (previousThreadId && previousThreadId !== activation.threadId)
      threadContext.cleanupThread(previousThreadId)
  }, [activation.threadId, threadContext])

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
              activation,
              onBeforeActivate: async (threadId) => {
                const snapshot = await activationCoordinatorRef.current?.requestActivation(threadId)
                return snapshot?.threadId === threadId
              },
              onClearActivationError: () => {
                if (activation.phase !== "failed" || activation.threadId === null) return
                void activationCoordinatorRef.current
                  ?.requestActivation(activation.threadId)
                  .catch((error: unknown) => {
                    console.error("[DurableWindow] Failed to retry thread activation.", error)
                  })
              }
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
