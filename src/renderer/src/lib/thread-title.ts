import type { Thread } from "@/types"
import { shouldAutoGenerateThreadTitle } from "@shared/thread-title"

interface GenerateThreadTitleOptions {
  persistTitle?: (threadId: string, title: string) => Promise<void>
  thread?: Pick<Thread, "metadata" | "title"> | null
}

export async function maybeGenerateThreadTitle(
  threadId: string,
  message: string,
  options: GenerateThreadTitleOptions = {}
): Promise<void> {
  try {
    const thread = options.thread ?? (await window.api.threads.get(threadId))

    if (!shouldAutoGenerateThreadTitle(thread)) {
      return
    }

    const title = await window.api.threads.generateTitle(message)
    if (!title || title === thread?.title) {
      return
    }

    if (options.persistTitle) {
      await options.persistTitle(threadId, title)
      return
    }

    await window.api.threads.update(threadId, { title })
  } catch (error) {
    console.error("[ThreadTitle] Failed to generate title:", error)
  }
}
