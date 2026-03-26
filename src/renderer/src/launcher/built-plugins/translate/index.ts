import { defineBuiltLauncherPlugin } from "../sdk"
import { LauncherTranslatePage } from "./TranslatePage"
import { getTranslatePluginCopy } from "./copy"

export const translateLauncherPlugin = defineBuiltLauncherPlugin({
  Component: LauncherTranslatePage,
  manifest: {
    id: "translate",
    search: {
      buildIntentItems: ({ locale, query }) => {
        const pluginCopy = getTranslatePluginCopy(locale)
        const trimmedQuery = query.trim()

        if (!trimmedQuery) {
          return []
        }

        return [
          {
            id: "feature-translate-intent",
            kind: "history",
            openOptions: {
              seedQuery: trimmedQuery
            },
            priority: 100,
            subtitle: pluginCopy.searchItemSubtitle(trimmedQuery),
            title: pluginCopy.entryLabel
          }
        ]
      },
      resolveCommand: ({ key, query, altKey, ctrlKey, metaKey }) => {
        if (altKey || ctrlKey || metaKey) {
          return null
        }

        if (key !== " ") {
          return null
        }

        if (query.trim().toLowerCase() !== "yi") {
          return null
        }

        return {
          openOptions: {
            seedQuery: ""
          }
        }
      }
    },
    viewport: {
      bodyHeight: 392
    }
  }
})
