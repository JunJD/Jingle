import type { LauncherPluginDefinition } from "./types"
import { LauncherAiPage } from "./LauncherAiPage"
import { getAiPageViewportHeight } from "./ai-config"

export const aiLauncherPlugin: LauncherPluginDefinition = {
  buildHomeEntry: (copy) => ({
    pluginId: "ai",
    label: copy.launcher.aiEntryLabel,
    shortcutLabel: "Tab"
  }),
  id: "ai",
  Component: LauncherAiPage,
  getViewportHeight: getAiPageViewportHeight
}
