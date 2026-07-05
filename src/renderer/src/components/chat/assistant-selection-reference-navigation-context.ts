import { createContext, use, useEffect, useSyncExternalStore } from "react"
import type { ComposerMessageRef } from "@shared/message-content"

type AssistantSelectionRef = Extract<ComposerMessageRef, { type: "assistant-message-selection" }>

export interface AssistantSelectionReferenceNavigationHandler {
  canRevealReference: (ref: AssistantSelectionRef) => boolean
  revealReference: (ref: AssistantSelectionRef) => void
}

export interface AssistantSelectionReferenceNavigationStore {
  getSnapshot: () => AssistantSelectionReferenceNavigationHandler | null
  register: (handler: AssistantSelectionReferenceNavigationHandler) => () => void
  subscribe: (listener: () => void) => () => void
}

export const AssistantSelectionReferenceNavigationContext =
  createContext<AssistantSelectionReferenceNavigationStore | null>(null)

const getNullSnapshot = (): null => null
const subscribeToNoopStore = (): (() => void) => () => {}

export function useAssistantSelectionReferenceNavigationRegistration(
  handler: AssistantSelectionReferenceNavigationHandler
): void {
  const store = use(AssistantSelectionReferenceNavigationContext)

  useEffect(() => {
    if (store === null) {
      return undefined
    }

    return store.register(handler)
  }, [handler, store])
}

export function useAssistantSelectionReferenceNavigation(): AssistantSelectionReferenceNavigationHandler | null {
  const store = use(AssistantSelectionReferenceNavigationContext)
  const subscribe = store === null ? subscribeToNoopStore : store.subscribe
  const getSnapshot = store === null ? getNullSnapshot : store.getSnapshot

  return useSyncExternalStore(subscribe, getSnapshot, getNullSnapshot)
}
