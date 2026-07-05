import type { IpcMain } from "electron"
import { registerValidatedIpcHandle } from "../ipc/handle"
import { JingleMemoryService } from "./service"
import {
  acceptSuggestionArgsSchema,
  createMemoryArgsSchema,
  createSuggestionArgsSchema,
  getCurrentWorkspaceIdentityArgsSchema,
  getSettingsArgsSchema,
  listContextSourcesArgsSchema,
  listMemoriesArgsSchema,
  listSuggestionsArgsSchema,
  memoryIdArgsSchema,
  runIdArgsSchema,
  setSettingsArgsSchema,
  threadIdArgsSchema,
  updateMemoryArgsSchema
} from "./controller-schema"

export class JingleMemoryController {
  constructor(private readonly service: JingleMemoryService) {}

  register(ipcMain: IpcMain): void {
    registerValidatedIpcHandle(ipcMain, "memory:getSettings", getSettingsArgsSchema, async () => {
      return this.service.getSettings()
    })

    registerValidatedIpcHandle(
      ipcMain,
      "memory:getCurrentWorkspaceIdentity",
      getCurrentWorkspaceIdentityArgsSchema,
      () => {
        return this.service.getCurrentWorkspaceIdentity()
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:setSettings",
      setSettingsArgsSchema,
      (_event, updates = {}) => {
        return this.service.setSettings(updates)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:listMemories",
      listMemoriesArgsSchema,
      (_event, ...args) => {
        const [params] = args
        return this.service.listMemories(params ?? {})
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:listSuggestions",
      listSuggestionsArgsSchema,
      (_event, ...args) => {
        const [params] = args
        return this.service.listSuggestions(params ?? {})
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:createMemory",
      createMemoryArgsSchema,
      (_event, input) => {
        return this.service.createMemory(input)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:createSuggestion",
      createSuggestionArgsSchema,
      (_event, input) => {
        return this.service.createSuggestion(input)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:acceptSuggestion",
      acceptSuggestionArgsSchema,
      (_event, suggestionId, input = {}) => {
        return this.service.acceptSuggestion(suggestionId, input)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:rejectSuggestion",
      memoryIdArgsSchema,
      (_event, suggestionId) => {
        return this.service.rejectSuggestion(suggestionId)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:updateMemory",
      updateMemoryArgsSchema,
      (_event, memoryId, input) => {
        return this.service.updateMemory(memoryId, input)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:archiveMemory",
      memoryIdArgsSchema,
      (_event, memoryId) => {
        return this.service.archiveMemory(memoryId)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:deleteMemory",
      memoryIdArgsSchema,
      async (_event, memoryId) => {
        await this.service.deleteMemory(memoryId)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:listIncludedMemoriesForRun",
      runIdArgsSchema,
      (_event, runId) => {
        return this.service.listIncludedMemoriesForRun(runId)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:getPendingWorkspaceMemoryGuard",
      threadIdArgsSchema,
      async (_event, threadId) => {
        return {
          hasPendingWorkspaceSuggestions:
            await this.service.hasPendingWorkspaceSuggestions(threadId)
        }
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "memory:listContextSources",
      listContextSourcesArgsSchema,
      () => {
        return this.service.listContextSources()
      }
    )
  }
}
