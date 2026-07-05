import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { DEFAULT_APP_LOCALE, normalizeAppLocale, type AppLocale } from "@shared/i18n"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const DATE_TIME_FORMATTERS: Record<AppLocale, Intl.DateTimeFormat> = {
  "en-US": new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  }),
  "zh-CN": new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  })
}

const DATE_ONLY_FORMATTERS: Record<AppLocale, Intl.DateTimeFormat> = {
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

const TIME_FORMATTERS: Record<AppLocale, Intl.DateTimeFormat> = {
  "en-US": new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit"
  }),
  "zh-CN": new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  })
}

const NUMBER_FORMATTERS: Record<AppLocale, Intl.NumberFormat> = {
  "en-US": new Intl.NumberFormat("en-US"),
  "zh-CN": new Intl.NumberFormat("zh-CN")
}

const COMPACT_NUMBER_FORMATTERS: Record<
  "compact-0" | "compact-1",
  Record<AppLocale, Intl.NumberFormat>
> = {
  "compact-0": {
    "en-US": new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
      notation: "compact"
    }),
    "zh-CN": new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: 0,
      notation: "compact"
    })
  },
  "compact-1": {
    "en-US": new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 1,
      notation: "compact"
    }),
    "zh-CN": new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: 1,
      notation: "compact"
    })
  }
}

const RELATIVE_TIME_FORMATTERS: Record<AppLocale, Intl.RelativeTimeFormat> = {
  "en-US": new Intl.RelativeTimeFormat("en-US", { numeric: "auto" }),
  "zh-CN": new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" })
}

export function formatDate(date: Date | string, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  const d = typeof date === "string" ? new Date(date) : date
  return DATE_TIME_FORMATTERS[normalizeAppLocale(locale)].format(d)
}

export function formatDateOnly(
  date: Date | string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): string {
  const d = typeof date === "string" ? new Date(date) : date
  return DATE_ONLY_FORMATTERS[normalizeAppLocale(locale)].format(d)
}

export function formatTime(date: Date | string, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  const d = typeof date === "string" ? new Date(date) : date
  return TIME_FORMATTERS[normalizeAppLocale(locale)].format(d)
}

export function formatNumber(value: number, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  return NUMBER_FORMATTERS[normalizeAppLocale(locale)].format(value)
}

export function formatCompactNumber(value: number, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  const key = value >= 1_000_000 ? "compact-1" : "compact-0"
  return COMPACT_NUMBER_FORMATTERS[key][normalizeAppLocale(locale)].format(value)
}

export function formatRelativeTime(
  date: Date | string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): string {
  const d = typeof date === "string" ? new Date(date) : date
  const now = new Date()
  const resolvedLocale = normalizeAppLocale(locale)
  const diffMs = d.getTime() - now.getTime()
  const diffSeconds = Math.round(diffMs / 1000)
  const absSeconds = Math.abs(diffSeconds)

  if (absSeconds < 60) {
    return resolvedLocale === "zh-CN" ? "刚刚" : "just now"
  }

  const formatter = RELATIVE_TIME_FORMATTERS[resolvedLocale]

  if (absSeconds < 3600) {
    return formatter.format(Math.round(diffSeconds / 60), "minute")
  }

  if (absSeconds < 86_400) {
    return formatter.format(Math.round(diffSeconds / 3600), "hour")
  }

  if (absSeconds < 604_800) {
    return formatter.format(Math.round(diffSeconds / 86_400), "day")
  }

  return formatDate(d, resolvedLocale)
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + "..."
}

export function truncateMiddle(str: string, startLength: number, endLength: number): string {
  if (str.length <= startLength + endLength + 3) {
    return str
  }

  return `${str.slice(0, startLength)}...${str.slice(str.length - endLength)}`
}

export function generateId(): string {
  return crypto.randomUUID()
}
