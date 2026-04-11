import { create } from "zustand"
import type { Thread, ModelConfig, Provider } from "@/types"

interface HistoryShellState {
  threads: Thread[]
  currentThreadId: string | null
  models: ModelConfig[]
  providers: Provider[]
  rightPanelTab: "todos" | "files" | "subagents"
  sidebarCollapsed: boolean
  showKanbanView: boolean
  showSubagentsInKanban: boolean
  loadThreads: () => Promise<void>
  createThread: (metadata?: Record<string, unknown>) => Promise<Thread>
  selectThread: (threadId: string) => Promise<void>
  deleteThread: (threadId: string) => Promise<void>
  updateThread: (threadId: string, updates: Partial<Thread>) => Promise<void>
  generateTitleForFirstMessage: (threadId: string, content: string) => Promise<void>
  loadModels: () => Promise<void>
  loadProviders: () => Promise<void>
  setApiKey: (providerId: string, apiKey: string) => Promise<void>
  deleteApiKey: (providerId: string) => Promise<void>
  setRightPanelTab: (tab: "todos" | "files" | "subagents") => void
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

  loadModels: async () => {
    const models = await window.api.models.list()
    set({ models })
  },

  loadProviders: async () => {
    const providers = await window.api.models.listProviders()
    set({ providers })
  },

  setApiKey: async (providerId: string, apiKey: string) => {
    console.log("[Store] setApiKey called:", { providerId, keyLength: apiKey.length })
    try {
      await window.api.models.setApiKey(providerId, apiKey)
      console.log("[Store] API key saved via IPC")
      await get().loadProviders()
      await get().loadModels()
      console.log("[Store] Providers and models reloaded")
    } catch (error) {
      console.error("[Store] Failed to set API key:", error)
      throw error
    }
  },

  deleteApiKey: async (providerId: string) => {
    await window.api.models.deleteApiKey(providerId)
    await get().loadProviders()
    await get().loadModels()
  },

  setRightPanelTab: (tab: "todos" | "files" | "subagents") => {
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
