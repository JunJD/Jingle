import { parseComposerReferenceText } from "@shared/composer-reference-uri"
import {
  toComposerMessageInput,
  type ComposerMessageInput,
  type ComposerMessageRef
} from "@shared/message-content"
import type { Message } from "@/types"

export const MAX_COMPOSER_HISTORY_ENTRIES = 100

export interface ComposerHistoryNavigation {
  entry: ComposerMessageInput
  index: number
}

export interface ComposerHistoryCursor {
  index: number
  scope: object | null
}

function cloneComposerMessageInput(input: ComposerMessageInput): ComposerMessageInput {
  return {
    refs: input.refs.map((ref) => ({ ...ref })),
    text: input.text
  }
}

function getComposerMessageRefKey(ref: ComposerMessageRef): string {
  switch (ref.type) {
    case "file":
      return JSON.stringify(["file", ref.path])
    case "image":
      return JSON.stringify(["image", ref.url])
    case "extension-source":
      return JSON.stringify(["extension-source", ref.extensionName, ref.sourceId])
    case "assistant-message-selection":
      return JSON.stringify([
        "assistant-message-selection",
        ref.sourceThreadId,
        ref.sourceMessageId,
        ref.selectedText
      ])
  }
}

export function createComposerHistoryCursor(
  scope: object | null,
  index = -1
): ComposerHistoryCursor {
  return { index, scope }
}

export function getComposerHistoryCursorIndex(
  cursor: ComposerHistoryCursor,
  scope: object | null
): number {
  return cursor.scope === scope ? cursor.index : -1
}

export function dedupeComposerMessageRefs(
  refs: readonly ComposerMessageRef[]
): ComposerMessageRef[] {
  const uniqueRefs: ComposerMessageRef[] = []
  const seenRefKeys = new Set<string>()
  for (const ref of refs) {
    const key = getComposerMessageRefKey(ref)
    if (seenRefKeys.has(key)) {
      continue
    }

    uniqueRefs.push({ ...ref })
    seenRefKeys.add(key)
  }
  return uniqueRefs
}

export function buildCurrentComposerMessageInput(input: {
  attachmentRefs: readonly ComposerMessageRef[]
  editorRefs: readonly ComposerMessageRef[]
  metadataRefs: readonly ComposerMessageRef[]
  text: string
}): ComposerMessageInput {
  const extensionSourceRefs = input.metadataRefs.filter((ref) => ref.type === "extension-source")
  const assistantSelectionRefs = input.metadataRefs.filter(
    (ref) => ref.type === "assistant-message-selection"
  )
  return {
    refs: dedupeComposerMessageRefs([
      ...input.editorRefs,
      ...extensionSourceRefs,
      ...input.attachmentRefs,
      ...assistantSelectionRefs
    ]),
    text: input.text
  }
}

function areComposerMessageInputsEqual(
  left: ComposerMessageInput,
  right: ComposerMessageInput
): boolean {
  return (
    left.text === right.text &&
    left.refs.length === right.refs.length &&
    left.refs.every(
      (ref, index) => getComposerMessageRefKey(ref) === getComposerMessageRefKey(right.refs[index]!)
    )
  )
}

export function projectComposerHistory(
  messages: readonly Pick<Message, "content" | "metadata" | "role">[],
  maxEntries = MAX_COMPOSER_HISTORY_ENTRIES
): ComposerMessageInput[] {
  const entries: ComposerMessageInput[] = []

  for (const message of messages) {
    if (message.role !== "user") {
      continue
    }

    const entry = toComposerMessageInput(message.content, message.metadata)
    if (entry.text.length === 0 && entry.refs.length === 0) {
      continue
    }

    const previous = entries.at(-1)
    if (previous && areComposerMessageInputsEqual(previous, entry)) {
      continue
    }
    entries.push(cloneComposerMessageInput(entry))
  }

  return entries.slice(-maxEntries).reverse()
}

export function navigateComposerHistory(input: {
  direction: "down" | "up"
  entries: readonly ComposerMessageInput[]
  index: number
}): ComposerHistoryNavigation | null {
  if (input.direction === "up") {
    const nextIndex = input.index < 0 ? 0 : input.index + 1
    const entry = input.entries[nextIndex]
    return entry ? { entry: cloneComposerMessageInput(entry), index: nextIndex } : null
  }

  if (input.index < 0) {
    return null
  }

  if (input.index === 0) {
    return {
      entry: { refs: [], text: "" },
      index: -1
    }
  }

  const nextIndex = input.index - 1
  const entry = input.entries[nextIndex]
  return entry ? { entry: cloneComposerMessageInput(entry), index: nextIndex } : null
}

export function getComposerAttachmentRefs(
  input: ComposerMessageInput
): Array<Extract<ComposerMessageRef, { type: "file" | "image" }>> {
  const inlineFilePaths = new Set(
    parseComposerReferenceText(input.text)?.references.flatMap((reference) =>
      reference.type === "workspace-file" ? [reference.path] : []
    ) ?? []
  )

  const attachmentRefs: Array<Extract<ComposerMessageRef, { type: "file" | "image" }>> = []
  for (const ref of input.refs) {
    if (ref.type === "image") {
      attachmentRefs.push({ ...ref })
      continue
    }
    if (ref.type === "file" && !inlineFilePaths.has(ref.path)) {
      attachmentRefs.push({ ...ref })
    }
  }
  return attachmentRefs
}
