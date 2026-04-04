import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useI18n, useNativeCommandPreferences, useNativeExtensionHost } from "../../api"
import { translateClient } from "./api"
import {
  TRANSLATE_LANGUAGE_OPTIONS,
  detectTranslateLanguageId,
  getTranslateLanguageOption,
  parseTranslateSeedQuery
} from "./languages"

interface TranslateCommandPreferences {
  modelId: string
}

export function useTranslate(): {
  canSubmit: boolean
  copied: boolean
  copyTranslatedText: () => Promise<void>
  error: string | null
  isDirty: boolean
  isTranslating: boolean
  languageOptions: typeof TRANSLATE_LANGUAGE_OPTIONS
  setSourceLanguageId: (languageId: string) => void
  setSourceText: (value: string) => void
  setTargetLanguageId: (languageId: string) => void
  sourceLanguageId: string
  sourceText: string
  submitTranslation: () => Promise<void>
  swapLanguages: () => void
  targetLanguageId: string
  translatedText: string
} {
  const { locale } = useI18n()
  const host = useNativeExtensionHost()
  const preferences = useNativeCommandPreferences<TranslateCommandPreferences>()
  const requestRef = useRef(0)
  const copyResetTimerRef = useRef<number | null>(null)
  const initialSeedState = useMemo(
    () => parseTranslateSeedQuery(host.seedQuery, locale),
    [host.seedQuery, locale]
  )
  const [sourceText, setSourceTextState] = useState(initialSeedState.sourceText)
  const [sourceLanguageId, setSourceLanguageIdState] = useState(initialSeedState.sourceLanguageId)
  const [targetLanguageId, setTargetLanguageIdState] = useState(initialSeedState.targetLanguageId)
  const [translatedText, setTranslatedText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [lastCompletedRequestKey, setLastCompletedRequestKey] = useState<string | null>(null)
  const trimmedSourceText = sourceText.trim()
  const currentRequestKey = useMemo(
    () => `${sourceLanguageId}::${targetLanguageId}::${trimmedSourceText}`,
    [sourceLanguageId, targetLanguageId, trimmedSourceText]
  )
  const isDirty = trimmedSourceText.length > 0 && currentRequestKey !== lastCompletedRequestKey
  const canSubmit = trimmedSourceText.length > 0 && !isTranslating

  useEffect(() => {
    return () => {
      requestRef.current += 1
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (trimmedSourceText) {
      return
    }

    requestRef.current += 1
    setTranslatedText("")
    setError(null)
    setIsTranslating(false)
    setLastCompletedRequestKey(null)
  }, [trimmedSourceText])

  const submitTranslation = useCallback(async (): Promise<void> => {
    if (!trimmedSourceText) {
      return
    }

    const sourceLanguage = getTranslateLanguageOption(sourceLanguageId)
    const targetLanguage = getTranslateLanguageOption(targetLanguageId)
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setCopied(false)
    setError(null)

    if (sourceLanguageId !== "auto" && sourceLanguageId === targetLanguageId) {
      setTranslatedText(sourceText)
      setLastCompletedRequestKey(currentRequestKey)
      setIsTranslating(false)
      return
    }

    setIsTranslating(true)

    try {
      const modelId = preferences.modelId.trim()
      const response = await translateClient.translate({
        backend: {
          kind: "llm",
          ...(modelId ? { modelId } : {})
        },
        sourceLanguage: sourceLanguage.promptLabel,
        targetLanguage: targetLanguage.promptLabel,
        text: sourceText
      })

      if (requestRef.current !== requestId) {
        return
      }

      setTranslatedText(response.translatedText)
      setLastCompletedRequestKey(currentRequestKey)
    } catch (nextError: unknown) {
      if (requestRef.current !== requestId) {
        return
      }

      setTranslatedText("")
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      if (requestRef.current === requestId) {
        setIsTranslating(false)
      }
    }
  }, [
    currentRequestKey,
    preferences,
    sourceLanguageId,
    sourceText,
    targetLanguageId,
    trimmedSourceText
  ])

  const setSourceText = useCallback((value: string): void => {
    requestRef.current += 1
    setSourceTextState(value)
    setError(null)
    setIsTranslating(false)
  }, [])

  const setSourceLanguageId = useCallback((languageId: string): void => {
    requestRef.current += 1
    setSourceLanguageIdState(languageId)
    setError(null)
    setIsTranslating(false)
  }, [])

  const setTargetLanguageId = useCallback((languageId: string): void => {
    requestRef.current += 1
    setTargetLanguageIdState(languageId)
    setError(null)
    setIsTranslating(false)
  }, [])

  const swapLanguages = useCallback((): void => {
    const detectedSourceLanguageId = detectTranslateLanguageId(translatedText || sourceText)
    const nextSourceLanguageId = targetLanguageId
    const nextTargetLanguageId =
      sourceLanguageId === "auto" ? detectedSourceLanguageId : sourceLanguageId

    requestRef.current += 1
    setSourceLanguageIdState(nextSourceLanguageId)
    setTargetLanguageIdState(nextTargetLanguageId)
    setError(null)
    setIsTranslating(false)

    if (translatedText.trim()) {
      setSourceTextState(translatedText)
    }
  }, [sourceLanguageId, sourceText, targetLanguageId, translatedText])

  const copyTranslatedText = useCallback(async (): Promise<void> => {
    if (!translatedText.trim()) {
      return
    }

    await navigator.clipboard.writeText(translatedText)
    setCopied(true)

    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current)
    }

    copyResetTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copyResetTimerRef.current = null
    }, 1200)
  }, [translatedText])

  return {
    canSubmit,
    copied,
    copyTranslatedText,
    error,
    isDirty,
    isTranslating,
    languageOptions: TRANSLATE_LANGUAGE_OPTIONS,
    setSourceLanguageId,
    setSourceText,
    setTargetLanguageId,
    sourceLanguageId,
    sourceText,
    submitTranslation,
    swapLanguages,
    targetLanguageId,
    translatedText
  }
}
