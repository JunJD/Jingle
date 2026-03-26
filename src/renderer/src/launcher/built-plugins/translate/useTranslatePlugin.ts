import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { TranslateTextResponse } from "../../../../../shared/built-plugins/translate"
import { DEFAULT_TRANSLATE_MODEL_ID } from "../../../../../shared/built-plugins/translate"
import { useI18n } from "@/lib/i18n"
import { useBuiltLauncherPluginHost } from "../sdk"
import { translateBuiltPluginClient } from "./api"
import {
  TRANSLATE_LANGUAGE_OPTIONS,
  detectTranslateLanguageId,
  getTranslateLanguageOption,
  parseTranslateSeedQuery
} from "./languages"

export function useTranslatePlugin(): {
  canSubmit: boolean
  copied: boolean
  error: string | null
  isDirty: boolean
  isTranslating: boolean
  modelId: string
  setSourceLanguageId: (languageId: string) => void
  setSourceText: (value: string) => void
  setTargetLanguageId: (languageId: string) => void
  sourceLanguageId: string
  sourceText: string
  submitTranslation: () => Promise<void>
  swapLanguages: () => void
  targetLanguageId: string
  translatedText: string
  copyTranslatedText: () => Promise<void>
  languageOptions: typeof TRANSLATE_LANGUAGE_OPTIONS
} {
  const { locale } = useI18n()
  const host = useBuiltLauncherPluginHost()
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
  const [lastResponse, setLastResponse] = useState<TranslateTextResponse | null>(null)
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
    setLastResponse(null)
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
      setLastResponse(null)
      setLastCompletedRequestKey(currentRequestKey)
      setIsTranslating(false)
      return
    }

    setIsTranslating(true)

    try {
      const response = await translateBuiltPluginClient.translate({
        backend: {
          kind: "llm"
        },
        sourceLanguage: sourceLanguage.promptLabel,
        targetLanguage: targetLanguage.promptLabel,
        text: sourceText
      })
      if (requestRef.current !== requestId) {
        return
      }

      setLastResponse(response)
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
  }, [currentRequestKey, sourceLanguageId, sourceText, targetLanguageId, trimmedSourceText])

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
    const nextSourceLanguageId = sourceLanguageId === "auto" ? targetLanguageId : targetLanguageId
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

  const modelId = useMemo(() => {
    return lastResponse?.modelId ?? DEFAULT_TRANSLATE_MODEL_ID
  }, [lastResponse])

  return {
    canSubmit,
    copied,
    copyTranslatedText,
    error,
    isDirty,
    isTranslating,
    languageOptions: TRANSLATE_LANGUAGE_OPTIONS,
    modelId,
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
