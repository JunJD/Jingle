import type { LauncherResultKind } from "./launcher"
import type { LauncherSearchAction } from "./launcher-search"

export interface LauncherHistoryItem {
  id: string
  dedupeKey: string
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
  dedupeKey: string
  kind: LauncherResultKind
  title: string
  subtitle: string
  iconDataUrl?: string
  action: LauncherSearchAction
}

export function getLauncherHistoryDedupeKeyForAction(action: LauncherSearchAction): string | null {
  switch (action.type) {
    case "launch-application":
      return `application:${action.applicationPath}`
    case "open-local-start-item":
      return `local-start:${action.itemId}`
    case "none":
      return null
    default: {
      const exhaustiveAction: never = action
      throw new Error(
        `Unsupported launcher history dedupe action: ${JSON.stringify(exhaustiveAction)}`
      )
    }
  }
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
