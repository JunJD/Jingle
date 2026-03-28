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
