import { aiLauncherPage } from "./ai"
import type { LauncherFeaturePageDefinition, LauncherFeaturePageId } from "./types"

const launcherFeaturePageMap: Record<LauncherFeaturePageId, LauncherFeaturePageDefinition> = {
  [aiLauncherPage.id]: aiLauncherPage
}

export const DEFAULT_HOME_ENTRY_PAGE_ID: LauncherFeaturePageId = aiLauncherPage.id

export function getLauncherFeaturePageDefinition(
  pageId: LauncherFeaturePageId
): LauncherFeaturePageDefinition {
  return launcherFeaturePageMap[pageId]
}
