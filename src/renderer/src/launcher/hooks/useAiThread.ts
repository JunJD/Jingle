import { useCallback, useEffect, useRef, useState } from "react"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "../../../../plugins/ai/manifest"
import { useAiInvocation } from "@/lib/ai-invocation"
import { useI18n } from "@/lib/i18n"
import {
  useLauncherPluginHost,
  useLauncherPluginNavigation,
  useLauncherPluginThreads
} from "../LauncherPluginHost"
import type { LauncherInputStatus } from "../launcher-input-status"

export function useAiThread(): {
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
  runPrimaryAction: () => void
  setQuery: (value: string) => void
  threadId: string | null
} {
  const { copy } = useI18n()
  const host = useLauncherPluginHost()
  const navigation = useLauncherPluginNavigation()
  const threads = useLauncherPluginThreads()
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

  const runPrimaryAction = useCallback((): void => {
    if (!invocation.canInvoke) {
      return
    }

    setInputStatus("pending")
    void invocation.invoke()
  }, [invocation])

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
      void invocation.invoke(message)
    })

    return () => {
      window.cancelAnimationFrame(submitFrameId)
    }
  }, [host.initialAction, host.seedQuery, invocation])

  const handleApprovalDecision = useCallback(
    async (decision: "approve" | "reject" | "edit"): Promise<void> => {
      setInputStatus("pending")
      await invocation.resume(decision)
    },
    [invocation]
  )

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      switch (event.key) {
        case "Enter":
          event.preventDefault()
          runPrimaryAction()
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
    [isBusy, navigation, query, runPrimaryAction]
  )

  const primaryActionDisabled = !invocation.canInvoke

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
    runPrimaryAction,
    setQuery: invocation.setInput,
    threadId
  }
}
