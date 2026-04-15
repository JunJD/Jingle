import { create } from "zustand"
import type { Thread, ModelConfig, Provider, ProviderId } from "@/types"

interface HistoryShellState {
  threads: Thread[]
  currentThreadId: string | null
  models: ModelConfig[]
  providers: Provider[]
  rightPanelTab: "todos" | "artifacts" | "subagents"
  sidebarCollapsed: boolean
  showKanbanView: boolean
  showSubagentsInKanban: boolean
  loadThreads: () => Promise<void>
  createThread: (metadata?: Record<string, unknown>) => Promise<Thread>
  selectThread: (threadId: string) => Promise<void>
  deleteThread: (threadId: string) => Promise<void>
  updateThread: (threadId: string, updates: Partial<Thread>) => Promise<void>
  generateTitleForFirstMessage: (threadId: string, content: string) => Promise<void>
  loadModelProviderState: () => Promise<void>
  setProviderCredentials: (
    providerId: ProviderId,
    credentials: Record<string, string>
  ) => Promise<void>
  deleteProviderCredentials: (providerId: ProviderId) => Promise<void>
  setRightPanelTab: (tab: "todos" | "artifacts" | "subagents") => void
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setShowKanbanView: (show: boolean) => void
  setShowSubagentsInKanban: (show: boolean) => void
}

export const useHistoryShellStore = create<HistoryShellState>((set, get) => ({
  threads: [],
  currentThreadId: null,
  models: [],
  providers: [],
  rightPanelTab: "todos",
  sidebarCollapsed: false,
  showKanbanView: false,
  showSubagentsInKanban: true,

  loadThreads: async () => {
    const threads = await window.api.threads.list()
    set({ threads })
  },

  createThread: async (metadata?: Record<string, unknown>) => {
    const thread = await window.api.threads.create(metadata)
    set((state) => ({
      threads: [thread, ...state.threads],
      currentThreadId: thread.thread_id,
      showKanbanView: false
    }))
    return thread
  },

  selectThread: async (threadId: string) => {
    set({ currentThreadId: threadId, showKanbanView: false })
  },

  deleteThread: async (threadId: string) => {
    console.log("[Store] Deleting thread:", threadId)
    try {
      await window.api.threads.delete(threadId)
      console.log("[Store] Thread deleted from backend")

      set((state) => {
        const threads = state.threads.filter((thread) => thread.thread_id !== threadId)
        const wasCurrentThread = state.currentThreadId === threadId
        const newCurrentId = wasCurrentThread
          ? threads[0]?.thread_id || null
          : state.currentThreadId

        return {
          threads,
          currentThreadId: newCurrentId
        }
      })
    } catch (error) {
      console.error("[Store] Failed to delete thread:", error)
    }
  },

  updateThread: async (threadId: string, updates: Partial<Thread>) => {
    const updated = await window.api.threads.update(threadId, updates)
    set((state) => ({
      threads: state.threads.map((thread) => (thread.thread_id === threadId ? updated : thread))
    }))
  },

  generateTitleForFirstMessage: async (threadId: string, content: string) => {
    try {
      const generatedTitle = await window.api.threads.generateTitle(content)
      await get().updateThread(threadId, { title: generatedTitle })
    } catch (error) {
      console.error("[Store] Failed to generate title:", error)
    }
  },

  loadModelProviderState: async () => {
    const [providerState, models] = await Promise.all([
      window.api.models.getState(),
      window.api.models.list("llm")
    ])
    set({ models, providers: providerState.providers })
  },

  setProviderCredentials: async (providerId: ProviderId, credentials: Record<string, string>) => {
    await window.api.models.setCredentials(providerId, credentials)
    await get().loadModelProviderState()
  },

  deleteProviderCredentials: async (providerId: ProviderId) => {
    await window.api.models.deleteCredentials(providerId)
    await get().loadModelProviderState()
  },

  setRightPanelTab: (tab: "todos" | "artifacts" | "subagents") => {
    set({ rightPanelTab: tab })
  },

  toggleSidebar: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
  },

  setSidebarCollapsed: (collapsed: boolean) => {
    set({ sidebarCollapsed: collapsed })
  },

  setShowKanbanView: (show: boolean) => {
    if (show) {
      set({ showKanbanView: true, currentThreadId: null })
      return
    }

    set({ showKanbanView: false })
  },

  setShowSubagentsInKanban: (show: boolean) => {
    set({ showSubagentsInKanban: show })
  }
}))
