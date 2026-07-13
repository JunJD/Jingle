import type {
  ClipboardContext,
  ClipboardFile,
  ClipboardFileList,
  ClipboardPayloadKind,
  ClipboardSnapshot
} from "./clipboard"

export interface ClipboardFilter {
  accepts: readonly ClipboardPayloadKind[]
  acceptFile?: (file: ClipboardFile) => boolean
}

function hasClipboardFiles(files: ClipboardFile[]): files is ClipboardFileList {
  return files.length > 0
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
  if (!hasClipboardFiles(files)) {
    return EMPTY_CLIPBOARD_CONTEXT
  }

  return {
    files,
    kind: "files"
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
