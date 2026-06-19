import {
  DEFAULT_THREAD_SIDEBAR_PREFERENCES,
  type ThreadSidebarPreferences
} from "@shared/thread-sidebar"
import Store from "electron-store"
import { getOpenworkDir } from "../storage"

interface ThreadSidebarStoreShape {
  preferences: ThreadSidebarPreferences
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === "string")
}

function normalizeOrganizeMode(value: unknown): ThreadSidebarPreferences["organizeMode"] {
  if (value === "chronological") {
    return "chronological"
  }

  return "project"
}

function normalizeSortBy(value: unknown): ThreadSidebarPreferences["sortBy"] {
  if (value === "manual" || value === "created" || value === "updated") {
    return value
  }

  return "updated"
}

function normalizePreferences(value: unknown): ThreadSidebarPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_THREAD_SIDEBAR_PREFERENCES
  }

  const record = value as Partial<ThreadSidebarPreferences>

  return {
    manualThreadOrder: normalizeStringList(record.manualThreadOrder),
    organizeMode: normalizeOrganizeMode(record.organizeMode),
    projectOrder: normalizeStringList(record.projectOrder),
    sortBy: normalizeSortBy(record.sortBy)
  }
}

export class ThreadSidebarRepository {
  private readonly store = new Store<ThreadSidebarStoreShape>({
    cwd: getOpenworkDir(),
    defaults: {
      preferences: DEFAULT_THREAD_SIDEBAR_PREFERENCES
    },
    name: "thread-sidebar"
  })

  getPreferences(): ThreadSidebarPreferences {
    return normalizePreferences(this.store.get("preferences"))
  }

  setPreferences(preferences: ThreadSidebarPreferences): ThreadSidebarPreferences {
    const normalized = normalizePreferences(preferences)
    this.store.set("preferences", normalized)
    return normalized
  }
}
