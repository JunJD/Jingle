import { useCallback, useMemo, useState } from "react"
import type { ComposerMessageRef } from "@shared/message-content"

type AssistantSelectionRef = Extract<ComposerMessageRef, { type: "assistant-message-selection" }>

const emptyAssistantSelectionRefs: AssistantSelectionRef[] = []

function getAssistantSelectionRefKey(ref: AssistantSelectionRef): string {
  return `${ref.sourceThreadId}:${ref.sourceMessageId}:${ref.selectedText}`
}

export function getAssistantSelectionRefs(refs: readonly ComposerMessageRef[]): AssistantSelectionRef[] {
  return refs.filter(
    (ref): ref is AssistantSelectionRef => ref.type === "assistant-message-selection"
  )
}

export function useAssistantSelectionRefs(threadId: string | null | undefined): {
  addSelectionRef: (ref: AssistantSelectionRef) => void
  clearSelectionRefs: () => void
  refs: AssistantSelectionRef[]
  removeSelectionRef: (ref: AssistantSelectionRef) => void
} {
  const resolvedThreadId = threadId ?? null
  const [state, setState] = useState<{
    refs: AssistantSelectionRef[]
    threadId: string | null
  }>(() => ({
    refs: [],
    threadId: resolvedThreadId
  }))
  const refs = state.threadId === resolvedThreadId ? state.refs : emptyAssistantSelectionRefs

  const addSelectionRef = useCallback((ref: AssistantSelectionRef): void => {
    setState((currentState) => {
      const currentRefs =
        currentState.threadId === resolvedThreadId ? currentState.refs : []
      const nextKey = getAssistantSelectionRefKey(ref)
      if (currentRefs.some((currentRef) => getAssistantSelectionRefKey(currentRef) === nextKey)) {
        return currentState.threadId === resolvedThreadId
          ? currentState
          : { refs: currentRefs, threadId: resolvedThreadId }
      }

      return {
        refs: [...currentRefs, ref],
        threadId: resolvedThreadId
      }
    })
  }, [resolvedThreadId])

  const removeSelectionRef = useCallback((ref: AssistantSelectionRef): void => {
    const targetKey = getAssistantSelectionRefKey(ref)
    setState((currentState) => {
      const currentRefs =
        currentState.threadId === resolvedThreadId ? currentState.refs : []

      return {
        refs: currentRefs.filter(
          (currentRef) => getAssistantSelectionRefKey(currentRef) !== targetKey
        ),
        threadId: resolvedThreadId
      }
    })
  }, [resolvedThreadId])

  const clearSelectionRefs = useCallback((): void => {
    setState({
      refs: [],
      threadId: resolvedThreadId
    })
  }, [resolvedThreadId])

  return useMemo(
    () => ({
      addSelectionRef,
      clearSelectionRefs,
      refs,
      removeSelectionRef
    }),
    [addSelectionRef, clearSelectionRefs, refs, removeSelectionRef]
  )
}
