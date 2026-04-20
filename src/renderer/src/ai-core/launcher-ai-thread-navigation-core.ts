export function shouldReloadLauncherAiThreadOnFocus(input: {
  activeThreadId: string | null
  isStreaming: boolean
}): boolean {
  return Boolean(input.activeThreadId) && !input.isStreaming
}
