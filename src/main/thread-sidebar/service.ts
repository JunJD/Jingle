import {
  getActiveThreads,
  type ThreadRow
} from "../db/threads"
import {
  getProjects,
  getThreadWorkspaceBindings,
  mapProjectRecord,
  mapThreadWorkspaceBindingRecord
} from "../db/thread-workspace"
import {
  DEFAULT_THREAD_SIDEBAR_PREFERENCES,
  isThreadPinned,
  type ThreadSidebarOrganizeMode,
  type ThreadSidebarPreferences,
  type ThreadSidebarProjectGroup,
  type ThreadSidebarSortBy,
  type ThreadSidebarThreadItem,
  type ThreadSidebarView
} from "@shared/thread-sidebar"
import type { ProjectRecord, ThreadWorkspaceBindingRecord } from "@shared/thread-workspace"
import { ThreadSidebarRepository } from "./repository"

function resolveThreadWorkspaceKind(
  binding: ThreadWorkspaceBindingRecord | null
): ThreadSidebarThreadItem["workspaceKind"] {
  if (!binding) {
    return "projectless"
  }

  return binding.workspaceKind
}

function resolveThreadTitle(thread: ThreadRow): string {
  const title = thread.title?.trim()
  if (title && title.length > 0) {
    return title
  }

  return "New Chat"
}

function resolveProjectGroupTitle(
  binding: ThreadWorkspaceBindingRecord | undefined,
  workspacePath: string
): string {
  const displayName = binding?.project?.displayName?.trim()
  if (displayName && displayName.length > 0) {
    return displayName
  }

  return workspacePath
}

function parseThreadMetadata(thread: ThreadRow): Record<string, unknown> {
  if (!thread.metadata) {
    return {}
  }

  return JSON.parse(thread.metadata) as Record<string, unknown>
}

function resolveNullableProjectId(
  binding: ThreadWorkspaceBindingRecord | null
): string | null {
  if (!binding?.projectId) {
    return null
  }

  return binding.projectId
}

function resolveNullableWorkspacePath(
  binding: ThreadWorkspaceBindingRecord | null
): string | null {
  if (!binding?.workspacePath) {
    return null
  }

  return binding.workspacePath
}

function mapThreadItem(
  thread: ThreadRow,
  binding: ThreadWorkspaceBindingRecord | null
): ThreadSidebarThreadItem {
  const metadata = parseThreadMetadata(thread)

  return {
    createdAt: new Date(thread.created_at),
    isPinned: isThreadPinned(metadata),
    projectId: resolveNullableProjectId(binding),
    threadId: thread.thread_id,
    title: resolveThreadTitle(thread),
    updatedAt: new Date(thread.updated_at),
    workspaceKind: resolveThreadWorkspaceKind(binding),
    workspacePath: resolveNullableWorkspacePath(binding)
  }
}

function compareByDate(
  left: ThreadSidebarThreadItem,
  right: ThreadSidebarThreadItem,
  key: "createdAt" | "updatedAt"
): number {
  const dateDelta = right[key].getTime() - left[key].getTime()
  if (dateDelta !== 0) {
    return dateDelta
  }

  const titleDelta = left.title.localeCompare(right.title)
  if (titleDelta !== 0) {
    return titleDelta
  }

  return left.threadId.localeCompare(right.threadId)
}

function sortThreads(
  threads: ThreadSidebarThreadItem[],
  preferences: ThreadSidebarPreferences
): ThreadSidebarThreadItem[] {
  if (preferences.sortBy === "created") {
    return threads.toSorted((left, right) => compareByDate(left, right, "createdAt"))
  }

  if (preferences.sortBy === "manual") {
    const order = new Map(preferences.manualThreadOrder.map((threadId, index) => [threadId, index]))
    return threads.toSorted((left, right) => {
      const leftOrder = order.get(left.threadId)
      const rightOrder = order.get(right.threadId)
      if (leftOrder !== undefined && rightOrder !== undefined) {
        return leftOrder - rightOrder
      }
      if (leftOrder !== undefined) {
        return -1
      }
      if (rightOrder !== undefined) {
        return 1
      }
      return compareByDate(left, right, "updatedAt")
    })
  }

  return threads.toSorted((left, right) => compareByDate(left, right, "updatedAt"))
}

function sortProjectGroups(
  groups: ThreadSidebarProjectGroup[],
  preferences: ThreadSidebarPreferences
): ThreadSidebarProjectGroup[] {
  const order = new Map(preferences.projectOrder.map((projectId, index) => [projectId, index]))
  return groups.toSorted((left, right) => {
    const leftOrder = order.get(left.projectId)
    const rightOrder = order.get(right.projectId)
    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder
    }
    if (leftOrder !== undefined) {
      return -1
    }
    if (rightOrder !== undefined) {
      return 1
    }
    const updatedDelta = right.updatedAt.getTime() - left.updatedAt.getTime()
    if (updatedDelta !== 0) {
      return updatedDelta
    }

    return left.title.localeCompare(right.title)
  })
}

function mapProjectGroup(project: ProjectRecord): ThreadSidebarProjectGroup {
  return {
    projectId: project.projectId,
    threads: [],
    title: project.displayName,
    updatedAt: project.updatedAt,
    workspacePath: project.canonicalWorkspacePath
  }
}

export class ThreadSidebarService {
  constructor(private readonly repository: ThreadSidebarRepository) {}

  async getView(): Promise<ThreadSidebarView> {
    const preferences = this.repository.getPreferences()
    const threads = await getActiveThreads()
    const [projectRows, bindingRows] = await Promise.all([
      getProjects(),
      getThreadWorkspaceBindings(threads.map((thread) => thread.thread_id))
    ])
    const projects = projectRows.map(mapProjectRecord)
    const bindings = new Map(
      bindingRows.map((binding) => [
        binding.thread_id,
        mapThreadWorkspaceBindingRecord(binding)
      ])
    )
    const items = threads.map((thread) => {
      const binding = bindings.get(thread.thread_id)
      return mapThreadItem(thread, binding || null)
    })
    const pinnedThreads = sortThreads(
      items.filter((thread) => thread.isPinned),
      preferences
    )
    const unpinnedThreads = items.filter((thread) => !thread.isPinned)
    let chatThreadCandidates = unpinnedThreads
    if (preferences.organizeMode === "project") {
      chatThreadCandidates = unpinnedThreads.filter(
        (thread) =>
          thread.workspaceKind === "projectless" || !thread.projectId || !thread.workspacePath
      )
    }
    const chatThreads = sortThreads(chatThreadCandidates, preferences)
    const projectGroupsById = new Map<string, ThreadSidebarProjectGroup>()

    for (const project of projects) {
      projectGroupsById.set(project.projectId, mapProjectGroup(project))
    }

    for (const thread of sortThreads(
      unpinnedThreads.filter(
        (item) => item.workspaceKind === "project" && item.projectId && item.workspacePath
      ),
      preferences
    )) {
      const projectId = thread.projectId
      const workspacePath = thread.workspacePath
      if (!projectId || !workspacePath) {
        continue
      }

      const existing = projectGroupsById.get(projectId)
      if (existing) {
        existing.threads.push(thread)
        if (thread.updatedAt.getTime() > existing.updatedAt.getTime()) {
          existing.updatedAt = thread.updatedAt
        }
        continue
      }

      projectGroupsById.set(projectId, {
        projectId,
        threads: [thread],
        title: resolveProjectGroupTitle(bindings.get(thread.threadId), workspacePath),
        updatedAt: thread.updatedAt,
        workspacePath
      })
    }

    let projectGroups: ThreadSidebarProjectGroup[] = []
    if (preferences.organizeMode === "project") {
      projectGroups = sortProjectGroups(Array.from(projectGroupsById.values()), preferences)
    }

    return {
      chatThreads,
      pinnedThreads,
      preferences,
      projectGroups
    }
  }

  async reorderProjects(projectIds: string[]): Promise<ThreadSidebarView> {
    const current = this.repository.getPreferences()
    this.repository.setPreferences({
      ...current,
      projectOrder: projectIds
    })
    return this.getView()
  }

  async setOrganizeMode(mode: ThreadSidebarOrganizeMode): Promise<ThreadSidebarView> {
    const current = this.repository.getPreferences()
    this.repository.setPreferences({
      ...current,
      organizeMode: mode
    })
    return this.getView()
  }

  async setSortBy(sortBy: ThreadSidebarSortBy): Promise<ThreadSidebarView> {
    const current = this.repository.getPreferences()
    this.repository.setPreferences({
      ...current,
      sortBy
    })
    return this.getView()
  }

  resetPreferences(): ThreadSidebarPreferences {
    return this.repository.setPreferences(DEFAULT_THREAD_SIDEBAR_PREFERENCES)
  }
}
