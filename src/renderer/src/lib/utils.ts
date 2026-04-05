import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { DEFAULT_APP_LOCALE, normalizeAppLocale, type AppLocale } from "../../../shared/i18n"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  const d = typeof date === "string" ? new Date(date) : date
  return new Intl.DateTimeFormat(normalizeAppLocale(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d)
}

export function formatDateOnly(
  date: Date | string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): string {
  const d = typeof date === "string" ? new Date(date) : date
  return new Intl.DateTimeFormat(normalizeAppLocale(locale), {
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).format(d)
}

export function formatTime(date: Date | string, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  const d = typeof date === "string" ? new Date(date) : date
  return new Intl.DateTimeFormat(normalizeAppLocale(locale), {
    hour: "2-digit",
    minute: "2-digit"
  }).format(d)
}

export function formatNumber(value: number, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  return new Intl.NumberFormat(normalizeAppLocale(locale)).format(value)
}

export function formatCompactNumber(value: number, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  return new Intl.NumberFormat(normalizeAppLocale(locale), {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0
  }).format(value)
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

  const formatter = new Intl.RelativeTimeFormat(resolvedLocale, { numeric: "auto" })

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
