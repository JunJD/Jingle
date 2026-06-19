import type { OpenworkAPI } from "../../../preload/api"
import type { ModelConfig, Provider, ProviderId, Thread } from "@shared/app-types"
import type {
  ThreadSidebarOrganizeMode,
  ThreadSidebarSortBy,
  ThreadSidebarView
} from "@shared/thread-sidebar"

export interface HistoryShellState {
  threads: Thread[]
  sidebarView: ThreadSidebarView | null
  currentThreadId: string | null
  models: ModelConfig[]
  providers: Provider[]
  addSidebarProject: () => Promise<void>
  loadSidebarView: () => Promise<void>
  loadThreads: () => Promise<void>
  refreshThread: (threadId: string) => Promise<void>
  setSidebarOrganizeMode: (mode: ThreadSidebarOrganizeMode) => Promise<void>
  setSidebarSortBy: (sortBy: ThreadSidebarSortBy) => Promise<void>
  setThreadPinned: (threadId: string, pinned: boolean) => Promise<void>
  updateThread: (threadId: string, updates: Partial<Thread>) => Promise<void>
  loadModelProviderState: () => Promise<void>
  setProviderCredentials: (
    providerId: ProviderId,
    credentials: Record<string, string>
  ) => Promise<void>
  deleteProviderCredentials: (providerId: ProviderId) => Promise<void>
}

export interface HistoryShellStore {
  getState: () => HistoryShellState
  subscribe: (listener: () => void) => () => void
}

export type HistoryShellApi = Pick<
  OpenworkAPI,
  "models" | "threadSidebar" | "threads" | "threadWorkspace" | "workspace"
>

interface HistoryShellData {
  threads: Thread[]
  sidebarView: ThreadSidebarView | null
  currentThreadId: string | null
  models: ModelConfig[]
  providers: Provider[]
}

const initialData: HistoryShellData = {
  threads: [],
  sidebarView: null,
  currentThreadId: null,
  models: [],
  providers: []
}

export function createHistoryShellStore(api: HistoryShellApi): HistoryShellStore {
  const listeners = new Set<() => void>()
  let data: HistoryShellData = { ...initialData }
  let snapshot: HistoryShellState

  const emit = (): void => {
    snapshot = {
      ...data,
      ...actions
    }
    listeners.forEach((listener) => listener())
  }

  const setData = (
    update: Partial<HistoryShellData> | ((current: HistoryShellData) => Partial<HistoryShellData>)
  ): void => {
    const nextPartial = typeof update === "function" ? update(data) : update
    let changed = false
    for (const key of Object.keys(nextPartial) as (keyof HistoryShellData)[]) {
      if (!Object.is(data[key], nextPartial[key])) {
        changed = true
        break
      }
    }

    if (!changed) {
      return
    }

    data = {
      ...data,
      ...nextPartial
    }
    emit()
  }

  const sortThreadsByRecency = (threads: Thread[]): Thread[] => {
    return [...threads].sort(
      (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
    )
  }

  const upsertThreadByRecency = (threads: Thread[], nextThread: Thread): Thread[] => {
    const nextThreads = threads.filter((thread) => thread.thread_id !== nextThread.thread_id)
    nextThreads.push(nextThread)
    return sortThreadsByRecency(nextThreads)
  }

  const actions = {
    addSidebarProject: async (): Promise<void> => {
      const workspacePath = await api.workspace.selectFolder()
      if (!workspacePath) {
        return
      }

      await api.threadWorkspace.addProject(workspacePath)
      const sidebarView = await api.threadSidebar.setOrganizeMode("project")
      setData({ sidebarView })
    },

    loadSidebarView: async (): Promise<void> => {
      const sidebarView = await api.threadSidebar.getView()
      setData({ sidebarView })
    },

    loadThreads: async (): Promise<void> => {
      const [threads, sidebarView] = await Promise.all([
        api.threads.list(),
        api.threadSidebar.getView()
      ])
      setData({ sidebarView, threads })
    },

    refreshThread: async (threadId: string): Promise<void> => {
      const thread = await api.threads.get(threadId)
      setData((current) => {
        if (!thread) {
          const nextThreads = current.threads.filter((entry) => entry.thread_id !== threadId)
          return {
            currentThreadId:
              current.currentThreadId === threadId
                ? (nextThreads[0]?.thread_id ?? null)
                : current.currentThreadId,
            threads: nextThreads
          }
        }

        return {
          threads: upsertThreadByRecency(current.threads, thread)
        }
      })
    },

    setSidebarOrganizeMode: async (mode: ThreadSidebarOrganizeMode): Promise<void> => {
      const sidebarView = await api.threadSidebar.setOrganizeMode(mode)
      setData({ sidebarView })
    },

    setSidebarSortBy: async (sortBy: ThreadSidebarSortBy): Promise<void> => {
      const sidebarView = await api.threadSidebar.setSortBy(sortBy)
      setData({ sidebarView })
    },

    setThreadPinned: async (threadId: string, pinned: boolean): Promise<void> => {
      const updated = await api.threads.setPinned(threadId, pinned)
      const sidebarView = await api.threadSidebar.getView()
      setData((current) => ({
        sidebarView,
        threads: current.threads.map((thread) =>
          thread.thread_id === updated.thread_id ? updated : thread
        )
      }))
    },

    updateThread: async (threadId: string, updates: Partial<Thread>): Promise<void> => {
      const updated = await api.threads.update(threadId, updates)
      const sidebarView = await api.threadSidebar.getView()
      setData((current) => ({
        sidebarView,
        threads: upsertThreadByRecency(current.threads, updated)
      }))
    },

    loadModelProviderState: async (): Promise<void> => {
      const [providerState, models] = await Promise.all([
        api.models.getState(),
        api.models.list("llm")
      ])
      setData({
        models,
        providers: providerState.providers
      })
    },

    setProviderCredentials: async (
      providerId: ProviderId,
      credentials: Record<string, string>
    ): Promise<void> => {
      await api.models.setCredentials(providerId, credentials)
      await actions.loadModelProviderState()
    },

    deleteProviderCredentials: async (providerId: ProviderId): Promise<void> => {
      await api.models.deleteCredentials(providerId)
      await actions.loadModelProviderState()
    }
  }

  snapshot = {
    ...data,
    ...actions
  }

  return {
    getState: (): HistoryShellState => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
