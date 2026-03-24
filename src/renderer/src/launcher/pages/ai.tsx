import type { LauncherFeaturePageDefinition, LauncherHomeEntry } from "./types"
import { LauncherAiPage } from "./LauncherAiPage"
import { AI_PAGE_ENTRY } from "./ai-config"

export const aiLauncherPage: LauncherFeaturePageDefinition = {
  id: "ai",
  Component: LauncherAiPage
}

export const aiLauncherHomeEntry: LauncherHomeEntry = {
  pageId: aiLauncherPage.id,
  ...AI_PAGE_ENTRY
}
