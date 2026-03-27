import { useEffect, type RefObject } from "react"

type TextInputElement = HTMLInputElement | HTMLTextAreaElement

function focusTextInput(input: TextInputElement | null): void {
  if (!input) {
    return
  }

  input.focus()
  const caretPosition = input.value.length
  input.setSelectionRange(caretPosition, caretPosition)
}

export function useDisableTabNavigation(inputRef: RefObject<TextInputElement | null>): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") {
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
