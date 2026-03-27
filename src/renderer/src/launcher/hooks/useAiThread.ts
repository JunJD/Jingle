import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "../../../../plugins/ai/manifest"
import { useThreadConversationProjection } from "@/lib/thread-conversation"
import { useI18n } from "@/lib/i18n"
import {
  useLauncherPluginHost,
  useLauncherPluginNavigation,
  useLauncherPluginThreads
} from "../LauncherPluginHost"
import type { LauncherInputStatus } from "../launcher-input-status"

export function useAiThread(): {
  conversation: ReturnType<typeof useThreadConversationProjection> & {
    clearVisibleError: () => void
    visibleError: string | null
  }
  handleApprovalDecision: (decision: "approve" | "reject" | "edit") => Promise<void>
  handleInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  inputStatus: LauncherInputStatus
  isBusy: boolean
  primaryActionDisabled: boolean
  query: string
  runPrimaryAction: () => void
  setQuery: (value: string) => void
  threadId: string | null
} {
  const { copy } = useI18n()
  const host = useLauncherPluginHost()
  const navigation = useLauncherPluginNavigation()
  const threads = useLauncherPluginThreads()
  const requestRef = useRef(0)
  const hasRunInitialActionRef = useRef(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [pendingQuery, setPendingQuery] = useState(host.seedQuery)
  const [localError, setLocalError] = useState<string | null>(null)
  const [inputStatus, setInputStatus] = useState<LauncherInputStatus>("idle")
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
          : await threads.create({
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

        await threads.submit({
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
    [copy.launcher.aiThreadTitle, localError, threadId, threads]
  )

  const runPrimaryAction = useCallback((): void => {
    const message = query.trim()
    if (!message || conversation.isLoading || isCreatingThread) {
      return
    }

    setInputStatus("pending")
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
      setInputStatus("pending")
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
      setInputStatus("pending")
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
            navigation.goHome()
          }
          break
        default:
          break
      }
    },
    [conversation.isLoading, navigation, query, runPrimaryAction]
  )

  const primaryActionDisabled = useMemo(() => {
    return !query.trim() || conversation.isLoading || isCreatingThread
  }, [conversation.isLoading, isCreatingThread, query])
  const isBusy = conversation.isLoading || isCreatingThread

  useEffect(() => {
    if (isBusy) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setInputStatus("idle")
    }, 180)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isBusy])

  return {
    conversation: {
      ...conversation,
      clearVisibleError,
      visibleError
    },
    handleApprovalDecision,
    handleInputKeyDown,
    inputStatus,
    isBusy,
    primaryActionDisabled,
    query,
    runPrimaryAction,
    setQuery: setInputQuery,
    threadId
  }
}
