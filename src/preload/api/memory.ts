import type {
  AcceptOpenworkMemorySuggestionInput,
  CreateOpenworkMemoryInput,
  CreateOpenworkMemorySuggestionInput,
  ListOpenworkMemoriesInput,
  ListOpenworkSuggestionsInput,
  OpenworkContextSourceRecord,
  OpenworkMemoryInclusionRecord,
  OpenworkMemoryRecord,
  OpenworkMemorySettings,
  OpenworkMemorySuggestionRecord,
  OpenworkWorkspaceIdentity,
  PendingWorkspaceMemoryGuard,
  UpdateOpenworkMemoryInput
} from "@shared/openwork-memory"
import { invokeIpc } from "../ipc"

export const memoryApi = {
  getSettings: (): Promise<OpenworkMemorySettings> => {
    return invokeIpc("memory:getSettings")
  },
  getCurrentWorkspaceIdentity: (): Promise<OpenworkWorkspaceIdentity | null> => {
    return invokeIpc("memory:getCurrentWorkspaceIdentity")
  },
  setSettings: (updates: Partial<OpenworkMemorySettings>): Promise<OpenworkMemorySettings> => {
    return invokeIpc("memory:setSettings", updates)
  },
  listMemories: (input?: ListOpenworkMemoriesInput): Promise<OpenworkMemoryRecord[]> => {
    return invokeIpc("memory:listMemories", input)
  },
  listSuggestions: (
    input?: ListOpenworkSuggestionsInput
  ): Promise<OpenworkMemorySuggestionRecord[]> => {
    return invokeIpc("memory:listSuggestions", input)
  },
  createSuggestion: (
    input: CreateOpenworkMemorySuggestionInput
  ): Promise<OpenworkMemorySuggestionRecord> => {
    return invokeIpc("memory:createSuggestion", input)
  },
  createMemory: (input: CreateOpenworkMemoryInput): Promise<OpenworkMemoryRecord> => {
    return invokeIpc("memory:createMemory", input)
  },
  acceptSuggestion: (
    suggestionId: string,
    input?: AcceptOpenworkMemorySuggestionInput
  ): Promise<OpenworkMemoryRecord> => {
    return invokeIpc("memory:acceptSuggestion", suggestionId, input)
  },
  rejectSuggestion: (suggestionId: string): Promise<OpenworkMemorySuggestionRecord> => {
    return invokeIpc("memory:rejectSuggestion", suggestionId)
  },
  updateMemory: (
    memoryId: string,
    input: UpdateOpenworkMemoryInput
  ): Promise<OpenworkMemoryRecord> => {
    return invokeIpc("memory:updateMemory", memoryId, input)
  },
  archiveMemory: (memoryId: string): Promise<OpenworkMemoryRecord> => {
    return invokeIpc("memory:archiveMemory", memoryId)
  },
  deleteMemory: (memoryId: string): Promise<void> => {
    return invokeIpc("memory:deleteMemory", memoryId)
  },
  listIncludedMemoriesForRun: (runId: string): Promise<OpenworkMemoryInclusionRecord[]> => {
    return invokeIpc("memory:listIncludedMemoriesForRun", runId)
  },
  getPendingWorkspaceMemoryGuard: (threadId: string): Promise<PendingWorkspaceMemoryGuard> => {
    return invokeIpc("memory:getPendingWorkspaceMemoryGuard", threadId)
  },
  listContextSources: (): Promise<OpenworkContextSourceRecord[]> => {
    return invokeIpc("memory:listContextSources")
  }
}
