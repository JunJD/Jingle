import { useCallback, useMemo } from "react"
import {
  DEFAULT_PERMISSION_MODE,
  THREAD_PERMISSION_MODE_METADATA_KEY
} from "@shared/permission-mode"
import { invokeAgentThread } from "@/lib/agent-control"
import { readThreadModelRuntimeSelection } from "@shared/model-runtime-selection"
import { useI18n } from "@/lib/i18n"
import type { AppCopy } from "@/lib/i18n/messages"
import { useThreadContext } from "@/lib/thread-context"
import type { Thread } from "@/types"
import type { AiCoreHostValue, AiCoreThreadCreateInput, AiCoreThreadHandle } from "./AiCoreHost"

interface UseAiCoreThreadHostOptions {
  activeThreadId: string | null
  hydrateCreatedThread?: boolean
  mode?: AiCoreHostValue["threads"]["mode"]
  setActiveThreadId: (threadId: string) => void
}

function requireThreadModelId(thread: Thread, copy: AppCopy["chat"]): string {
  const state = readThreadModelRuntimeSelection(thread.metadata)
  switch (state.kind) {
    case "ready":
      return state.selection.modelId
    case "legacy_missing_effort":
      throw new Error(copy.modelRuntimeSelectionLegacyMissingEffort)
    case "invalid":
      throw new Error(copy.modelRuntimeSelectionInvalid)
    case "missing":
      throw new Error(copy.modelRuntimeSelectionMissing)
  }
}

export function useAiCoreThreadHost(
  options: UseAiCoreThreadHostOptions
): AiCoreHostValue["threads"] {
  const { activeThreadId, mode = "launcher", setActiveThreadId } = options
  const { copy } = useI18n()
  const inputNeedsWorkspaceMessage = copy.chat.inputNeedsWorkspace
  const threadContext = useThreadContext()
  const { loadThreadData } = threadContext
  const assertCanCreateThread = useCallback((): void => {
    if (mode !== "launcher" && mode !== "main") throw new Error("Unknown AI thread host mode.")
  }, [mode])

  const activateThread = useCallback(
    async (threadId: string, activationOptions?: { hydrate?: boolean }): Promise<void> => {
      setActiveThreadId(threadId)
      if (activationOptions?.hydrate !== false) await loadThreadData(threadId)
    },
    [loadThreadData, setActiveThreadId]
  )

  const createThread = useCallback(
    async (input: AiCoreThreadCreateInput): Promise<AiCoreThreadHandle> => {
      assertCanCreateThread()
      const thread = await window.api.threads.create({
        ...(input.workspacePath === undefined ? { createDefaultWorkspace: true } : {}),
        metadata: {
          [THREAD_PERMISSION_MODE_METADATA_KEY]: input.permissionMode ?? DEFAULT_PERMISSION_MODE,
          source: input.source,
          title: input.title,
          visibility: input.visibility
        },
        modelRuntimeSelection: input.modelRuntimeSelection,
        workflow: input.workflow,
        workspaceKind: input.workspaceKind ?? "projectless",
        workspacePath: input.workspacePath
      })
      const resolvedModelId = requireThreadModelId(thread, copy.chat)
      const workspacePathResult = await window.api.workspace.get(thread.thread_id)
      if (!workspacePathResult) {
        throw new Error(inputNeedsWorkspaceMessage)
      }
      if (options.hydrateCreatedThread !== false) await loadThreadData(thread.thread_id)

      return {
        modelId: resolvedModelId,
        threadId: thread.thread_id,
        workspacePath: workspacePathResult
      }
    },
    [
      assertCanCreateThread,
      copy.chat,
      inputNeedsWorkspaceMessage,
      loadThreadData,
      options.hydrateCreatedThread
    ]
  )

  const resolveClonedThreadHandle = useCallback(
    async (thread: Thread): Promise<AiCoreThreadHandle> => {
      const modelId = requireThreadModelId(thread, copy.chat)
      const threadWorkspace = await window.api.threadWorkspace.get(thread.thread_id)
      const workspacePath = threadWorkspace?.workspacePath
      if (!workspacePath) {
        throw new Error(inputNeedsWorkspaceMessage)
      }

      return {
        modelId,
        threadId: thread.thread_id,
        workspacePath
      }
    },
    [copy.chat, inputNeedsWorkspaceMessage]
  )

  const cloneThread = useCallback(
    async (threadId: string): Promise<AiCoreThreadHandle> => {
      assertCanCreateThread()
      return resolveClonedThreadHandle(await window.api.threads.clone(threadId))
    },
    [assertCanCreateThread, resolveClonedThreadHandle]
  )

  const cloneThreadUntilMessage = useCallback(
    async (threadId: string, messageId: string): Promise<AiCoreThreadHandle> => {
      assertCanCreateThread()
      return resolveClonedThreadHandle(
        await window.api.threads.cloneUntilMessage(threadId, messageId)
      )
    },
    [assertCanCreateThread, resolveClonedThreadHandle]
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

  return useMemo(
    () => ({
      activate: activateThread,
      clone: cloneThread,
      cloneUntilMessage: cloneThreadUntilMessage,
      create: createThread,
      getActiveThreadId: () => activeThreadId,
      list: listThreads,
      mode,
      submit: submitThread
    }),
    [
      activateThread,
      activeThreadId,
      cloneThread,
      cloneThreadUntilMessage,
      createThread,
      listThreads,
      mode,
      submitThread
    ]
  )
}
