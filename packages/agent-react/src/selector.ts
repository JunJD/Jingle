import { useMemo, useSyncExternalStore } from "react"

export interface JingleExternalStoreSelectorInput<TStoreSnapshot, TSelected> {
  getSnapshot: () => TStoreSnapshot
  getServerSnapshot?: () => TStoreSnapshot
  isEqual?: (left: TSelected, right: TSelected) => boolean
  selector: (snapshot: TStoreSnapshot) => TSelected
  subscribe: (callback: () => void) => () => void
}

function defaultIsEqual<T>(left: T, right: T): boolean {
  return Object.is(left, right)
}

function createCachedSelector<TStoreSnapshot, TSelected>(
  input: Pick<
    JingleExternalStoreSelectorInput<TStoreSnapshot, TSelected>,
    "getSnapshot" | "isEqual" | "selector"
  >
): () => TSelected {
  const isEqual = input.isEqual ?? defaultIsEqual<TSelected>
  let hasSelected = false
  let lastSelected: TSelected

  return () => {
    const selected = input.selector(input.getSnapshot())
    if (hasSelected && isEqual(lastSelected, selected)) {
      return lastSelected
    }

    hasSelected = true
    lastSelected = selected
    return selected
  }
}

export function useJingleExternalStoreSelector<TStoreSnapshot, TSelected>(
  input: JingleExternalStoreSelectorInput<TStoreSnapshot, TSelected>
): TSelected {
  const getSelectedSnapshot = useMemo(
    () =>
      createCachedSelector({
        getSnapshot: input.getSnapshot,
        isEqual: input.isEqual,
        selector: input.selector
      }),
    [input.getSnapshot, input.isEqual, input.selector]
  )
  const getSelectedServerSnapshot = useMemo(
    () =>
      createCachedSelector({
        getSnapshot: input.getServerSnapshot ?? input.getSnapshot,
        isEqual: input.isEqual,
        selector: input.selector
      }),
    [input.getServerSnapshot, input.getSnapshot, input.isEqual, input.selector]
  )

  return useSyncExternalStore(input.subscribe, getSelectedSnapshot, getSelectedServerSnapshot)
}

export interface JingleActiveMessageProjectionSource {
  assistantMessageId: string | null
  turnId: string | null
}

export interface JingleActiveMessageProjectionInput {
  activeAssistantId?: string | null
  activeTurnKey?: string | null
}

export interface JingleMessageProjectionIdentity {
  activeAssistantId: string | null
  activeTurnKey: string | null
}

export interface JingleMessageProjectionMessageSource {
  id: string
  role: string
}

export function selectJingleActiveMessageProjectionInput(
  activeRun: JingleActiveMessageProjectionSource | null | undefined
): JingleActiveMessageProjectionInput {
  if (!activeRun) {
    return {}
  }

  return {
    activeAssistantId: activeRun.assistantMessageId,
    activeTurnKey: activeRun.turnId
  }
}

export function canReuseJingleMessageProjection(input: {
  activeProjectionInput: JingleActiveMessageProjectionInput
  messagesChanged: boolean
  previousProjection: JingleMessageProjectionIdentity
}): boolean {
  if (input.messagesChanged || input.activeProjectionInput.activeTurnKey === undefined) {
    return false
  }

  return (
    input.previousProjection.activeAssistantId ===
      (input.activeProjectionInput.activeAssistantId ?? null) &&
    input.previousProjection.activeTurnKey === (input.activeProjectionInput.activeTurnKey ?? null)
  )
}

export function findJingleChangedAssistantMessage<
  TMessage extends JingleMessageProjectionMessageSource
>(messages: readonly TMessage[], changedMessageId: string | null | undefined): TMessage | null {
  if (!changedMessageId) {
    return null
  }

  const changedMessage = messages.find((message) => message.id === changedMessageId)
  if (!changedMessage || changedMessage.role !== "assistant") {
    return null
  }

  return changedMessage
}
