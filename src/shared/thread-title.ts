import type { Thread } from "./app-types"
import { isDefaultThreadTitle } from "./i18n"
import { AI_THREAD_SOURCE } from "./launcher-ai"

export function shouldAutoGenerateThreadTitle(
  thread: Pick<Thread, "metadata" | "title"> | null | undefined
): boolean {
  if (!thread?.title) {
    return true
  }

  if (isDefaultThreadTitle(thread.title)) {
    return true
  }

  return thread.metadata?.source === AI_THREAD_SOURCE
}
