import { aiLauncherPage } from "./ai"
import type { LauncherSecondaryPageDefinition, LauncherSecondaryPageId } from "./types"

export const launcherSecondaryPages: LauncherSecondaryPageDefinition[] = [aiLauncherPage]

const launcherSecondaryPageMap = Object.fromEntries(
  launcherSecondaryPages.map((page) => [page.id, page])
) as Record<LauncherSecondaryPageId, LauncherSecondaryPageDefinition>

export const DEFAULT_LAUNCHER_SECONDARY_PAGE_ID: LauncherSecondaryPageId = aiLauncherPage.id

export function getLauncherSecondaryPageDefinition(
  pageId: LauncherSecondaryPageId
): LauncherSecondaryPageDefinition {
  return launcherSecondaryPageMap[pageId]
}
