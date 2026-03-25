import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import {
  DEFAULT_APP_LOCALE,
  normalizeAppLocale,
  type AppLocale
} from "../../../../shared/i18n"
import { appCopy, type AppCopy } from "./messages"

interface I18nContextValue {
  copy: AppCopy
  locale: AppLocale
  setLocale: (locale: AppLocale) => Promise<void>
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider(props: {
  children: React.ReactNode
  initialLocale?: AppLocale
}): React.JSX.Element {
  const { children, initialLocale = DEFAULT_APP_LOCALE } = props
  const [locale, setLocaleState] = useState<AppLocale>(normalizeAppLocale(initialLocale))

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dataset.locale = locale
    document.body.dataset.locale = locale
  }, [locale])

  const setLocale = useCallback(async (nextLocale: AppLocale): Promise<void> => {
    const normalizedLocale = normalizeAppLocale(nextLocale)
    const nextConfig = await window.api.settings.setAgentConfig({ locale: normalizedLocale })
    setLocaleState(normalizeAppLocale(nextConfig.locale))
  }, [])

  const value = useMemo<I18nContextValue>(() => {
    return {
      copy: appCopy[locale],
      locale,
      setLocale
    }
  }, [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)

  if (!context) {
    throw new Error("useI18n must be used within I18nProvider")
  }

  return context
}
