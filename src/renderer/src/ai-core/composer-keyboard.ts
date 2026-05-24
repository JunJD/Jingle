export interface ComposerKeyDownContext {
  attachmentCount: number
  composerText: string
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">
}

export function shouldGoHomeFromComposerKeyDown(context: ComposerKeyDownContext): boolean {
  const { attachmentCount, composerText, event } = context

  if (
    (event.key !== "Backspace" && event.key !== "Delete") ||
    event.shiftKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  ) {
    return false
  }

  return composerText.trim().length === 0 && attachmentCount === 0
}
