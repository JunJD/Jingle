import type { AppLocale } from "@shared/i18n"

export interface TranslateLanguageOption {
  id: string
  label: string
  promptLabel: string
}

export const TRANSLATE_LANGUAGE_OPTIONS: TranslateLanguageOption[] = [
  { id: "auto", label: "Detect Language", promptLabel: "Auto Detect" },
  { id: "en", label: "English", promptLabel: "English" },
  { id: "zh-Hans", label: "Chinese (Simplified)", promptLabel: "Simplified Chinese" },
  { id: "ja", label: "Japanese", promptLabel: "Japanese" },
  { id: "ko", label: "Korean", promptLabel: "Korean" },
  { id: "fr", label: "French", promptLabel: "French" },
  { id: "de", label: "German", promptLabel: "German" },
  { id: "es", label: "Spanish", promptLabel: "Spanish" },
  { id: "pt", label: "Portuguese", promptLabel: "Portuguese" },
  { id: "ru", label: "Russian", promptLabel: "Russian" },
  { id: "be", label: "Belarusian", promptLabel: "Belarusian" },
  { id: "ar", label: "Arabic", promptLabel: "Arabic" },
  { id: "hi", label: "Hindi", promptLabel: "Hindi" }
]

const TRANSLATE_LANGUAGE_ALIASES: Record<string, string> = {
  auto: "auto",
  "auto detect": "auto",
  arabic: "ar",
  belarusian: "be",
  chinese: "zh-Hans",
  "chinese simplified": "zh-Hans",
  english: "en",
  french: "fr",
  german: "de",
  hindi: "hi",
  japanese: "ja",
  korean: "ko",
  portuguese: "pt",
  russian: "ru",
  "simplified chinese": "zh-Hans",
  spanish: "es",
  中文: "zh-Hans",
  俄语: "ru",
  印地语: "hi",
  德语: "de",
  日文: "ja",
  日语: "ja",
  法文: "fr",
  法语: "fr",
  汉语: "zh-Hans",
  白俄罗斯语: "be",
  简中: "zh-Hans",
  简体中文: "zh-Hans",
  简体汉语: "zh-Hans",
  繁体中文: "zh-Hans",
  粤语: "zh-Hans",
  英语: "en",
  英文: "en",
  西班牙语: "es",
  葡萄牙语: "pt",
  韩文: "ko",
  韩语: "ko",
  阿拉伯语: "ar"
}

export interface TranslateIntentMatch {
  sourceText: string
  targetLabel: string
  targetLanguageId: string
}

export interface ParsedTranslateSeedQuery {
  sourceLanguageId: string
  sourceText: string
  targetLanguageId: string
}

export function getTranslateLanguageOption(languageId: string): TranslateLanguageOption {
  return (
    TRANSLATE_LANGUAGE_OPTIONS.find((option) => option.id === languageId) ??
    TRANSLATE_LANGUAGE_OPTIONS[0]
  )
}

export function detectTranslateLanguageId(text: string): string {
  if (!text.trim()) {
    return "en"
  }

  if (/[\u3040-\u30ff]/u.test(text)) {
    return "ja"
  }

  if (/[\uac00-\ud7af]/u.test(text)) {
    return "ko"
  }

  if (/[\u0600-\u06ff]/u.test(text)) {
    return "ar"
  }

  if (/[\u0900-\u097f]/u.test(text)) {
    return "hi"
  }

  if (/[\u4e00-\u9fff]/u.test(text)) {
    return "zh-Hans"
  }

  if (/[\u0400-\u04ff]/u.test(text)) {
    return "ru"
  }

  return "en"
}

export function getSuggestedTargetLanguageId(sourceLanguageId: string, locale: AppLocale): string {
  if (sourceLanguageId === "zh-Hans") {
    return "en"
  }

  if (sourceLanguageId === "en") {
    return "zh-Hans"
  }

  return locale === "zh-CN" ? "zh-Hans" : "en"
}

export function resolveTranslateLanguageIdFromText(value: string): string | null {
  const normalizedValue = value.trim().toLowerCase()
  if (!normalizedValue) {
    return null
  }

  return TRANSLATE_LANGUAGE_ALIASES[normalizedValue] ?? null
}

export function matchTranslateIntent(query: string): TranslateIntentMatch | null {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return null
  }

  const naturalLanguageMatch =
    /^(?:请)?(?:把|将)?(.+?)翻译成(.+)$/u.exec(trimmedQuery) ??
    /^translate\s+(.+?)\s+to\s+(.+)$/iu.exec(trimmedQuery)

  if (!naturalLanguageMatch) {
    return null
  }

  const sourceText = naturalLanguageMatch[1]?.trim()
  const targetLabel = naturalLanguageMatch[2]?.trim()
  if (!sourceText || !targetLabel) {
    return null
  }

  const targetLanguageId = resolveTranslateLanguageIdFromText(targetLabel)
  if (!targetLanguageId || targetLanguageId === "auto") {
    return null
  }

  return {
    sourceText,
    targetLabel,
    targetLanguageId
  }
}

export function matchTranslateCommandQuery(query: string): string | null {
  const commandQueryMatch = /^yi\s+(.+)$/iu.exec(query.trim())
  const sourceText = commandQueryMatch?.[1]?.trim()
  return sourceText ? sourceText : null
}

export function parseTranslateSeedQuery(
  seedQuery: string,
  locale: AppLocale
): ParsedTranslateSeedQuery {
  const trimmedSeedQuery = seedQuery.trim()
  const commandQueryMatch = /^yi\s*(.*)$/iu.exec(trimmedSeedQuery)
  const naturalIntentMatch = matchTranslateIntent(trimmedSeedQuery)

  if (!trimmedSeedQuery) {
    return {
      sourceLanguageId: "en",
      sourceText: "",
      targetLanguageId: "zh-Hans"
    }
  }

  if (commandQueryMatch) {
    const sourceText = commandQueryMatch[1]?.trim() ?? ""
    const sourceLanguageId = detectTranslateLanguageId(sourceText)
    return {
      sourceLanguageId: sourceText ? sourceLanguageId : "en",
      sourceText,
      targetLanguageId: getSuggestedTargetLanguageId(sourceLanguageId, locale)
    }
  }

  if (naturalIntentMatch) {
    const sourceLanguageId = detectTranslateLanguageId(naturalIntentMatch.sourceText)
    return {
      sourceLanguageId,
      sourceText: naturalIntentMatch.sourceText,
      targetLanguageId: naturalIntentMatch.targetLanguageId
    }
  }

  const sourceLanguageId = detectTranslateLanguageId(trimmedSeedQuery)
  return {
    sourceLanguageId,
    sourceText: seedQuery,
    targetLanguageId: getSuggestedTargetLanguageId(sourceLanguageId, locale)
  }
}
