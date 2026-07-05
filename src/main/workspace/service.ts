import { dialog } from "electron"
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import * as fs from "fs/promises"
import * as path from "path"
import fuzzysort from "fuzzysort"
import { rgPath } from "@vscode/ripgrep"
import type {
  WorkspaceCreateDefaultParams,
  WorkspaceFileParams,
  WorkspaceFileSearchParams,
  WorkspaceSetParams
} from "../types"
import { JingleMemoryService } from "../jingle-memory/service"
import { getThread } from "../db/threads"
import { ThreadWorkspaceService } from "../thread-workspace/service"
import { WorkspaceRepository } from "./repository"

const WORKSPACE_FILE_SEARCH_MAX_RESULTS = 20
const WORKSPACE_FILE_SEARCH_CACHE_TTL_MS = 30_000
const WORKSPACE_FILE_SEARCH_PARTIAL_CACHE_TTL_MS = 5_000
const WORKSPACE_FILE_SEARCH_TIMEOUT_MS = 2_500
const DEFAULT_AI_WORKSPACE_FOLDER_NAME = "AI Space"
const DEFAULT_AI_WORKSPACE_NAME_MAX_LENGTH = 48
const INVALID_WORKSPACE_NAME_CHARACTERS = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"])
const WINDOWS_RESERVED_DEVICE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
])
const WORKSPACE_FILE_SEARCH_IGNORED_DIRS = [
  ".git",
  ".hg",
  ".next",
  ".pnpm-store",
  ".svn",
  ".turbo",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules"
]

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
  incomplete?: true
  success: true
}

export type WorkspaceFileSearchResponse =
  | WorkspaceFileSearchResult
  | {
      error: string
      success: false
    }

type WorkspaceFilePathCollection = {
  completed: boolean
  paths: string[]
}

type WorkspaceFileSearchCacheEntry = {
  expiresAt: number
  promise?: Promise<WorkspaceFilePathCollection>
  value?: WorkspaceFilePathCollection
}

export class WorkspaceService {
  private readonly fileSearchCache = new Map<string, WorkspaceFileSearchCacheEntry>()

  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly threadWorkspaceService: ThreadWorkspaceService,
    private readonly jingleMemoryService: JingleMemoryService
  ) {}

  async resolveGlobalWorkspacePath(): Promise<string | null> {
    const workspacePath = this.workspaceRepository.getGlobalWorkspacePath()
    if (!workspacePath) {
      return null
    }

    await fs.mkdir(workspacePath, { recursive: true })
    return workspacePath
  }

  async getWorkspacePath(threadId?: string): Promise<string | null> {
    if (!threadId) {
      return this.resolveGlobalWorkspacePath()
    }

    return this.threadWorkspaceService.getThreadWorkspacePath(threadId)
  }

  async setWorkspacePath(params: WorkspaceSetParams): Promise<string | null> {
    const { path: newPath, threadId } = params

    if (!threadId) {
      this.workspaceRepository.setGlobalWorkspacePath(newPath)
      return this.resolveGlobalWorkspacePath()
    }

    await this.assertCanChangeThreadWorkspace(threadId)

    await this.setThreadWorkspacePath(threadId, newPath)

    if (newPath) {
      this.workspaceRepository.setGlobalWorkspacePath(newPath)
    }

    return newPath
  }

  async createDefaultWorkspace(params: WorkspaceCreateDefaultParams = {}): Promise<string> {
    const rootPath = await this.resolveGlobalWorkspacePath()
    if (!rootPath) {
      throw new Error("No workspace root folder linked")
    }

    const workspacePath = path.join(rootPath, createDefaultWorkspaceFolderName(params.title))
    await fs.mkdir(workspacePath, { recursive: true })
    return workspacePath
  }

  async selectWorkspaceFolder(): Promise<string | null> {
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
    return selectedPath
  }

  async selectWorkspace(threadId?: string): Promise<string | null> {
    const selectedPath = await this.selectWorkspaceFolder()
    if (!selectedPath) {
      return null
    }

    if (threadId) {
      await this.assertCanChangeThreadWorkspace(threadId)

      await this.setThreadWorkspacePath(threadId, selectedPath)
      this.workspaceRepository.setGlobalWorkspacePath(selectedPath)
    } else {
      this.workspaceRepository.setGlobalWorkspacePath(selectedPath)
    }

    return selectedPath
  }

  private async assertCanChangeThreadWorkspace(threadId: string): Promise<void> {
    const hasPendingWorkspaceSuggestions =
      await this.jingleMemoryService.hasPendingWorkspaceSuggestions(threadId)

    if (hasPendingWorkspaceSuggestions) {
      throw new Error("Resolve pending workspace memories before changing this thread's workspace.")
    }
  }

  private async setThreadWorkspacePath(
    threadId: string,
    workspacePath: string | null
  ): Promise<void> {
    const thread = await getThread(threadId)
    if (!thread) {
      throw new Error("Thread not found")
    }

    if (workspacePath) {
      await this.threadWorkspaceService.bindProject(threadId, workspacePath)
      return
    }

    await this.threadWorkspaceService.markProjectless(threadId)
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
    const workspacePath = await this.getWorkspacePath(params.threadId)
    if (!workspacePath) {
      return {
        success: false,
        error: "No workspace folder linked"
      }
    }

    const query = normalizeFileSearchQuery(params.query)
    const limit = resolveFileSearchLimit(params.limit)

    try {
      const collection = await this.getWorkspaceFilePathCollection(workspacePath)
      return {
        success: true,
        ...(collection.completed ? {} : { incomplete: true as const }),
        files: rankWorkspaceFileMatches(collection.paths, query, limit).map((filePath) => ({
          name: path.basename(filePath),
          path: filePath
        }))
      }
    } catch (error) {
      return this.toReadError(error)
    }
  }

  private async getWorkspaceFilePathCollection(
    workspacePath: string
  ): Promise<WorkspaceFilePathCollection> {
    const cacheKey = path.resolve(workspacePath)
    const now = Date.now()
    const cached = this.fileSearchCache.get(cacheKey)

    if (cached?.value && cached.expiresAt > now) {
      return cached.value
    }

    if (cached?.promise) {
      return cached.promise
    }

    const promise = collectWorkspaceFilePaths(cacheKey, WORKSPACE_FILE_SEARCH_TIMEOUT_MS)
    this.fileSearchCache.set(cacheKey, { expiresAt: 0, promise })

    try {
      const value = await promise
      this.fileSearchCache.set(cacheKey, {
        expiresAt:
          Date.now() +
          (value.completed
            ? WORKSPACE_FILE_SEARCH_CACHE_TTL_MS
            : WORKSPACE_FILE_SEARCH_PARTIAL_CACHE_TTL_MS),
        value
      })
      return value
    } catch (error) {
      this.fileSearchCache.delete(cacheKey)
      throw error
    }
  }

  private async resolveReadableWorkspaceFile(
    params: WorkspaceFileParams
  ): Promise<
    | { fullPath: string; modifiedAt: string; size: number; success: true }
    | { error: string; success: false }
  > {
    const workspacePath = await this.getWorkspacePath(params.threadId)

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

function createDefaultWorkspaceFolderName(title: string | undefined): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-")
  const suffix = randomUUID().slice(0, 8)
  const workspaceName = normalizeDefaultWorkspaceName(title)

  return `${timestamp}-${workspaceName}-${suffix}`
}

function normalizeDefaultWorkspaceName(title: string | undefined): string {
  const normalized = replaceInvalidDefaultWorkspaceNameCharacters(
    title ?? DEFAULT_AI_WORKSPACE_FOLDER_NAME
  )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, DEFAULT_AI_WORKSPACE_NAME_MAX_LENGTH)
    .trim()

  if (!normalized || WINDOWS_RESERVED_DEVICE_NAMES.has(normalized.toUpperCase())) {
    return DEFAULT_AI_WORKSPACE_FOLDER_NAME
  }

  return normalized
}

function replaceInvalidDefaultWorkspaceNameCharacters(value: string): string {
  return Array.from(value, (character) => {
    if (character.charCodeAt(0) < 32 || INVALID_WORKSPACE_NAME_CHARACTERS.has(character)) {
      return " "
    }

    return character
  }).join("")
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

async function collectWorkspaceFilePaths(
  workspacePath: string,
  timeoutMs: number
): Promise<WorkspaceFilePathCollection> {
  const env = { ...process.env }
  delete env.RIPGREP_CONFIG_PATH

  return new Promise((resolve, reject) => {
    const files: string[] = []
    let pending = ""
    let stderr = ""
    let timedOut = false
    const child = spawn(
      rgPath,
      [
        "--no-config",
        "--files",
        "--hidden",
        ...WORKSPACE_FILE_SEARCH_IGNORED_DIRS.flatMap((dir) => [
          "--glob",
          `!${dir}/**`,
          "--glob",
          `!**/${dir}/**`
        ]),
        "."
      ],
      {
        cwd: workspacePath,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    )
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

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

    child.on("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timeout)
      const normalizedPending = normalizeRipgrepPath(pending)
      if (normalizedPending) {
        files.push(normalizedPending)
      }

      if (timedOut) {
        resolve({ completed: false, paths: files })
        return
      }

      if (code === 0 || code === 1) {
        resolve({ completed: true, paths: files })
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
