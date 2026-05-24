import type {
  ClipboardContext,
  ClipboardFile,
  ClipboardPayloadKind,
  ClipboardSnapshot
} from "./clipboard"

export type ClipboardAttachmentContext = Extract<ClipboardSnapshot, { kind: "files" | "image" }>

export interface ClipboardFilter {
  accepts: readonly ClipboardPayloadKind[]
  acceptFile?: (file: ClipboardFile) => boolean
}

export interface LauncherHomeClipboardState {
  autofillText: string | null
  previewContext: ClipboardAttachmentContext | null
}

const EMPTY_CLIPBOARD_CONTEXT: ClipboardContext = {
  kind: "none"
}

export function filterClipboardSnapshot(
  snapshot: ClipboardSnapshot,
  filter: ClipboardFilter
): ClipboardSnapshot {
  if (!filter.accepts.includes(snapshot.kind as ClipboardPayloadKind)) {
    return EMPTY_CLIPBOARD_CONTEXT
  }

  if (snapshot.kind !== "files" || !filter.acceptFile) {
    return snapshot
  }

  const files = snapshot.files.filter(filter.acceptFile)
  if (files.length === 0) {
    return EMPTY_CLIPBOARD_CONTEXT
  }

  return {
    files,
    kind: "files"
  }
}

export function deriveLauncherHomeClipboardState(
  snapshot: ClipboardSnapshot
): LauncherHomeClipboardState {
  switch (snapshot.kind) {
    case "text":
      return {
        autofillText: snapshot.text,
        previewContext: null
      }
    case "files":
    case "image":
      return {
        autofillText: null,
        previewContext: snapshot
      }
    case "none":
    default:
      return {
        autofillText: null,
        previewContext: null
      }
  }
}

export function deriveLauncherCommandOwnerClipboardContext(
  snapshot: ClipboardSnapshot,
  filter: ClipboardFilter | null | undefined
): ClipboardSnapshot {
  if (!filter) {
    return snapshot
  }

  return filterClipboardSnapshot(snapshot, filter)
}
