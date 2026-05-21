import type { Thread } from "./app-types"
import { isDefaultThreadTitle } from "./i18n"
import { AI_THREAD_PLACEHOLDER_TITLES, AI_THREAD_SOURCE } from "./launcher-ai"

function isLauncherAiPlaceholderTitle(title: string): boolean {
  return AI_THREAD_PLACEHOLDER_TITLES.some((placeholder) => placeholder === title)
}

export function shouldAutoGenerateThreadTitle(
  thread: Pick<Thread, "metadata" | "title"> | null | undefined
): boolean {
  if (!thread?.title) {
    return true
  }

  if (isDefaultThreadTitle(thread.title)) {
    return true
  }

  return thread.metadata?.source === AI_THREAD_SOURCE && isLauncherAiPlaceholderTitle(thread.title)
}
