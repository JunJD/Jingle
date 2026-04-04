import {
  AI_CHAT_COMMAND_NAME,
  AI_INTENT_ID,
  AI_RESULT_KIND,
  aiBuiltInCommandManifest
} from "@shared/launcher-ai"
import { LauncherAiPage } from "../../pages/LauncherAiPage"
import { getAiPageViewportHeight } from "../../pages/ai-config"
import { defineBuiltInCommandOwner } from "../sdk"

export const aiBuiltInCommandOwner = defineBuiltInCommandOwner({
  commands: [
    {
      Component: LauncherAiPage,
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
