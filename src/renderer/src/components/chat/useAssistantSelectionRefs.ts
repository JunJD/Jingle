import { useCallback, useMemo, useState } from "react"
import type { ComposerMessageRef } from "@shared/message-content"

type AssistantSelectionRef = Extract<ComposerMessageRef, { type: "assistant-message-selection" }>
export type ComposerMetadataRef = Extract<
  ComposerMessageRef,
  { type: "assistant-message-selection" | "extension-source" }
>

const emptyComposerMetadataRefs: ComposerMetadataRef[] = []

function getAssistantSelectionRefKey(ref: AssistantSelectionRef): string {
  return JSON.stringify([
    "assistant-message-selection",
    ref.sourceThreadId,
    ref.sourceMessageId,
    ref.selectedText
  ])
}

function getComposerMetadataRefKey(ref: ComposerMetadataRef): string {
  return ref.type === "assistant-message-selection"
    ? getAssistantSelectionRefKey(ref)
    : JSON.stringify(["extension-source", ref.extensionName, ref.sourceId])
}

export function getAssistantSelectionRefs(
  refs: readonly ComposerMessageRef[]
): AssistantSelectionRef[] {
  return refs.filter(
    (ref): ref is AssistantSelectionRef => ref.type === "assistant-message-selection"
  )
}

export function getComposerMetadataRefs(
  refs: readonly ComposerMessageRef[]
): ComposerMetadataRef[] {
  return refs.filter(
    (ref): ref is ComposerMetadataRef =>
      ref.type === "assistant-message-selection" || ref.type === "extension-source"
  )
}

export function dedupeComposerMetadataRefs(
  refs: readonly ComposerMessageRef[]
): ComposerMetadataRef[] {
  const uniqueRefs: ComposerMetadataRef[] = []
  const seenKeys = new Set<string>()
  for (const ref of getComposerMetadataRefs(refs)) {
    const key = getComposerMetadataRefKey(ref)
    if (seenKeys.has(key)) {
      continue
    }

    uniqueRefs.push({ ...ref })
    seenKeys.add(key)
  }
  return uniqueRefs
}

export function useAssistantSelectionRefs(threadId: string | null | undefined): {
  addSelectionRef: (ref: AssistantSelectionRef) => void
  clearAllRefs: () => void
  clearExtensionSourceRefs: () => void
  clearSelectionRefs: () => void
  messageRefs: ComposerMetadataRef[]
  refs: AssistantSelectionRef[]
  removeSelectionRef: (ref: AssistantSelectionRef) => void
  replaceRefs: (refs: readonly ComposerMessageRef[]) => void
} {
  const resolvedThreadId = threadId ?? null
  const [state, setState] = useState<{
    refs: ComposerMetadataRef[]
    threadId: string | null
  }>(() => ({
    refs: [],
    threadId: resolvedThreadId
  }))
  const messageRefs = state.threadId === resolvedThreadId ? state.refs : emptyComposerMetadataRefs
  const refs = useMemo(() => getAssistantSelectionRefs(messageRefs), [messageRefs])

  const addSelectionRef = useCallback(
    (ref: AssistantSelectionRef): void => {
      setState((currentState) => {
        const currentRefs = currentState.threadId === resolvedThreadId ? currentState.refs : []
        const nextKey = getComposerMetadataRefKey(ref)
        if (currentRefs.some((currentRef) => getComposerMetadataRefKey(currentRef) === nextKey)) {
          return currentState.threadId === resolvedThreadId
            ? currentState
            : { refs: currentRefs, threadId: resolvedThreadId }
        }

        return {
          refs: [...currentRefs, ref],
          threadId: resolvedThreadId
        }
      })
    },
    [resolvedThreadId]
  )

  const removeSelectionRef = useCallback(
    (ref: AssistantSelectionRef): void => {
      const targetKey = getComposerMetadataRefKey(ref)
      setState((currentState) => {
        const currentRefs = currentState.threadId === resolvedThreadId ? currentState.refs : []

        return {
          refs: currentRefs.filter(
            (currentRef) => getComposerMetadataRefKey(currentRef) !== targetKey
          ),
          threadId: resolvedThreadId
        }
      })
    },
    [resolvedThreadId]
  )

  const clearSelectionRefs = useCallback((): void => {
    setState((currentState) => {
      const currentRefs = currentState.threadId === resolvedThreadId ? currentState.refs : []
      return {
        refs: currentRefs.filter((ref) => ref.type !== "assistant-message-selection"),
        threadId: resolvedThreadId
      }
    })
  }, [resolvedThreadId])

  const clearExtensionSourceRefs = useCallback((): void => {
    setState((currentState) => {
      const currentRefs = currentState.threadId === resolvedThreadId ? currentState.refs : []
      return {
        refs: currentRefs.filter((ref) => ref.type !== "extension-source"),
        threadId: resolvedThreadId
      }
    })
  }, [resolvedThreadId])

  const clearAllRefs = useCallback((): void => {
    setState({ refs: [], threadId: resolvedThreadId })
  }, [resolvedThreadId])

  const replaceRefs = useCallback(
    (nextRefs: readonly ComposerMessageRef[]): void => {
      setState({ refs: dedupeComposerMetadataRefs(nextRefs), threadId: resolvedThreadId })
    },
    [resolvedThreadId]
  )

  return useMemo(
    () => ({
      addSelectionRef,
      clearAllRefs,
      clearExtensionSourceRefs,
      clearSelectionRefs,
      messageRefs,
      refs,
      removeSelectionRef,
      replaceRefs
    }),
    [
      addSelectionRef,
      clearAllRefs,
      clearExtensionSourceRefs,
      clearSelectionRefs,
      messageRefs,
      refs,
      removeSelectionRef,
      replaceRefs
    ]
  )
}
