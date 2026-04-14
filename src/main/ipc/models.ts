import { IpcMain, dialog, app } from "electron"
import * as fs from "fs/promises"
import * as path from "path"
import type {
  AgentConfig,
  SetDefaultModelParams,
  SetProviderCredentialsParams,
  WorkspaceSetParams,
  WorkspaceFileParams
} from "../types"
import type { LauncherSettings } from "../../shared/launcher-settings"
import {
  getAgentConfig,
  getGlobalWorkspacePath,
  getLauncherSettings,
  getWorkspaceDialogPath,
  setAgentConfig,
  setGlobalWorkspacePath,
  setLauncherSettings,
  setWorkspaceDialogPath
} from "../preferences"
import {
  deleteProviderCredentialsForUI,
  getDefaultModelForUI,
  getModelProviderStateForUI,
  listModelsByProviderForUI,
  listModelsForUI,
  setDefaultModelForUI,
  setProviderCredentialsForUI
} from "../model-provider/service"
import { getModelConfig } from "../model-provider/catalog"

export async function resolveGlobalWorkspacePath(): Promise<string | null> {
  return getGlobalWorkspacePath()
}

export function registerModelHandlers(ipcMain: IpcMain): void {
  // List available models
  ipcMain.handle("models:list", async (_event, modelType: string = "llm") => {
    return listModelsForUI(modelType)
  })

  ipcMain.handle("models:listByProvider", async (_event, provider: string, modelType = "llm") => {
    return listModelsByProviderForUI(provider, modelType)
  })

  ipcMain.handle("models:getState", async () => {
    return getModelProviderStateForUI()
  })

  // Get default model
  ipcMain.handle("models:getDefault", async (_event, modelType: string) => {
    return getDefaultModelForUI(modelType)
  })

  // Set default model
  ipcMain.handle(
    "models:setDefault",
    async (_event, { modelType, modelId }: SetDefaultModelParams) => {
      await setDefaultModelForUI(modelType, modelId)
    }
  )

  ipcMain.handle("settings:getAgentConfig", async () => {
    return getAgentConfig()
  })

  ipcMain.handle("settings:setAgentConfig", async (_event, updates: Partial<AgentConfig>) => {
    return setAgentConfig(updates)
  })

  ipcMain.handle("settings:getLauncherSettings", async () => {
    return getLauncherSettings()
  })

  ipcMain.handle(
    "settings:setLauncherSettings",
    async (_event, updates: Partial<LauncherSettings>) => {
      return setLauncherSettings(updates)
    }
  )

  ipcMain.handle(
    "models:setCredentials",
    async (_event, { provider, credentials }: SetProviderCredentialsParams) => {
      await setProviderCredentialsForUI(provider, credentials)
    }
  )

  ipcMain.handle("models:deleteCredentials", async (_event, provider: string) => {
    deleteProviderCredentialsForUI(provider)
  })

  // Sync version info
  ipcMain.on("app:version", (event) => {
    event.returnValue = app.getVersion()
  })

  // Get workspace path for a thread (from thread metadata)
  ipcMain.handle("workspace:get", async (_event, threadId?: string) => {
    if (!threadId) {
      return resolveGlobalWorkspacePath()
    }

    // Get from thread metadata via threads:get
    const { getThread } = await import("../db")
    const thread = await getThread(threadId)
    if (!thread?.metadata) return null

    const metadata = JSON.parse(thread.metadata)
    return metadata.workspacePath || null
  })

  // Set workspace path for a thread (stores in thread metadata)
  ipcMain.handle(
    "workspace:set",
    async (_event, { threadId, path: newPath }: WorkspaceSetParams) => {
      if (!threadId) {
        setGlobalWorkspacePath(newPath)
        return resolveGlobalWorkspacePath()
      }

      const { getThread, updateThread } = await import("../db")
      const thread = await getThread(threadId)
      if (!thread) return null

      const metadata = thread.metadata ? JSON.parse(thread.metadata) : {}
      metadata.workspacePath = newPath
      await updateThread(threadId, { metadata: JSON.stringify(metadata) })

      if (newPath) {
        setGlobalWorkspacePath(newPath)
      }

      return newPath
    }
  )

  // Select workspace folder via dialog (for a specific thread)
  ipcMain.handle("workspace:select", async (_event, threadId?: string) => {
    const defaultPath =
      getWorkspaceDialogPath() ?? (await resolveGlobalWorkspacePath()) ?? undefined
    const result = await dialog.showOpenDialog({
      defaultPath,
      properties: ["openDirectory", "createDirectory"],
      title: "Select Workspace Folder",
      message: "Choose a folder for the agent to work in"
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const selectedPath = result.filePaths[0]
    setWorkspaceDialogPath(selectedPath)

    if (threadId) {
      const { getThread, updateThread } = await import("../db")
      const thread = await getThread(threadId)
      if (thread) {
        const metadata = thread.metadata ? JSON.parse(thread.metadata) : {}
        metadata.workspacePath = selectedPath
        await updateThread(threadId, { metadata: JSON.stringify(metadata) })
        setGlobalWorkspacePath(selectedPath)
      }
    } else {
      // Fallback to global
      setGlobalWorkspacePath(selectedPath)
    }

    return selectedPath
  })

  // Read a single file's contents from disk
  ipcMain.handle(
    "workspace:readFile",
    async (_event, { threadId, filePath }: WorkspaceFileParams) => {
      const { getThread } = await import("../db")

      // Get workspace path from thread metadata
      const thread = await getThread(threadId)
      const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
      const workspacePath = metadata.workspacePath as string | null

      if (!workspacePath) {
        return {
          success: false,
          error: "No workspace folder linked"
        }
      }

      try {
        // Convert virtual path to full disk path
        const relativePath = filePath.startsWith("/") ? filePath.slice(1) : filePath
        const fullPath = path.join(workspacePath, relativePath)

        // Security check: ensure the resolved path is within the workspace
        const resolvedPath = path.resolve(fullPath)
        const resolvedWorkspace = path.resolve(workspacePath)
        if (!resolvedPath.startsWith(resolvedWorkspace)) {
          return { success: false, error: "Access denied: path outside workspace" }
        }

        // Check if file exists
        const stat = await fs.stat(fullPath)
        if (stat.isDirectory()) {
          return { success: false, error: "Cannot read directory as file" }
        }

        // Read file contents
        const content = await fs.readFile(fullPath, "utf-8")

        return {
          success: true,
          content,
          size: stat.size,
          modified_at: stat.mtime.toISOString()
        }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "Unknown error"
        }
      }
    }
  )

  // Read a binary file (images, PDFs, etc.) and return as base64
  ipcMain.handle(
    "workspace:readBinaryFile",
    async (_event, { threadId, filePath }: WorkspaceFileParams) => {
      const { getThread } = await import("../db")

      // Get workspace path from thread metadata
      const thread = await getThread(threadId)
      const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
      const workspacePath = metadata.workspacePath as string | null

      if (!workspacePath) {
        return {
          success: false,
          error: "No workspace folder linked"
        }
      }

      try {
        // Convert virtual path to full disk path
        const relativePath = filePath.startsWith("/") ? filePath.slice(1) : filePath
        const fullPath = path.join(workspacePath, relativePath)

        // Security check: ensure the resolved path is within the workspace
        const resolvedPath = path.resolve(fullPath)
        const resolvedWorkspace = path.resolve(workspacePath)
        if (!resolvedPath.startsWith(resolvedWorkspace)) {
          return { success: false, error: "Access denied: path outside workspace" }
        }

        // Check if file exists
        const stat = await fs.stat(fullPath)
        if (stat.isDirectory()) {
          return { success: false, error: "Cannot read directory as file" }
        }

        // Read file as binary and convert to base64
        const buffer = await fs.readFile(fullPath)
        const base64 = buffer.toString("base64")

        return {
          success: true,
          content: base64,
          size: stat.size,
          modified_at: stat.mtime.toISOString()
        }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "Unknown error"
        }
      }
    }
  )
}

export { getAgentConfig }
export { getModelConfig }

export function getDefaultModel(): string {
  return getDefaultModelForUI("llm")
}
