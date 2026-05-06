import { createNativeExtensionIntentPresentation } from "../../api"
import { getTranslatePluginCopy } from "./copy"
import { matchTranslateIntent } from "./languages"

const TRANSLATE_QUICK_COPY_INTENT_ID = "feature-translate-quick-copy-intent"

export const search = {
  buildIntentItems: ({
    locale,
    query
  }: {
    locale: import("../../../shared/i18n").AppLocale
    query: string
  }) => {
    const pluginCopy = getTranslatePluginCopy(locale)
    const trimmedQuery = query.trim()
    const naturalIntentMatch = matchTranslateIntent(trimmedQuery)

    if (!naturalIntentMatch) {
      return []
    }

    return [
      {
        id: TRANSLATE_QUICK_COPY_INTENT_ID,
        kind: "plugin" as const,
        openOptions: {
          seedQuery: trimmedQuery
        },
        presentation: createNativeExtensionIntentPresentation({
          categoryLabel: pluginCopy.searchItemCategoryLabel,
          icon: {
            name: "copy",
            type: "glyph"
          },
          primaryActionLabel: pluginCopy.quickCopyPrimaryActionLabel,
          tone: "accent"
        }),
        priority: 95,
        subtitle: pluginCopy.quickCopySubtitle(
          naturalIntentMatch.sourceText,
          naturalIntentMatch.targetLabel
        ),
        title: pluginCopy.quickCopyEntryLabel
      }
    ]
  }
}
