import type { OpenworkAPI } from "../../../preload/api"
import type { ModelConfig, Provider, ProviderId, Thread } from "../../../shared/app-types"

export type HistoryRightPanelTab = "todos" | "artifacts" | "subagents"

export interface HistoryShellState {
  threads: Thread[]
  currentThreadId: string | null
  models: ModelConfig[]
  providers: Provider[]
  rightPanelTab: HistoryRightPanelTab
  sidebarCollapsed: boolean
  showKanbanView: boolean
  showSubagentsInKanban: boolean
  loadThreads: () => Promise<void>
  createThread: (metadata?: Record<string, unknown>) => Promise<Thread>
  selectThread: (threadId: string) => Promise<void>
  deleteThread: (threadId: string) => Promise<void>
  updateThread: (threadId: string, updates: Partial<Thread>) => Promise<void>
  loadModelProviderState: () => Promise<void>
  setProviderCredentials: (
    providerId: ProviderId,
    credentials: Record<string, string>
  ) => Promise<void>
  deleteProviderCredentials: (providerId: ProviderId) => Promise<void>
  setRightPanelTab: (tab: HistoryRightPanelTab) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setShowKanbanView: (show: boolean) => void
  setShowSubagentsInKanban: (show: boolean) => void
}

export interface HistoryShellStore {
  getState: () => HistoryShellState
  subscribe: (listener: () => void) => () => void
}

export type HistoryShellApi = Pick<OpenworkAPI, "models" | "threads">

interface HistoryShellData {
  threads: Thread[]
  currentThreadId: string | null
  models: ModelConfig[]
  providers: Provider[]
  rightPanelTab: HistoryRightPanelTab
  sidebarCollapsed: boolean
  showKanbanView: boolean
  showSubagentsInKanban: boolean
}

const initialData: HistoryShellData = {
  threads: [],
  currentThreadId: null,
  models: [],
  providers: [],
  rightPanelTab: "todos",
  sidebarCollapsed: false,
  showKanbanView: false,
  showSubagentsInKanban: true
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

  const actions = {
    loadThreads: async (): Promise<void> => {
      const threads = await api.threads.list()
      setData({ threads })
    },

    createThread: async (metadata?: Record<string, unknown>): Promise<Thread> => {
      const thread = await api.threads.create(metadata)
      setData((current) => ({
        threads: [thread, ...current.threads],
        currentThreadId: thread.thread_id,
        showKanbanView: false
      }))
      return thread
    },

    selectThread: async (threadId: string): Promise<void> => {
      setData({ currentThreadId: threadId, showKanbanView: false })
    },

    deleteThread: async (threadId: string): Promise<void> => {
      await api.threads.delete(threadId)
      setData((current) => {
        const threads = current.threads.filter((thread) => thread.thread_id !== threadId)
        const currentThreadId =
          current.currentThreadId === threadId
            ? (threads[0]?.thread_id ?? null)
            : current.currentThreadId

        return {
          threads,
          currentThreadId
        }
      })
    },

    updateThread: async (threadId: string, updates: Partial<Thread>): Promise<void> => {
      const updated = await api.threads.update(threadId, updates)
      setData((current) => ({
        threads: current.threads.map((thread) => (thread.thread_id === threadId ? updated : thread))
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
    },

    setRightPanelTab: (tab: HistoryRightPanelTab): void => {
      setData({ rightPanelTab: tab })
    },

    toggleSidebar: (): void => {
      setData((current) => ({ sidebarCollapsed: !current.sidebarCollapsed }))
    },

    setSidebarCollapsed: (collapsed: boolean): void => {
      setData({ sidebarCollapsed: collapsed })
    },

    setShowKanbanView: (show: boolean): void => {
      if (show) {
        setData({ showKanbanView: true, currentThreadId: null })
        return
      }

      setData({ showKanbanView: false })
    },

    setShowSubagentsInKanban: (show: boolean): void => {
      setData({ showSubagentsInKanban: show })
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
