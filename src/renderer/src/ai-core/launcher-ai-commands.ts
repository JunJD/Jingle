import { MAX_LAUNCHER_SEARCH_RESULTS } from "@shared/launcher"
import { AI_THREAD_SOURCE } from "@shared/launcher-ai"
import type { OpenPinnedAiSessionWindowResult } from "@shared/ai-session-window"
import type { LauncherSearchResult } from "@shared/launcher-search"
import { resolveShortcutPlatform, type ShortcutPlatform } from "@shared/shortcuts/model"

export const launcherAiCommands = {
  getShortcutPlatform(): ShortcutPlatform {
    return resolveShortcutPlatform(window.electron.process.platform)
  },

  openPinnedThread(threadId: string): Promise<OpenPinnedAiSessionWindowResult> {
    return window.api.aiSessionWindows.openPinned({ threadId })
  },

  openWorkspaceInFinder(workspacePath: string): Promise<void> {
    return window.api.openTargets.open({ folderPath: workspacePath, targetId: "finder" })
  },

  async updatePinnedThread(windowId: string, threadId: string): Promise<boolean> {
    const result = await window.api.aiSessionWindows.updatePinnedThread({ threadId, windowId })
    return result.ok
  },

  async searchThreads(query: string): Promise<LauncherSearchResult[]> {
    const response = await window.api.launcher.search({
      limit: MAX_LAUNCHER_SEARCH_RESULTS,
      query,
      sources: ["threads"],
      threadMetadataSource: AI_THREAD_SOURCE
    })

    return response.results.filter((result) => result.action.type === "open-history-thread")
  },

  writeClipboardText(text: string): Promise<void> {
    return navigator.clipboard.writeText(text)
  }
}
