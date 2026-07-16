import { useEffect, type RefObject } from "react"
import type { ComposerAreaHandle } from "@/composer-area"

type TextInputElement = HTMLInputElement | HTMLTextAreaElement | ComposerAreaHandle

function isComposerAreaHandle(input: TextInputElement): input is ComposerAreaHandle {
  return "getElement" in input
}

function focusTextInput(input: TextInputElement | null): void {
  if (!input) {
    return
  }

  input.focus()

  if (isComposerAreaHandle(input)) {
    return
  }

  const caretPosition = input.value.length
  input.setSelectionRange(caretPosition, caretPosition)
}

export function useDisableTabNavigation(inputRef: RefObject<TextInputElement | null>): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") {
        return
      }

      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) {
        return
      }

      event.preventDefault()
      focusTextInput(inputRef.current)
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [inputRef])
}
