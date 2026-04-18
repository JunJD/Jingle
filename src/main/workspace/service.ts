import { dialog } from "electron"
import * as fs from "fs/promises"
import * as path from "path"
import type { WorkspaceFileParams, WorkspaceSetParams } from "../types"
import { WorkspaceRepository } from "./repository"

export type WorkspaceFileReadResult =
  | {
      content: string
      modified_at: string
      size: number
      success: true
    }
  | {
      error: string
      success: false
    }

type WorkspaceFileReadFailure = Extract<WorkspaceFileReadResult, { success: false }>

export class WorkspaceService {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  resolveGlobalWorkspacePath(): Promise<string | null> {
    return Promise.resolve(this.workspaceRepository.getGlobalWorkspacePath())
  }

  async getWorkspacePath(threadId?: string): Promise<string | null> {
    if (!threadId) {
      return this.resolveGlobalWorkspacePath()
    }

    return this.workspaceRepository.getThreadWorkspacePath(threadId)
  }

  async setWorkspacePath(params: WorkspaceSetParams): Promise<string | null> {
    const { path: newPath, threadId } = params

    if (!threadId) {
      this.workspaceRepository.setGlobalWorkspacePath(newPath)
      return this.resolveGlobalWorkspacePath()
    }

    const didUpdate = await this.workspaceRepository.setThreadWorkspacePath(threadId, newPath)
    if (!didUpdate) return null

    if (newPath) {
      this.workspaceRepository.setGlobalWorkspacePath(newPath)
    }

    return newPath
  }

  async selectWorkspace(threadId?: string): Promise<string | null> {
    const defaultPath =
      this.workspaceRepository.getWorkspaceDialogPath() ??
      (await this.resolveGlobalWorkspacePath()) ??
      undefined
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
    this.workspaceRepository.setWorkspaceDialogPath(selectedPath)

    if (threadId) {
      const didUpdate = await this.workspaceRepository.setThreadWorkspacePath(threadId, selectedPath)
      if (didUpdate) {
        this.workspaceRepository.setGlobalWorkspacePath(selectedPath)
      }
    } else {
      this.workspaceRepository.setGlobalWorkspacePath(selectedPath)
    }

    return selectedPath
  }

  async readFile(params: WorkspaceFileParams): Promise<WorkspaceFileReadResult> {
    const file = await this.resolveReadableWorkspaceFile(params)
    if (!file.success) return file

    try {
      const content = await fs.readFile(file.fullPath, "utf-8")

      return {
        success: true,
        content,
        size: file.size,
        modified_at: file.modifiedAt
      }
    } catch (e) {
      return this.toReadError(e)
    }
  }

  async readBinaryFile(params: WorkspaceFileParams): Promise<WorkspaceFileReadResult> {
    const file = await this.resolveReadableWorkspaceFile(params)
    if (!file.success) return file

    try {
      const buffer = await fs.readFile(file.fullPath)

      return {
        success: true,
        content: buffer.toString("base64"),
        size: file.size,
        modified_at: file.modifiedAt
      }
    } catch (e) {
      return this.toReadError(e)
    }
  }

  private async resolveReadableWorkspaceFile(
    params: WorkspaceFileParams
  ): Promise<
    | { fullPath: string; modifiedAt: string; size: number; success: true }
    | { error: string; success: false }
  > {
    const workspacePath = await this.workspaceRepository.getThreadWorkspacePath(params.threadId)

    if (!workspacePath) {
      return {
        success: false,
        error: "No workspace folder linked"
      }
    }

    try {
      const relativePath = params.filePath.startsWith("/")
        ? params.filePath.slice(1)
        : params.filePath
      const fullPath = path.join(workspacePath, relativePath)
      const resolvedPath = path.resolve(fullPath)
      const resolvedWorkspace = path.resolve(workspacePath)

      if (!resolvedPath.startsWith(resolvedWorkspace)) {
        return { success: false, error: "Access denied: path outside workspace" }
      }

      const stat = await fs.stat(fullPath)
      if (stat.isDirectory()) {
        return { success: false, error: "Cannot read directory as file" }
      }

      return {
        success: true,
        fullPath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      }
    } catch (e) {
      return this.toReadError(e)
    }
  }

  private toReadError(e: unknown): WorkspaceFileReadFailure {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error"
    }
  }
}
