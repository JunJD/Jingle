import type { LauncherResultKind } from "./launcher"
import type { LauncherSearchAction } from "./launcher-search"

export type LauncherHistoryKeyInput =
  | {
      path: string
      type: "application"
    }
  | {
      path: string
      type: "file"
    }
  | {
      path: string
      type: "directory"
    }
  | {
      itemId: string
      type: "local-start"
    }
  | {
      browser: string
      type: "browser-history"
      url: string
    }

export function createLauncherHistoryKey(input: LauncherHistoryKeyInput): string {
  switch (input.type) {
    case "application":
      return `application:${input.path}`
    case "file":
      return `file:${input.path}`
    case "directory":
      return `directory:${input.path}`
    case "local-start":
      return `local-start:${input.itemId}`
    case "browser-history":
      return `browser-history:${input.browser}:${input.url}`
    default: {
      const exhaustiveInput: never = input
      throw new Error(`Unsupported launcher history key input: ${JSON.stringify(exhaustiveInput)}`)
    }
  }
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
