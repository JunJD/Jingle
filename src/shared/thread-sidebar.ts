import type { ThreadWorkspaceKind } from "./thread-workspace"

export const THREAD_PINNED_METADATA_KEY = "pinned"

export function isThreadPinned(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.[THREAD_PINNED_METADATA_KEY] === true
}

export type ThreadSidebarOrganizeMode = "project" | "chronological"
export type ThreadSidebarSortBy = "manual" | "updated" | "created"

export interface ThreadSidebarPreferences {
  manualThreadOrder: string[]
  organizeMode: ThreadSidebarOrganizeMode
  projectOrder: string[]
  sortBy: ThreadSidebarSortBy
}

export interface ThreadSidebarThreadItem {
  createdAt: Date
  isPinned: boolean
  projectId: string | null
  threadId: string
  title: string
  updatedAt: Date
  workspaceKind: ThreadWorkspaceKind
  workspacePath: string | null
}

export interface ThreadSidebarProjectGroup {
  projectId: string
  threads: ThreadSidebarThreadItem[]
  title: string
  updatedAt: Date
  workspacePath: string
}

export interface ThreadSidebarView {
  chatThreads: ThreadSidebarThreadItem[]
  pinnedThreads: ThreadSidebarThreadItem[]
  preferences: ThreadSidebarPreferences
  projectGroups: ThreadSidebarProjectGroup[]
}

export const DEFAULT_THREAD_SIDEBAR_PREFERENCES: ThreadSidebarPreferences = {
  manualThreadOrder: [],
  organizeMode: "project",
  projectOrder: [],
  sortBy: "updated"
}
