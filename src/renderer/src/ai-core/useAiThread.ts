import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "@shared/launcher-ai"
import { useAiInvocation } from "@/lib/ai-invocation"
import { useI18n } from "@/lib/i18n"
import { hasComposerMessageInputContent, type ComposerMessageRef } from "@shared/message-content"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import { useAiCoreHost, useAiCoreThreads } from "./AiCoreHost"

interface UseAiThreadOptions {
  messageRefs?: ComposerMessageRef[]
  onDidInvoke?: () => void
}

export function useAiThread(options: UseAiThreadOptions = {}): {
  conversation: ReturnType<typeof useAiInvocation>["conversation"] & {
    clearVisibleError: () => void
    visibleError: string | null
  }
  handleApprovalDecision: (decision: "approve" | "reject" | "edit") => Promise<void>
  inputStatus: LauncherInputStatus
  isBusy: boolean
  primaryActionDisabled: boolean
  query: string
  retry: () => Promise<void>
  runPrimaryAction: () => void
  setQuery: (value: string) => void
  threadId: string | null
} {
  const { messageRefs = [], onDidInvoke } = options
  const { copy } = useI18n()
  const host = useAiCoreHost()
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
  const messageInput = useMemo(
    () => ({
      refs: messageRefs,
      text: query
    }),
    [messageRefs, query]
  )
  const initialMessageInput = useMemo(
    () => ({
      refs: messageRefs,
      text: host.seedQuery
    }),
    [host.seedQuery, messageRefs]
  )

  const runPrimaryAction = useCallback((): void => {
    if (isBusy || !hasComposerMessageInputContent(messageInput)) {
      return
    }

    setInputStatus("pending")
    void invocation.invoke(messageInput).then((didInvoke) => {
      if (didInvoke) {
        onDidInvoke?.()
      }
    })
  }, [invocation, isBusy, messageInput, onDidInvoke])

  useEffect(() => {
    if (hasRunInitialActionRef.current || host.initialAction !== "submit") {
      return
    }

    if (!hasComposerMessageInputContent(initialMessageInput)) {
      hasRunInitialActionRef.current = true
      return
    }

    const submitFrameId = window.requestAnimationFrame(() => {
      hasRunInitialActionRef.current = true
      setInputStatus("pending")
      void invocation.invoke(initialMessageInput).then((didInvoke) => {
        if (didInvoke) {
          onDidInvoke?.()
        }
      })
    })

    return () => {
      window.cancelAnimationFrame(submitFrameId)
    }
  }, [host.initialAction, initialMessageInput, invocation, onDidInvoke])

  const handleApprovalDecision = useCallback(
    async (decision: "approve" | "reject" | "edit"): Promise<void> => {
      setInputStatus("pending")
      await invocation.resume(decision)
    },
    [invocation]
  )

  const primaryActionDisabled = isBusy || !hasComposerMessageInputContent(messageInput)

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
