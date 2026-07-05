import type {
  AcceptJingleMemorySuggestionInput,
  CreateJingleMemoryInput,
  CreateJingleMemorySuggestionInput,
  ListJingleMemoriesInput,
  ListJingleSuggestionsInput,
  JingleContextSourceRecord,
  JingleMemoryInclusionRecord,
  JingleMemoryRecord,
  JingleMemorySettings,
  JingleMemorySuggestionRecord,
  JingleWorkspaceIdentity,
  PendingWorkspaceMemoryGuard,
  UpdateJingleMemoryInput
} from "@shared/jingle-memory"
import { invokeIpc } from "../ipc"

export const memoryApi = {
  getSettings: (): Promise<JingleMemorySettings> => {
    return invokeIpc("memory:getSettings")
  },
  getCurrentWorkspaceIdentity: (): Promise<JingleWorkspaceIdentity | null> => {
    return invokeIpc("memory:getCurrentWorkspaceIdentity")
  },
  setSettings: (updates: Partial<JingleMemorySettings>): Promise<JingleMemorySettings> => {
    return invokeIpc("memory:setSettings", updates)
  },
  listMemories: (input?: ListJingleMemoriesInput): Promise<JingleMemoryRecord[]> => {
    return invokeIpc("memory:listMemories", input)
  },
  listSuggestions: (
    input?: ListJingleSuggestionsInput
  ): Promise<JingleMemorySuggestionRecord[]> => {
    return invokeIpc("memory:listSuggestions", input)
  },
  createSuggestion: (
    input: CreateJingleMemorySuggestionInput
  ): Promise<JingleMemorySuggestionRecord> => {
    return invokeIpc("memory:createSuggestion", input)
  },
  createMemory: (input: CreateJingleMemoryInput): Promise<JingleMemoryRecord> => {
    return invokeIpc("memory:createMemory", input)
  },
  acceptSuggestion: (
    suggestionId: string,
    input?: AcceptJingleMemorySuggestionInput
  ): Promise<JingleMemoryRecord> => {
    return invokeIpc("memory:acceptSuggestion", suggestionId, input)
  },
  rejectSuggestion: (suggestionId: string): Promise<JingleMemorySuggestionRecord> => {
    return invokeIpc("memory:rejectSuggestion", suggestionId)
  },
  updateMemory: (
    memoryId: string,
    input: UpdateJingleMemoryInput
  ): Promise<JingleMemoryRecord> => {
    return invokeIpc("memory:updateMemory", memoryId, input)
  },
  archiveMemory: (memoryId: string): Promise<JingleMemoryRecord> => {
    return invokeIpc("memory:archiveMemory", memoryId)
  },
  deleteMemory: (memoryId: string): Promise<void> => {
    return invokeIpc("memory:deleteMemory", memoryId)
  },
  listIncludedMemoriesForRun: (runId: string): Promise<JingleMemoryInclusionRecord[]> => {
    return invokeIpc("memory:listIncludedMemoriesForRun", runId)
  },
  getPendingWorkspaceMemoryGuard: (threadId: string): Promise<PendingWorkspaceMemoryGuard> => {
    return invokeIpc("memory:getPendingWorkspaceMemoryGuard", threadId)
  },
  listContextSources: (): Promise<JingleContextSourceRecord[]> => {
    return invokeIpc("memory:listContextSources")
  }
}
