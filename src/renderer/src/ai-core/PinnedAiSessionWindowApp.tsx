import { useCallback, useMemo, useRef, useState } from "react"
import { AiCoreHostProvider, type AiCoreThreadCreateInput } from "./AiCoreHost"
import { getAiShellConfig } from "./ai-config"
import { LauncherAiPage } from "./LauncherAiPage"
import { invokeAgentThread } from "@/lib/agent-control"
import { useI18n } from "@/lib/i18n"
import { useThreadContext } from "@/lib/thread-context"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import type { ComposerAreaHandle } from "@/composer-area"
import {
  DEFAULT_PERMISSION_MODE,
  THREAD_PERMISSION_MODE_METADATA_KEY
} from "@shared/permission-mode"
import { AI_CHAT_COMMAND_NAME, AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { FALLBACK_SHELL_CONFIG } from "@shared/launcher"
import type { ClipboardContext } from "@shared/clipboard"
import type { Thread } from "@/types"

const PINNED_SESSION_VIEWPORT_HEIGHT = 640
const EMPTY_CLIPBOARD_CONTEXT: ClipboardContext = {
  kind: "none"
}

function readPinnedSessionThreadId(): string | null {
  const threadId = new URLSearchParams(window.location.search).get("threadId")?.trim()
  return threadId && threadId.length > 0 ? threadId : null
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

function resolveThreadModel(thread: Thread): string | null {
  return typeof thread.metadata?.model === "string" ? thread.metadata.model : null
}

export function PinnedAiSessionWindowApp(): React.JSX.Element {
  const initialThreadId = useMemo(() => readPinnedSessionThreadId(), [])
  const { copy } = useI18n()
  const inputNeedsWorkspaceMessage = copy.chat.inputNeedsWorkspace
  const threadContext = useThreadContext()
  const { loadThreadData } = threadContext
  const inputRef = useRef<LauncherInputElement | ComposerAreaHandle | null>(null)
  const [activeThreadId, setActiveThreadId] = useState(initialThreadId)
  const [inputStatus, setInputStatus] = useState<LauncherInputStatus>("idle")

  const activateThread = useCallback(
    async (threadId: string): Promise<void> => {
      setActiveThreadId(threadId)
      await loadThreadData(threadId)
    },
    [loadThreadData]
  )
  const createThread = useCallback(
    async (input: AiCoreThreadCreateInput) => {
      const [resolvedModelId, workspacePathResult] = await Promise.all([
        input.modelId ? Promise.resolve(input.modelId) : window.api.models.getDefault("llm"),
        input.workspacePath === undefined
          ? window.api.workspace.createDefault({ title: input.title })
          : Promise.resolve(input.workspacePath)
      ])
      const workspacePath = workspacePathResult

      const thread = await window.api.threads.create({
        metadata: {
          [THREAD_PERMISSION_MODE_METADATA_KEY]: input.permissionMode ?? DEFAULT_PERMISSION_MODE,
          model: resolvedModelId,
          source: input.source,
          title: input.title,
          visibility: input.visibility
        },
        workspaceKind: input.workspaceKind ?? "projectless",
        workspacePath
      })

      await activateThread(thread.thread_id)
      return {
        modelId: resolvedModelId,
        threadId: thread.thread_id,
        workspacePath
      }
    },
    [activateThread]
  )
  const cloneThread = useCallback(
    async (threadId: string) => {
      const thread = await window.api.threads.clone(threadId)
      const modelId = resolveThreadModel(thread) ?? (await window.api.models.getDefault("llm"))
      const workspacePath = (await window.api.threadWorkspace.get(thread.thread_id))?.workspacePath
      if (!workspacePath) {
        throw new Error(inputNeedsWorkspaceMessage)
      }

      await activateThread(thread.thread_id)
      return {
        modelId,
        threadId: thread.thread_id,
        workspacePath
      }
    },
    [activateThread, inputNeedsWorkspaceMessage]
  )
  const cloneThreadUntilMessage = useCallback(
    async (threadId: string, messageId: string) => {
      const thread = await window.api.threads.cloneUntilMessage(threadId, messageId)
      const modelId = resolveThreadModel(thread) ?? (await window.api.models.getDefault("llm"))
      const workspacePath = (await window.api.threadWorkspace.get(thread.thread_id))?.workspacePath
      if (!workspacePath) {
        throw new Error(inputNeedsWorkspaceMessage)
      }

      await activateThread(thread.thread_id)
      return {
        modelId,
        threadId: thread.thread_id,
        workspacePath
      }
    },
    [activateThread, inputNeedsWorkspaceMessage]
  )
  const listThreads = useCallback((): Promise<Thread[]> => {
    return window.api.threads.list()
  }, [])
  const submitThread = useCallback(
    async (input: { message: string; threadId: string }): Promise<void> => {
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

  if (!initialThreadId) {
    return <PinnedAiSessionWindowError message="Missing AI session thread." />
  }

  return (
    <div className="launcher-window-frame">
      <div className="launcher-window-shell" data-active-plugin={AI_LAUNCHER_PLUGIN_ID}>
        <AiCoreHostProvider
          value={{
            clipboard: {
              clearContext: () => {},
              context: EMPTY_CLIPBOARD_CONTEXT
            },
            chrome: {
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
              activate: activateThread,
              clone: cloneThread,
              cloneUntilMessage: cloneThreadUntilMessage,
              create: createThread,
              getActiveThreadId: () => activeThreadId,
              list: listThreads,
              submit: submitThread
            }
          }}
        >
          <LauncherAiPage />
        </AiCoreHostProvider>
      </div>
    </div>
  )
}
