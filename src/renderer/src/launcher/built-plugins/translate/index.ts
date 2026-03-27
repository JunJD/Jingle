import { createBuiltLauncherIntentPresentation, defineBuiltLauncherPlugin } from "../sdk"
import { LauncherTranslatePage } from "./TranslatePage"
import { getTranslatePluginCopy } from "./copy"
import { matchTranslateCommandQuery, matchTranslateIntent } from "./languages"

export const translateLauncherPlugin = defineBuiltLauncherPlugin({
  Component: LauncherTranslatePage,
  manifest: {
    id: "translate",
    search: {
      buildIntentItems: ({ copy, locale, query }) => {
        const pluginCopy = getTranslatePluginCopy(locale)
        const trimmedQuery = query.trim()
        const naturalIntentMatch = matchTranslateIntent(trimmedQuery)
        const commandSourceText = matchTranslateCommandQuery(trimmedQuery)

        if (!naturalIntentMatch && !commandSourceText) {
          return []
        }

        const previewText = naturalIntentMatch?.sourceText ?? commandSourceText ?? trimmedQuery

        return [
          {
            id: "feature-translate-intent",
            kind: "plugin",
            openOptions: {
              seedQuery: trimmedQuery
            },
            presentation: createBuiltLauncherIntentPresentation({
              categoryLabel: pluginCopy.searchItemCategoryLabel,
              icon: {
                name: "languages",
                type: "glyph"
              },
              listActionLabel: copy.launcher.openGeneric,
              primaryActionLabel: pluginCopy.searchItemPrimaryActionLabel,
              tone: "accent"
            }),
            priority: 100,
            subtitle: pluginCopy.searchItemSubtitle(previewText),
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
