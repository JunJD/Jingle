export function shouldReloadLauncherAiThreadOnFocus(input: {
  activeThreadId: string | null
  isStreaming: boolean
}): boolean {
  return Boolean(input.activeThreadId) && !input.isStreaming
}

export function shouldStartFreshLauncherAiThread(input: { seedQuery: string }): boolean {
  return input.seedQuery.trim().length > 0
}
