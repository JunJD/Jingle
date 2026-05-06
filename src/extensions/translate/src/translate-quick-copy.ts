import { writeClipboardText } from "../../runtime-api"
import {
  detectTranslateLanguageId,
  getTranslateLanguageOption,
  matchTranslateIntent
} from "./languages"
import { translateRuntimeClient } from "./runtime-client"

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
  const response = await translateRuntimeClient.translate({
    backend: {
      kind: "llm",
      ...(modelId ? { modelId } : {})
    },
    sourceLanguage: getTranslateLanguageOption(sourceLanguageId).promptLabel,
    targetLanguage: getTranslateLanguageOption(intentMatch.targetLanguageId).promptLabel,
    text: intentMatch.sourceText
  })

  await writeClipboardText(response.translatedText)
  navigation?.goHome()
}
