import type { LauncherFeaturePageDefinition } from "./types"
import { LauncherAiPage } from "./LauncherAiPage"
import { getAiPageViewportHeight } from "./ai-config"

export const aiLauncherPage: LauncherFeaturePageDefinition = {
  id: "ai",
  Component: LauncherAiPage,
  getViewportHeight: getAiPageViewportHeight
}
