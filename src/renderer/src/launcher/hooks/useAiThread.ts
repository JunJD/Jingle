import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useThreadContext } from "@/lib/thread-context"
import { useThreadConversationProjection } from "@/lib/thread-conversation"
import { useI18n } from "@/lib/i18n"
import { useLauncherInput } from "../LauncherInputContext"

interface CreatedLauncherThread {
  modelId: string
  threadId: string
  workspacePath: string
}

export function useAiThread(props: { onBack: () => void }): {
  conversation: ReturnType<typeof useThreadConversationProjection> & {
    clearVisibleError: () => void
    visibleError: string | null
  }
  handleApprovalDecision: (decision: "approve" | "reject" | "edit") => Promise<void>
  handleInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  primaryActionDisabled: boolean
  query: string
  runPrimaryAction: () => void
  setQuery: (value: string) => void
  threadId: string | null
} {
  const { copy } = useI18n()
  const { onBack } = props
  const threadContext = useThreadContext()
  const { query, setQuery } = useLauncherInput()
  const requestRef = useRef(0)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [isCreatingThread, setIsCreatingThread] = useState(false)

  const conversation = useThreadConversationProjection(threadId)
  const threadState = conversation.threadState
  const visibleError = conversation.error ?? localError

  useEffect(() => {
    return () => {
      requestRef.current += 1
    }
  }, [])

  const clearVisibleError = useCallback(() => {
    if (localError) {
      setLocalError(null)
    }

    if (conversation.error) {
      conversation.clearError()
    }
  }, [conversation, localError])

  const setInputQuery = useCallback(
    (value: string): void => {
      if (localError) {
        setLocalError(null)
      }

      if (threadState) {
        threadState.setDraftInput(value)
      }

      setQuery(value)
    },
    [localError, setQuery, threadState]
  )

  useEffect(() => {
    if (!threadState) {
      return
    }

    if (threadState.draftInput !== query) {
      setQuery(threadState.draftInput)
    }
  }, [query, setQuery, threadState])

  const waitForThreadStream = useCallback(
    async (nextThreadId: string, requestId: number) => {
      let stream = threadContext.getStreamData(nextThreadId).stream
      while (!stream && requestRef.current === requestId) {
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve())
        })
        stream = threadContext.getStreamData(nextThreadId).stream
      }

      return requestRef.current === requestId ? stream : null
    },
    [threadContext]
  )

  const createLauncherThread = useCallback(
    async (message: string, requestId: number): Promise<CreatedLauncherThread | null> => {
      const [defaultModelId, workspacePath] = await Promise.all([
        window.api.models.getDefault(),
        window.api.workspace.get()
      ])

      if (!workspacePath) {
        setLocalError(copy.chat.inputNeedsWorkspace)
        return null
      }

      const thread = await window.api.threads.create({
        model: defaultModelId,
        source: "launcher-ai",
        title: copy.launcher.aiThreadTitle,
        visibility: "launcher-private",
        workspacePath
      })

      if (requestRef.current !== requestId) {
        return null
      }

      threadContext.initializeThread(thread.thread_id)
      const actions = threadContext.getThreadActions(thread.thread_id)
      actions.setCurrentModel(defaultModelId)
      actions.setWorkspacePath(workspacePath)
      actions.setDraftInput(message)

      setThreadId(thread.thread_id)
      return {
        modelId: defaultModelId,
        threadId: thread.thread_id,
        workspacePath
      }
    },
    [copy.chat.inputNeedsWorkspace, copy.launcher.aiThreadTitle, threadContext]
  )

  const submitMessage = useCallback(
    async (message: string): Promise<void> => {
      const requestId = requestRef.current + 1
      requestRef.current = requestId

      const createdThread = threadId ? null : await createLauncherThread(message, requestId)
      const nextThreadId = createdThread?.threadId ?? threadId
      if (!nextThreadId) {
        return
      }

      const stream = await waitForThreadStream(nextThreadId, requestId)
      if (!stream) {
        return
      }

      const state = threadContext.getThreadState(nextThreadId)
      const actions = threadContext.getThreadActions(nextThreadId)
      const workspacePath = createdThread?.workspacePath ?? state.workspacePath
      const modelId = createdThread?.modelId ?? state.currentModel

      if (!workspacePath) {
        actions.setError(copy.chat.inputNeedsWorkspace)
        return
      }

      if (state.error) {
        actions.clearError()
      }

      if (localError) {
        setLocalError(null)
      }

      if (state.pendingApproval) {
        actions.setPendingApproval(null)
      }

      setQuery("")
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
              model_id: modelId,
              thread_id: nextThreadId
            }
          }
        }
      )
    },
    [
      copy.chat.inputNeedsWorkspace,
      createLauncherThread,
      localError,
      setQuery,
      threadContext,
      threadId,
      waitForThreadStream
    ]
  )

  const runPrimaryAction = useCallback((): void => {
    const message = query.trim()
    if (!message || conversation.isLoading || isCreatingThread) {
      return
    }

    setIsCreatingThread(true)
    void submitMessage(message).finally(() => {
      setIsCreatingThread(false)
    })
  }, [conversation.isLoading, isCreatingThread, query, submitMessage])

  const handleApprovalDecision = useCallback(
    async (decision: "approve" | "reject" | "edit"): Promise<void> => {
      await conversation.resumePendingApproval(decision)
    },
    [conversation]
  )

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      switch (event.key) {
        case "Enter":
          event.preventDefault()
          runPrimaryAction()
          break
        case "Backspace":
          if (!query && !conversation.isLoading) {
            event.preventDefault()
            onBack()
          }
          break
        default:
          break
      }
    },
    [conversation.isLoading, onBack, query, runPrimaryAction]
  )

  const primaryActionDisabled = useMemo(() => {
    return !query.trim() || conversation.isLoading || isCreatingThread
  }, [conversation.isLoading, isCreatingThread, query])

  return {
    conversation: {
      ...conversation,
      clearVisibleError,
      visibleError
    },
    handleApprovalDecision,
    handleInputKeyDown,
    primaryActionDisabled,
    query,
    runPrimaryAction,
    setQuery: setInputQuery,
    threadId
  }
}
