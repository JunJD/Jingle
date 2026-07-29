import type { KeyboardEvent as ReactKeyboardEvent } from "react"

export interface ComposerAreaKeyboardEvent {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly defaultPrevented: boolean
  readonly isComposing: boolean
  readonly key: string
  readonly keyCode: number
  readonly metaKey: boolean
  readonly shiftKey: boolean
  preventDefault: () => void
}

export interface ComposerAreaKeyboardEventSource {
  altKey: boolean
  ctrlKey: boolean
  isComposing: boolean
  isDefaultPrevented: () => boolean
  key: string
  keyCode: number
  metaKey: boolean
  preventDefault: () => void
  shiftKey: boolean
}

export function createComposerAreaKeyboardEvent(
  source: ComposerAreaKeyboardEventSource
): ComposerAreaKeyboardEvent {
  return {
    altKey: source.altKey,
    ctrlKey: source.ctrlKey,
    get defaultPrevented() {
      return source.isDefaultPrevented()
    },
    isComposing: source.isComposing,
    key: source.key,
    keyCode: source.keyCode,
    metaKey: source.metaKey,
    preventDefault: source.preventDefault,
    shiftKey: source.shiftKey
  }
}

export function fromDomKeyboardEvent(event: KeyboardEvent): ComposerAreaKeyboardEvent {
  return createComposerAreaKeyboardEvent({
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    isComposing: event.isComposing,
    isDefaultPrevented: () => event.defaultPrevented,
    key: event.key,
    keyCode: event.keyCode,
    metaKey: event.metaKey,
    preventDefault: () => event.preventDefault(),
    shiftKey: event.shiftKey
  })
}

export function fromReactKeyboardEvent(
  event: ReactKeyboardEvent<HTMLElement>
): ComposerAreaKeyboardEvent {
  const nativeEvent = event.nativeEvent
  return createComposerAreaKeyboardEvent({
    altKey: nativeEvent.altKey,
    ctrlKey: nativeEvent.ctrlKey,
    isComposing: nativeEvent.isComposing,
    isDefaultPrevented: () => event.defaultPrevented,
    key: nativeEvent.key,
    keyCode: nativeEvent.keyCode,
    metaKey: nativeEvent.metaKey,
    preventDefault: () => event.preventDefault(),
    shiftKey: nativeEvent.shiftKey
  })
}
