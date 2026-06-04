export function shouldReloadLauncherAiThreadOnActivate(input: { isStreaming: boolean }): boolean {
  return !input.isStreaming
}

export function shouldStartFreshLauncherAiThread(input: { seedQuery: string }): boolean {
  return input.seedQuery.trim().length > 0
}

export interface LauncherAiAdjacentThreadIds {
  next: string | null
  previous: string | null
}

export function resolveLauncherAiAdjacentThreadIds(input: {
  activeThreadId: string | null
  isFreshDraftActive: boolean
  threadIdsByRecency: readonly string[]
}): LauncherAiAdjacentThreadIds {
  const { activeThreadId, isFreshDraftActive, threadIdsByRecency } = input

  if (isFreshDraftActive) {
    return {
      next: null,
      previous: threadIdsByRecency[0] ?? null
    }
  }

  if (!activeThreadId) {
    return {
      next: null,
      previous: null
    }
  }

  const activeIndex = threadIdsByRecency.indexOf(activeThreadId)
  if (activeIndex < 0) {
    return {
      next: null,
      previous: null
    }
  }

  return {
    next: threadIdsByRecency[activeIndex - 1] ?? null,
    previous: threadIdsByRecency[activeIndex + 1] ?? null
  }
}
