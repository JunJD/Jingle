import { createNativeExtensionIntentPresentation } from "../../api"
import { getTranslatePluginCopy } from "./copy"
import {
  detectTranslateLanguageId,
  getTranslateLanguageOption,
  matchTranslateIntent
} from "./languages"
import { translateClient } from "./api"

const TRANSLATE_QUICK_COPY_INTENT_ID = "feature-translate-quick-copy-intent"

export default async function runTranslateQuickCopy({
  commandPreferences,
  navigation,
  seedQuery
}: {
  commandPreferences: Record<string, unknown>
  navigation?: { goHome: () => void }
  seedQuery: string
}): Promise<void> {
  const intentMatch = matchTranslateIntent(seedQuery.trim())

  if (!intentMatch) {
    navigation?.goHome()
    return
  }

  const sourceLanguageId = detectTranslateLanguageId(intentMatch.sourceText)
  const modelId =
    typeof commandPreferences.modelId === "string" ? commandPreferences.modelId.trim() : ""
  const response = await translateClient.translate({
    backend: {
      kind: "llm",
      ...(modelId ? { modelId } : {})
    },
    sourceLanguage: getTranslateLanguageOption(sourceLanguageId).promptLabel,
    targetLanguage: getTranslateLanguageOption(intentMatch.targetLanguageId).promptLabel,
    text: intentMatch.sourceText
  })

  await navigator.clipboard.writeText(response.translatedText)
  navigation?.goHome()
}

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
