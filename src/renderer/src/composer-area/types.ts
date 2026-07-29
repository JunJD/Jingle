import type { ExtensionSourceMention } from "@shared/extension-sources"
import type { ComposerMessageRef } from "@shared/message-content"
import type { Ref } from "react"
import type { ComposerAreaKeyboardEvent } from "./keyboard-event"

export interface ComposerWorkspaceFileMention {
  name: string
  path: string
}

export interface ComposerAreaHandle {
  blur: () => void
  focus: () => void
  getElement: () => HTMLElement | null
  getModelText: () => string
  getRefs: () => ComposerMessageRef[]
  insertText: (text: string) => void
}

export interface ComposerAreaProps {
  className?: string
  disabled?: boolean
  maxHeight: number | string
  minHeight: number | string
  sourceMentions?: ExtensionSourceMention[]
  workspaceFileMentions?: ComposerWorkspaceFileMention[]
  workspaceFileSearchEnabled?: boolean
  workspaceFileSearchIncomplete?: boolean
  workspaceFileSearchInProgress?: boolean
  onKeyDown?: (event: ComposerAreaKeyboardEvent) => void
  onMentionQueryChange?: (query: string | null) => void
  onSubmit?: () => void
  onValueChange?: (value: string) => void
  placeholder?: string
  ref?: Ref<ComposerAreaHandle>
  value: string
}
