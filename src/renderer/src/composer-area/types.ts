import type { ExtensionSourceMention } from "@shared/extension-sources"
import type { ComposerMessageRef } from "@shared/message-content"
import type { KeyboardEvent } from "react"

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
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
  onSubmit?: () => void
  onValueChange?: (value: string) => void
  placeholder?: string
  submitOnEnter?: boolean
  value: string
}
