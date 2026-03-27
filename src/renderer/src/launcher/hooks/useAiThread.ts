import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "../../../../plugins/ai/manifest"
import { useThreadConversationProjection } from "@/lib/thread-conversation"
import { useI18n } from "@/lib/i18n"
import { useLauncherPluginHost } from "../LauncherPluginHost"

export function useAiThread(): {
  conversation: ReturnType<typeof useThreadConversationProjection> & {
    clearVisibleError: () => void
    visibleError: string | null
  }
  handleApprovalDecision: (decision: "approve" | "reject" | "edit") => Promise<void>
  handleInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  isBusy: boolean
  primaryActionDisabled: boolean
  query: string
  runPrimaryAction: () => void
  setQuery: (value: string) => void
  threadId: string | null
} {
  const { copy } = useI18n()
  const host = useLauncherPluginHost()
  const requestRef = useRef(0)
  const hasRunInitialActionRef = useRef(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [pendingQuery, setPendingQuery] = useState(host.seedQuery)
  const [localError, setLocalError] = useState<string | null>(null)
  const [isCreatingThread, setIsCreatingThread] = useState(false)

  const conversation = useThreadConversationProjection(threadId)
  const threadState = conversation.threadState
  const visibleError = conversation.error ?? localError
  const query = threadState?.draftInput ?? pendingQuery

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
        return
      }

      setPendingQuery(value)
    },
    [localError, threadState]
  )

  const submitMessage = useCallback(
    async (message: string): Promise<void> => {
      const requestId = requestRef.current + 1
      requestRef.current = requestId

      try {
        const createdThread = threadId
          ? null
          : await host.threads.create({
              draftInput: message,
              source: AI_THREAD_SOURCE,
              title: copy.launcher.aiThreadTitle,
              visibility: AI_THREAD_VISIBILITY
            })
        if (requestRef.current !== requestId) {
          return
        }

        const nextThreadId = createdThread?.threadId ?? threadId
        if (!nextThreadId) {
          return
        }

        if (createdThread) {
          setThreadId(createdThread.threadId)
        }

        if (localError) {
          setLocalError(null)
        }

        await host.threads.submit({
          message,
          threadId: nextThreadId
        })
      } catch (error) {
        if (requestRef.current !== requestId) {
          return
        }

        setLocalError(error instanceof Error ? error.message : String(error))
      }
    },
    [copy.launcher.aiThreadTitle, host.threads, localError, threadId]
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

  useEffect(() => {
    if (hasRunInitialActionRef.current || host.initialAction !== "submit") {
      return
    }

    const message = host.seedQuery.trim()
    if (!message) {
      hasRunInitialActionRef.current = true
      return
    }

    const submitFrameId = window.requestAnimationFrame(() => {
      hasRunInitialActionRef.current = true
      setIsCreatingThread(true)
      void submitMessage(message).finally(() => {
        setIsCreatingThread(false)
      })
    })

    return () => {
      window.cancelAnimationFrame(submitFrameId)
    }
  }, [host.initialAction, host.seedQuery, submitMessage])

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
            host.navigation.goHome()
          }
          break
        default:
          break
      }
    },
    [conversation.isLoading, host.navigation, query, runPrimaryAction]
  )

  const primaryActionDisabled = useMemo(() => {
    return !query.trim() || conversation.isLoading || isCreatingThread
  }, [conversation.isLoading, isCreatingThread, query])
  const isBusy = conversation.isLoading || isCreatingThread

  return {
    conversation: {
      ...conversation,
      clearVisibleError,
      visibleError
    },
    handleApprovalDecision,
    handleInputKeyDown,
    isBusy,
    primaryActionDisabled,
    query,
    runPrimaryAction,
    setQuery: setInputQuery,
    threadId
  }
}
