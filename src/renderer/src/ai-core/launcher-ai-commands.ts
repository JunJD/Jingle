import { MAX_LAUNCHER_SEARCH_RESULTS } from "@shared/launcher"
import { AI_THREAD_SOURCE } from "@shared/launcher-ai"
import type { LauncherSearchResult } from "@shared/launcher-search"
import { resolveShortcutPlatform, type ShortcutPlatform } from "@shared/shortcuts/model"

export const launcherAiCommands = {
  getShortcutPlatform(): ShortcutPlatform {
    return resolveShortcutPlatform(window.electron.process.platform)
  },

  openMainThread(threadId: string): Promise<void> {
    return window.api.durableWindow.openPrimary({ threadId })
  },

  async pinThreadWindow(threadId: string): Promise<boolean> {
    const result = await window.api.durableWindow.pinNew({ threadId })
    if (!result.ok) {
      console.warn("[DurableWindow] Thread window resource limit reached.", result)
      return false
    }
    return true
  },

  openWorkspaceInFinder(workspacePath: string): Promise<void> {
    return window.api.openTargets.open({ folderPath: workspacePath, targetId: "finder" })
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
