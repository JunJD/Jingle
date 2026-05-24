import { createLauncherIntentPresentation } from "@shared/launcher"
import type { AppLocale } from "@shared/i18n"
import { getTranslatePluginCopy } from "./copy"
import { matchTranslateCommandQuery, matchTranslateIntent } from "./languages"

const TRANSLATE_INTENT_ID = "feature-translate-intent"

interface TranslateSearchCopy {
  launcher: {
    openGeneric: string
  }
}

export const viewport = {
  bodyHeight: 392
}

export const search = {
  buildIntentItems: ({
    copy,
    locale,
    query
  }: {
    copy: TranslateSearchCopy
    locale: AppLocale
    query: string
  }) => {
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
        id: TRANSLATE_INTENT_ID,
        kind: "plugin" as const,
        openOptions: {
          seedQuery: trimmedQuery
        },
        presentation: createLauncherIntentPresentation({
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
  resolveCommand: ({
    altKey,
    ctrlKey,
    key,
    metaKey,
    query
  }: {
    altKey: boolean
    ctrlKey: boolean
    key: string
    metaKey: boolean
    query: string
  }) => {
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
}
