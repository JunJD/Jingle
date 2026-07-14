import {
  AI_CHAT_COMMAND_NAME,
  AI_INTENT_ID,
  AI_RESULT_KIND,
  aiBuiltInCommandManifest
} from "@shared/launcher-ai"
import { getAiPageViewportHeight } from "./ai-config"
import { defineBuiltInCommandOwner } from "@launcher-shell/built-ins/sdk"
import { LazyLauncherAiPage } from "./LazyLauncherAiPage"

export const aiBuiltInCommandOwner = defineBuiltInCommandOwner({
  commands: [
    {
      Component: LazyLauncherAiPage,
      commandName: AI_CHAT_COMMAND_NAME,
      mode: "view",
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
  manifest: aiBuiltInCommandManifest
})
