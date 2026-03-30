import {
  AI_CHAT_ENTRY_ID,
  AI_INTENT_ID,
  AI_RESULT_KIND,
  aiLauncherPluginManifest
} from "../../../../../plugins/ai/manifest"
import { LauncherAiPage } from "../../pages/LauncherAiPage"
import { getAiPageViewportHeight } from "../../pages/ai-config"
import { defineBuiltLauncherPlugin } from "../sdk"

export const aiLauncherPlugin = defineBuiltLauncherPlugin({
  entries: [
    {
      Component: LauncherAiPage,
      entryId: AI_CHAT_ENTRY_ID,
      search: {
        buildIntentItems: ({ copy, query }) => {
          const trimmedQuery = query.trim()
          if (!trimmedQuery) {
            return []
          }

          return [
            {
              id: AI_INTENT_ID,
              kind: AI_RESULT_KIND,
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
        }
      },
      viewport: {
        getHeight: getAiPageViewportHeight
      }
    }
  ],
  manifest: aiLauncherPluginManifest
})
