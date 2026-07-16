import { useCallback, useMemo } from "react"
import {
  DEFAULT_PERMISSION_MODE,
  THREAD_PERMISSION_MODE_METADATA_KEY
} from "@shared/permission-mode"
import { invokeAgentThread } from "@/lib/agent-control"
import { useI18n } from "@/lib/i18n"
import { useThreadContext } from "@/lib/thread-context"
import type { Thread } from "@/types"
import type { AiCoreHostValue, AiCoreThreadCreateInput, AiCoreThreadHandle } from "./AiCoreHost"

interface UseAiCoreThreadHostOptions {
  activeThreadId: string | null
  mode?: AiCoreHostValue["threads"]["mode"]
  setActiveThreadId: (threadId: string) => void
}

function resolveThreadModel(thread: Thread): string | null {
  return typeof thread.metadata?.model === "string" ? thread.metadata.model : null
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
    if (mode === "pinned-thread") {
      throw new Error("Pinned AI session windows cannot create a new thread.")
    }
  }, [mode])

  const activateThread = useCallback(
    async (threadId: string): Promise<void> => {
      setActiveThreadId(threadId)
      await loadThreadData(threadId)
    },
    [loadThreadData, setActiveThreadId]
  )

  const createThread = useCallback(
    async (input: AiCoreThreadCreateInput): Promise<AiCoreThreadHandle> => {
      assertCanCreateThread()
      const [resolvedModelId, workspacePathResult] = await Promise.all([
        input.modelId ? Promise.resolve(input.modelId) : window.api.models.getDefault("llm"),
        input.workspacePath === undefined
          ? window.api.workspace.createDefault({ title: input.title })
          : Promise.resolve(input.workspacePath)
      ])

      const thread = await window.api.threads.create({
        metadata: {
          [THREAD_PERMISSION_MODE_METADATA_KEY]: input.permissionMode ?? DEFAULT_PERMISSION_MODE,
          model: resolvedModelId,
          source: input.source,
          title: input.title,
          visibility: input.visibility
        },
        workflow: input.workflow,
        workspaceKind: input.workspaceKind ?? "projectless",
        workspacePath: workspacePathResult
      })
      await loadThreadData(thread.thread_id)

      return {
        modelId: resolvedModelId,
        threadId: thread.thread_id,
        workspacePath: workspacePathResult
      }
    },
    [assertCanCreateThread, loadThreadData]
  )

  const resolveClonedThreadHandle = useCallback(
    async (thread: Thread): Promise<AiCoreThreadHandle> => {
      const threadModel = resolveThreadModel(thread)
      const [defaultModelId, threadWorkspace] = await Promise.all([
        threadModel ? Promise.resolve(threadModel) : window.api.models.getDefault("llm"),
        window.api.threadWorkspace.get(thread.thread_id)
      ])
      const workspacePath = threadWorkspace?.workspacePath
      if (!workspacePath) {
        throw new Error(inputNeedsWorkspaceMessage)
      }

      return {
        modelId: defaultModelId,
        threadId: thread.thread_id,
        workspacePath
      }
    },
    [inputNeedsWorkspaceMessage]
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
