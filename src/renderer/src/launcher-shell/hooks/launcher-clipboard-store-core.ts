import type { ClipboardContext } from "@shared/clipboard"

const EMPTY_CLIPBOARD_CONTEXT: ClipboardContext = {
  kind: "none"
}

interface LauncherClipboardStoreData {
  acceptedKey: string | null
  dismissedKey: string | null
  rawContext: ClipboardContext
  refreshSequence: number
}

export interface LauncherClipboardStoreState {
  acceptContext: () => void
  acceptedContext: ClipboardContext
  applyRefreshedContext: (context: ClipboardContext) => void
  candidateContext: ClipboardContext
  clearContext: () => void
  refreshSequence: number
}

export interface LauncherClipboardStore {
  getState: () => LauncherClipboardStoreState
  subscribe: (listener: () => void) => () => void
}

export function getClipboardContextKey(context: ClipboardContext): string {
  switch (context.kind) {
    case "none":
      return "none"
    case "image":
      return `image:${context.image.width}x${context.image.height}:${context.image.previewDataUrl.length}:${context.image.previewDataUrl.slice(-48)}`
    case "text":
      return `text:${context.text}`
    case "files":
      return `files:${context.files.map((file) => file.path).join("|")}`
    default: {
      const exhaustiveContext: never = context
      return JSON.stringify(exhaustiveContext)
    }
  }
}

function createStateSnapshot(
  data: LauncherClipboardStoreData,
  actions: Pick<
    LauncherClipboardStoreState,
    "acceptContext" | "applyRefreshedContext" | "clearContext"
  >
): LauncherClipboardStoreState {
  const rawContextKey = getClipboardContextKey(data.rawContext)
  const candidateContext =
    data.dismissedKey === rawContextKey || data.acceptedKey === rawContextKey
      ? EMPTY_CLIPBOARD_CONTEXT
      : data.rawContext
  const acceptedContext =
    data.acceptedKey === rawContextKey ? data.rawContext : EMPTY_CLIPBOARD_CONTEXT

  return {
    ...actions,
    acceptedContext,
    candidateContext,
    refreshSequence: data.refreshSequence
  }
}

export function createLauncherClipboardStore(): LauncherClipboardStore {
  const listeners = new Set<() => void>()
  let data: LauncherClipboardStoreData = {
    acceptedKey: null,
    dismissedKey: null,
    rawContext: EMPTY_CLIPBOARD_CONTEXT,
    refreshSequence: 0
  }
  let snapshot: LauncherClipboardStoreState

  const emit = (): void => {
    snapshot = createStateSnapshot(data, actions)
    listeners.forEach((listener) => listener())
  }

  const setData = (
    update:
      | Partial<LauncherClipboardStoreData>
      | ((current: LauncherClipboardStoreData) => Partial<LauncherClipboardStoreData>)
  ): void => {
    const nextPartial = typeof update === "function" ? update(data) : update
    let changed = false

    for (const key of Object.keys(nextPartial) as (keyof LauncherClipboardStoreData)[]) {
      if (!Object.is(data[key], nextPartial[key])) {
        changed = true
        break
      }
    }

    if (!changed) {
      return
    }

    data = {
      ...data,
      ...nextPartial
    }
    emit()
  }

  const actions = {
    acceptContext: (): void => {
      setData((current) => ({
        acceptedKey: getClipboardContextKey(current.rawContext),
        dismissedKey: null
      }))
    },
    applyRefreshedContext: (context: ClipboardContext): void => {
      setData((current) => {
        const isSameContext =
          getClipboardContextKey(context) === getClipboardContextKey(current.rawContext)

        return {
          acceptedKey: isSameContext ? current.acceptedKey : null,
          dismissedKey: isSameContext ? current.dismissedKey : null,
          rawContext: context,
          refreshSequence: current.refreshSequence + 1
        }
      })
    },
    clearContext: (): void => {
      setData((current) => ({
        acceptedKey: null,
        dismissedKey: getClipboardContextKey(current.rawContext)
      }))
    }
  }

  snapshot = createStateSnapshot(data, actions)

  return {
    getState: (): LauncherClipboardStoreState => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
