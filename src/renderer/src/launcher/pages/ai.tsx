import type { LauncherPluginDefinition } from "./types"
import { LauncherAiPage } from "./LauncherAiPage"
import { getAiPageViewportHeight } from "./ai-config"

export const aiLauncherPlugin: LauncherPluginDefinition = {
  buildHomeEntry: ({ copy }) => ({
    pluginId: "ai",
    label: copy.launcher.aiEntryLabel,
    shortcutLabel: "Tab"
  }),
  buildIntentItems: ({ copy, query }) => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      return []
    }

    return [
      {
        id: "feature-ai-intent",
        kind: "ai",
        openOptions: {
          seedQuery: trimmedQuery
        },
        presentation: {
          categoryLabel: copy.launcher.resultKindAgent,
          icon: {
            name: "sparkles",
            type: "glyph"
          },
          listActionLabel: copy.launcher.openGeneric,
          primaryActionLabel: copy.launcher.aiPrimaryLabel,
          tone: "accent"
        },
        priority: 10,
        subtitle: copy.launcher.aiIntentSubtitle(trimmedQuery),
        title: copy.launcher.aiEntryLabel
      }
    ]
  },
  id: "ai",
  Component: LauncherAiPage,
  getViewportHeight: getAiPageViewportHeight
}
