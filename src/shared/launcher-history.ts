import type { LauncherResultKind } from "./launcher"
import type { LauncherSearchAction } from "./launcher-search"

export function createLauncherApplicationHistoryKey(applicationPath: string): string {
  return `application:${applicationPath}`
}

export function createLauncherLocalStartHistoryKey(itemId: string): string {
  return `local-start:${itemId}`
}

export function createLauncherBrowserHistoryKey(browser: string, url: string): string {
  return `browser-history:${browser}:${url}`
}

export interface LauncherHistoryItem {
  id: string
  historyKey: string
  kind: LauncherResultKind
  title: string
  subtitle: string
  iconDataUrl?: string
  action: LauncherSearchAction
  pin: boolean
  useCount: number
  createdAt: string
  updatedAt: string
  lastUsedAt: string
}

export interface RecordLauncherHistoryItemInput {
  historyKey: string
  kind: LauncherResultKind
  title: string
  subtitle: string
  iconDataUrl?: string
  action: LauncherSearchAction
}

export function sortLauncherHistoryItems(items: LauncherHistoryItem[]): LauncherHistoryItem[] {
  return [...items].sort((left, right) => {
    if (left.pin !== right.pin) {
      return left.pin ? -1 : 1
    }

    if (left.lastUsedAt !== right.lastUsedAt) {
      return right.lastUsedAt.localeCompare(left.lastUsedAt)
    }

    if (left.useCount !== right.useCount) {
      return right.useCount - left.useCount
    }

    return right.updatedAt.localeCompare(left.updatedAt)
  })
}
