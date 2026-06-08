import { dialog } from "electron"
import { spawn } from "node:child_process"
import * as fs from "fs/promises"
import * as path from "path"
import fuzzysort from "fuzzysort"
import { rgPath } from "@vscode/ripgrep"
import type { WorkspaceFileParams, WorkspaceFileSearchParams, WorkspaceSetParams } from "../types"
import { OpenworkMemoryService } from "../openwork-memory/service"
import { WorkspaceRepository } from "./repository"

const WORKSPACE_FILE_SEARCH_MAX_RESULTS = 20

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

export interface WorkspaceFileSearchResult {
  files: Array<{
    name: string
    path: string
  }>
  success: true
}

export type WorkspaceFileSearchResponse =
  | WorkspaceFileSearchResult
  | {
      error: string
      success: false
    }

export class WorkspaceService {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly openworkMemoryService: OpenworkMemoryService
  ) {}

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

    await this.assertCanChangeThreadWorkspace(threadId)

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
      await this.assertCanChangeThreadWorkspace(threadId)

      const didUpdate = await this.workspaceRepository.setThreadWorkspacePath(threadId, selectedPath)
      if (didUpdate) {
        this.workspaceRepository.setGlobalWorkspacePath(selectedPath)
      }
    } else {
      this.workspaceRepository.setGlobalWorkspacePath(selectedPath)
    }

    return selectedPath
  }

  private async assertCanChangeThreadWorkspace(threadId: string): Promise<void> {
    const hasPendingWorkspaceSuggestions =
      await this.openworkMemoryService.hasPendingWorkspaceSuggestions(threadId)

    if (hasPendingWorkspaceSuggestions) {
      throw new Error(
        "Resolve pending workspace memories before changing this thread's workspace."
      )
    }
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

  async searchFiles(params: WorkspaceFileSearchParams): Promise<WorkspaceFileSearchResponse> {
    const workspacePath = await this.workspaceRepository.getThreadWorkspacePath(params.threadId)
    if (!workspacePath) {
      return {
        success: false,
        error: "No workspace folder linked"
      }
    }

    const query = normalizeFileSearchQuery(params.query)
    const limit = resolveFileSearchLimit(params.limit)

    try {
      const paths = await collectWorkspaceFilePaths(workspacePath)
      return {
        success: true,
        files: rankWorkspaceFileMatches(paths, query, limit).map((filePath) => ({
          name: path.basename(filePath),
          path: filePath
        }))
      }
    } catch (error) {
      return this.toReadError(error)
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
      const resolved = resolveWorkspaceRelativePath(workspacePath, params.filePath)
      if (!resolved.success) {
        return { success: false, error: "Access denied: path outside workspace" }
      }

      const stat = await fs.stat(resolved.fullPath)
      if (stat.isDirectory()) {
        return { success: false, error: "Cannot read directory as file" }
      }

      return {
        success: true,
        fullPath: resolved.fullPath,
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

function normalizeFileSearchQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120)
}

function resolveFileSearchLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return WORKSPACE_FILE_SEARCH_MAX_RESULTS
  }

  return Math.max(1, Math.min(Math.floor(value), WORKSPACE_FILE_SEARCH_MAX_RESULTS))
}

function resolveWorkspaceRelativePath(
  workspacePath: string,
  filePath: string
): { fullPath: string; relativePath: string; success: true } | { success: false } {
  const relativePath = filePath.startsWith("/") ? filePath.slice(1) : filePath
  const fullPath = path.resolve(workspacePath, relativePath)
  const resolvedWorkspace = path.resolve(workspacePath)
  const relativeFromWorkspace = path.relative(resolvedWorkspace, fullPath)

  if (
    relativeFromWorkspace === "" ||
    relativeFromWorkspace.startsWith("..") ||
    path.isAbsolute(relativeFromWorkspace)
  ) {
    return { success: false }
  }

  return {
    fullPath,
    relativePath: relativeFromWorkspace,
    success: true
  }
}

async function collectWorkspaceFilePaths(workspacePath: string): Promise<string[]> {
  const env = { ...process.env }
  delete env.RIPGREP_CONFIG_PATH

  return new Promise((resolve, reject) => {
    const files: string[] = []
    let pending = ""
    let stderr = ""
    const child = spawn(rgPath, ["--no-config", "--files", "--hidden", "--glob=!.git/*", "."], {
      cwd: workspacePath,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    })

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      const text = pending + chunk
      const lines = text.split(/\r?\n/)
      pending = lines.pop() ?? ""

      for (const line of lines) {
        const normalized = normalizeRipgrepPath(line)
        if (normalized) {
          files.push(normalized)
        }
      }
    })

    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })

    child.on("error", reject)
    child.on("close", (code) => {
      const normalizedPending = normalizeRipgrepPath(pending)
      if (normalizedPending) {
        files.push(normalizedPending)
      }

      if (code === 0 || code === 1) {
        resolve(files)
        return
      }

      reject(new Error(stderr.trim() || `ripgrep failed with code ${code ?? "unknown"}`))
    })
  })
}

function normalizeRipgrepPath(filePath: string): string {
  return path
    .normalize(filePath.replace(/^\.[\\/]/, ""))
    .split(path.sep)
    .join("/")
    .trim()
}

function rankWorkspaceFileMatches(paths: string[], query: string, limit: number): string[] {
  if (!query) {
    return paths.slice(0, limit)
  }

  return fuzzysort.go(query, paths, { limit }).map((result) => result.target)
}
