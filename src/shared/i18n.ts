export const SUPPORTED_APP_LOCALES = ["zh-CN", "en-US"] as const

export type AppLocale = (typeof SUPPORTED_APP_LOCALES)[number]

export const DEFAULT_APP_LOCALE: AppLocale = "zh-CN"

const THREAD_TITLE_DATE_FORMATTERS: Record<AppLocale, Intl.DateTimeFormat> = {
  "en-US": new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "numeric",
    year: "numeric"
  }),
  "zh-CN": new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    month: "numeric",
    year: "numeric"
  })
}

export interface LocalizedText {
  en_US: string
  zh_Hans: string
}

export type LocalizedTextValue = string | LocalizedText

export function defineLocalizedText(en_US: string, zh_Hans: string): LocalizedText {
  return { en_US, zh_Hans }
}

export function resolveLocalizedText(
  text: LocalizedTextValue | null | undefined,
  locale: AppLocale,
  fallback = ""
): string {
  if (!text) {
    return fallback
  }

  if (typeof text === "string") {
    return text
  }

  const localized = locale === "zh-CN" ? text.zh_Hans : text.en_US
  if (localized.length > 0) {
    return localized
  }

  if (text.en_US.length > 0) {
    return text.en_US
  }

  if (text.zh_Hans.length > 0) {
    return text.zh_Hans
  }

  return fallback
}

export function normalizeAppLocale(value: unknown): AppLocale {
  if (typeof value !== "string") {
    return DEFAULT_APP_LOCALE
  }

  const normalized = value.toLowerCase()

  if (normalized.startsWith("zh")) {
    return "zh-CN"
  }

  if (normalized.startsWith("en")) {
    return "en-US"
  }

  return DEFAULT_APP_LOCALE
}

export function formatDefaultThreadTitle(locale: AppLocale, date: Date = new Date()): string {
  const dateLabel = THREAD_TITLE_DATE_FORMATTERS[locale].format(date)

  if (locale === "zh-CN") {
    return `对话 ${dateLabel}`
  }

  return `Thread ${dateLabel}`
}

export function isDefaultThreadTitle(title: string | null | undefined): boolean {
  if (!title) {
    return false
  }

  return /^(?:Thread|对话) \d{1,4}\D+\d{1,2}\D+\d{1,4}$/.test(title)
}
