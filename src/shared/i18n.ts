export const SUPPORTED_APP_LOCALES = ["zh-CN", "en-US"] as const

export type AppLocale = (typeof SUPPORTED_APP_LOCALES)[number]

export const DEFAULT_APP_LOCALE: AppLocale = "zh-CN"

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

export function formatDefaultThreadTitle(
  locale: AppLocale,
  date: Date = new Date()
): string {
  const dateLabel = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).format(date)

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
