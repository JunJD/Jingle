import type { ClipboardContext } from "@shared/clipboard"

const EMPTY_CLIPBOARD_CONTEXT: ClipboardContext = {
  kind: "none"
}

interface LauncherClipboardStoreData {
  dismissedKey: string | null
  rawContext: ClipboardContext
  refreshSequence: number
}

export interface LauncherClipboardStoreState {
  applyRefreshedContext: (context: ClipboardContext) => void
  clearContext: () => void
  context: ClipboardContext
  contextKey: string
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
  actions: Pick<LauncherClipboardStoreState, "applyRefreshedContext" | "clearContext">
): LauncherClipboardStoreState {
  const rawContextKey = getClipboardContextKey(data.rawContext)
  const context = data.dismissedKey === rawContextKey ? EMPTY_CLIPBOARD_CONTEXT : data.rawContext

  return {
    ...actions,
    context,
    contextKey: getClipboardContextKey(context),
    refreshSequence: data.refreshSequence
  }
}

export function createLauncherClipboardStore(): LauncherClipboardStore {
  const listeners = new Set<() => void>()
  let data: LauncherClipboardStoreData = {
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
    applyRefreshedContext: (context: ClipboardContext): void => {
      setData((current) => ({
        dismissedKey: null,
        rawContext: context,
        refreshSequence: current.refreshSequence + 1
      }))
    },
    clearContext: (): void => {
      setData((current) => ({
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
