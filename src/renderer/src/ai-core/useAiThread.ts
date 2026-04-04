import { useCallback, useEffect, useRef, useState } from "react"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "@shared/launcher-ai"
import { useAiInvocation } from "@/lib/ai-invocation"
import { useI18n } from "@/lib/i18n"
import { hasMessageContent } from "@shared/message-content"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import type { Message } from "@/types"
import {
  useAiCoreHost,
  useAiCoreNavigation,
  useAiCoreThreads
} from "./AiCoreHost"

interface UseAiThreadOptions {
  buildMessageContent?: (message: string) => Message["content"]
  onDidInvoke?: () => void
}

export function useAiThread(options: UseAiThreadOptions = {}): {
  conversation: ReturnType<typeof useAiInvocation>["conversation"] & {
    clearVisibleError: () => void
    visibleError: string | null
  }
  handleApprovalDecision: (decision: "approve" | "reject" | "edit") => Promise<void>
  handleInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  inputStatus: LauncherInputStatus
  isBusy: boolean
  primaryActionDisabled: boolean
  query: string
  retry: () => Promise<void>
  runPrimaryAction: () => void
  setQuery: (value: string) => void
  threadId: string | null
} {
  const { buildMessageContent, onDidInvoke } = options
  const { copy } = useI18n()
  const host = useAiCoreHost()
  const navigation = useAiCoreNavigation()
  const threads = useAiCoreThreads()
  const hasRunInitialActionRef = useRef(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [inputStatus, setInputStatus] = useState<LauncherInputStatus>("idle")
  const invocation = useAiInvocation({
    ensureThread: async ({ draftInput }) => {
      const createdThread = await threads.create({
        draftInput,
        source: AI_THREAD_SOURCE,
        title: copy.launcher.aiThreadTitle,
        visibility: AI_THREAD_VISIBILITY
      })
      setThreadId(createdThread.threadId)
      return {
        threadId: createdThread.threadId
      }
    },
    initialInput: host.seedQuery,
    threadId
  })
  const query = invocation.input
  const isBusy = invocation.isBusy
  const messageContent = buildMessageContent ? buildMessageContent(query) : query

  const runPrimaryAction = useCallback((): void => {
    if (isBusy || !hasMessageContent(messageContent)) {
      return
    }

    setInputStatus("pending")
    void invocation.invoke(query, messageContent).then((didInvoke) => {
      if (didInvoke) {
        onDidInvoke?.()
      }
    })
  }, [invocation, isBusy, messageContent, onDidInvoke, query])

  useEffect(() => {
    if (hasRunInitialActionRef.current || host.initialAction !== "submit") {
      return
    }

    const message = host.seedQuery.trim()
    const initialContent = buildMessageContent
      ? buildMessageContent(host.seedQuery)
      : host.seedQuery
    if (!hasMessageContent(initialContent)) {
      hasRunInitialActionRef.current = true
      return
    }

    const submitFrameId = window.requestAnimationFrame(() => {
      hasRunInitialActionRef.current = true
      setInputStatus("pending")
      void invocation.invoke(message, initialContent).then((didInvoke) => {
        if (didInvoke) {
          onDidInvoke?.()
        }
      })
    })

    return () => {
      window.cancelAnimationFrame(submitFrameId)
    }
  }, [buildMessageContent, host.initialAction, host.seedQuery, invocation, onDidInvoke])

  const handleApprovalDecision = useCallback(
    async (decision: "approve" | "reject" | "edit"): Promise<void> => {
      setInputStatus("pending")
      await invocation.resume(decision)
    },
    [invocation]
  )

  const executeAiShortcutCommand = useCallback(
    (commandId: string): void => {
      if (commandId === LAUNCHER_COMMAND_IDS.aiSubmit) {
        runPrimaryAction()
      }
    },
    [runPrimaryAction]
  )

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      switch (event.key) {
        case "Enter":
          event.preventDefault()
          executeAiShortcutCommand(LAUNCHER_COMMAND_IDS.aiSubmit)
          break
        case "Backspace":
          if (!query && !isBusy) {
            event.preventDefault()
            navigation.goHome()
          }
          break
        default:
          break
      }
    },
    [executeAiShortcutCommand, isBusy, navigation, query]
  )

  const primaryActionDisabled = isBusy || !hasMessageContent(messageContent)

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

  useEffect(() => {
    if (!threadId) {
      return
    }

    const handleWindowFocus = (): void => {
      void threads.reload(threadId)
    }

    window.addEventListener("focus", handleWindowFocus)
    return () => {
      window.removeEventListener("focus", handleWindowFocus)
    }
  }, [threadId, threads])

  return {
    conversation: {
      ...invocation.conversation,
      clearVisibleError: invocation.clearVisibleError,
      visibleError: invocation.visibleError
    },
    handleApprovalDecision,
    handleInputKeyDown,
    inputStatus,
    isBusy,
    primaryActionDisabled,
    query,
    retry: invocation.retry,
    runPrimaryAction,
    setQuery: invocation.setInput,
    threadId
  }
}
