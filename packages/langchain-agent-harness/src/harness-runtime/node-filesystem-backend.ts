import { spawn } from "node:child_process"
import { constants as fsConstants } from "node:fs"
import { lstat, mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type {
  JingleFilesystemEditResult,
  JingleFilesystemFileData,
  JingleFilesystemFileInfo,
  JingleFilesystemGrepMatch,
  JingleFilesystemWriteResult
} from "./filesystem"
import { ripgrepExecutablePath } from "./ripgrep-executable"

export interface JingleNodeFilesystemBackendOptions {
  maxFileSizeMb?: number
  rootDir?: string
  virtualMode?: boolean
}

const EMPTY_CONTENT_WARNING = "System reminder: File exists but has empty contents"
const LINE_NUMBER_WIDTH = 6
const MAX_LINE_LENGTH = 10_000
const SUPPORTS_NOFOLLOW = fsConstants.O_NOFOLLOW !== undefined

type RipgrepResults = Record<string, Array<[lineNumber: number, lineText: string]>>

function formatContentWithLineNumbers(content: string[] | string, startLine = 1): string {
  let lines = typeof content === "string" ? content.split("\n") : content
  if (typeof content === "string" && lines.at(-1) === "") {
    lines = lines.slice(0, -1)
  }

  const resultLines: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const lineNumber = index + startLine
    if (line.length <= MAX_LINE_LENGTH) {
      resultLines.push(`${lineNumber.toString().padStart(LINE_NUMBER_WIDTH)}\t${line}`)
      continue
    }

    const chunks = Math.ceil(line.length / MAX_LINE_LENGTH)
    for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex += 1) {
      const start = chunkIndex * MAX_LINE_LENGTH
      const end = Math.min(start + MAX_LINE_LENGTH, line.length)
      const chunk = line.substring(start, end)
      const marker = chunkIndex === 0 ? lineNumber.toString() : `${lineNumber}.${chunkIndex}`
      resultLines.push(`${marker.padStart(LINE_NUMBER_WIDTH)}\t${chunk}`)
    }
  }
  return resultLines.join("\n")
}

function checkEmptyContent(content: string): string | null {
  return content.trim() === "" ? EMPTY_CONTENT_WARNING : null
}

function performStringReplacement(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): [newContent: string, occurrences: number] | string {
  if (content === "" && oldString === "") {
    return [newString, 0]
  }
  if (oldString === "") {
    return "Error: oldString cannot be empty when file has content"
  }

  const occurrences = content.split(oldString).length - 1
  if (occurrences === 0) {
    return `Error: String not found in file: '${oldString}'`
  }
  if (occurrences > 1 && !replaceAll) {
    return `Error: String '${oldString}' has multiple occurrences (appears ${occurrences} times) in file. Use replace_all=True to replace all instances, or provide a more specific string with surrounding context.`
  }
  return [content.split(oldString).join(newString), occurrences]
}

function matchesSimpleGlob(filePath: string, glob: string): boolean {
  if (glob === "*") {
    return true
  }
  if (glob.startsWith("*.")) {
    return filePath.endsWith(glob.slice(1))
  }
  if (glob.includes("*")) {
    const escaped = glob
      .split("*")
      .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
      .join(".*")
    return new RegExp(`^${escaped}$`).test(filePath)
  }
  return filePath === glob || filePath.endsWith(`/${glob}`) || filePath.endsWith(`${sep}${glob}`)
}

export class JingleNodeFilesystemBackend {
  protected readonly cwd: string
  protected readonly virtualMode: boolean

  private readonly maxFileSizeBytes: number

  constructor(options: JingleNodeFilesystemBackendOptions = {}) {
    const { rootDir, virtualMode = false, maxFileSizeMb = 10 } = options
    this.cwd = rootDir ? resolve(rootDir) : process.cwd()
    this.virtualMode = virtualMode
    this.maxFileSizeBytes = maxFileSizeMb * 1024 * 1024
  }

  protected resolvePath(key: string): string {
    if (this.virtualMode) {
      const virtualPath = key.startsWith("/") ? key : `/${key}`
      if (virtualPath.includes("..") || virtualPath.startsWith("~")) {
        throw new Error("Path traversal not allowed")
      }
      const fullPath = resolve(this.cwd, virtualPath.substring(1))
      const relativePath = relative(this.cwd, fullPath)
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        throw new Error(`Path: ${fullPath} outside root directory: ${this.cwd}`)
      }
      return fullPath
    }

    return isAbsolute(key) ? key : resolve(this.cwd, key)
  }

  private toExternalPath(fullPath: string): string {
    if (!this.virtualMode) {
      return fullPath
    }

    const cwdWithSeparator = this.cwd.endsWith(sep) ? this.cwd : `${this.cwd}${sep}`
    let relativePath: string
    if (fullPath.startsWith(cwdWithSeparator)) {
      relativePath = fullPath.substring(cwdWithSeparator.length)
    } else if (fullPath.startsWith(this.cwd)) {
      relativePath = fullPath.substring(this.cwd.length).replace(/^[/\\]/, "")
    } else {
      relativePath = fullPath
    }
    return `/${relativePath.split(sep).join("/")}`
  }

  async lsInfo(dirPath: string): Promise<JingleFilesystemFileInfo[]> {
    try {
      const resolvedPath = this.resolvePath(dirPath)
      if (!(await stat(resolvedPath)).isDirectory()) {
        return []
      }

      const entries = await readdir(resolvedPath, { withFileTypes: true })
      const results: JingleFilesystemFileInfo[] = []
      for (const entry of entries) {
        const fullPath = join(resolvedPath, entry.name)
        try {
          const entryStat = await stat(fullPath)
          if (entryStat.isFile()) {
            results.push({
              path: this.toExternalPath(fullPath),
              is_dir: false,
              size: entryStat.size,
              modified_at: entryStat.mtime.toISOString()
            })
          } else if (entryStat.isDirectory()) {
            results.push({
              path: `${this.toExternalPath(fullPath)}${this.virtualMode ? "/" : sep}`,
              is_dir: true,
              size: 0,
              modified_at: entryStat.mtime.toISOString()
            })
          }
        } catch {
          continue
        }
      }
      return results.sort((a, b) => a.path.localeCompare(b.path))
    } catch {
      return []
    }
  }

  async read(filePath: string, offset = 0, limit = 500): Promise<string> {
    try {
      const resolvedPath = this.resolvePath(filePath)
      const content = await this.readTextFileWithoutFollowingSymlinks(resolvedPath, filePath)
      const emptyMessage = checkEmptyContent(content)
      if (emptyMessage) {
        return emptyMessage
      }

      const lines = content.split("\n")
      const startIndex = offset
      const endIndex = Math.min(startIndex + limit, lines.length)
      if (startIndex >= lines.length) {
        return `Error: Line offset ${offset} exceeds file length (${lines.length} lines)`
      }
      return formatContentWithLineNumbers(lines.slice(startIndex, endIndex), startIndex + 1)
    } catch (error) {
      return `Error reading file '${filePath}': ${(error as Error).message}`
    }
  }

  async readRaw(filePath: string): Promise<JingleFilesystemFileData> {
    const resolvedPath = this.resolvePath(filePath)
    const fileStat = await stat(resolvedPath)
    if (!fileStat.isFile()) {
      throw new Error(`File '${filePath}' not found`)
    }
    const content = await this.readTextFileWithoutFollowingSymlinks(resolvedPath, filePath)
    return {
      content: content.split("\n"),
      created_at: fileStat.ctime.toISOString(),
      modified_at: fileStat.mtime.toISOString()
    }
  }

  async write(filePath: string, content: string): Promise<JingleFilesystemWriteResult> {
    try {
      const resolvedPath = this.resolvePath(filePath)
      try {
        if ((await lstat(resolvedPath)).isSymbolicLink()) {
          return {
            error: `Cannot write to ${filePath} because it is a symlink. Symlinks are not allowed.`
          }
        }
        return {
          error: `Cannot write to ${filePath} because it already exists. Read and then make an edit, or write to a new path.`
        }
      } catch {
        await mkdir(dirname(resolvedPath), { recursive: true })
        await this.writeTextFileWithoutFollowingSymlinks(resolvedPath, content, true)
        return {
          path: filePath,
          filesUpdate: null
        }
      }
    } catch (error) {
      return { error: `Error writing file '${filePath}': ${(error as Error).message}` }
    }
  }

  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false
  ): Promise<JingleFilesystemEditResult> {
    try {
      const resolvedPath = this.resolvePath(filePath)
      const content = await this.readTextFileWithoutFollowingSymlinks(resolvedPath, filePath)
      const replacement = performStringReplacement(content, oldString, newString, replaceAll)
      if (typeof replacement === "string") {
        return { error: replacement }
      }

      const [newContent, occurrences] = replacement
      await this.writeTextFileWithoutFollowingSymlinks(resolvedPath, newContent, false)
      return {
        path: filePath,
        filesUpdate: null,
        occurrences
      }
    } catch (error) {
      return { error: `Error editing file '${filePath}': ${(error as Error).message}` }
    }
  }

  async grepRaw(
    pattern: string,
    dirPath = "/",
    glob: string | null = null
  ): Promise<JingleFilesystemGrepMatch[] | string> {
    let baseFull: string
    try {
      baseFull = this.resolvePath(dirPath || ".")
      await stat(baseFull)
    } catch {
      return []
    }

    const results =
      (await this.ripgrepSearch(pattern, baseFull, glob)) ??
      (await this.literalSearch(pattern, baseFull, glob))
    const matches: JingleFilesystemGrepMatch[] = []
    for (const [path, items] of Object.entries(results)) {
      for (const [line, text] of items) {
        matches.push({ path, line, text })
      }
    }
    return matches
  }

  async globInfo(pattern: string, searchPath = "/"): Promise<JingleFilesystemFileInfo[]> {
    const normalizedPattern = pattern.startsWith("/") ? pattern.substring(1) : pattern
    const resolvedSearchPath = searchPath === "/" ? this.cwd : this.resolvePath(searchPath)
    try {
      if (!(await stat(resolvedSearchPath)).isDirectory()) {
        return []
      }
    } catch {
      return []
    }

    const matches =
      (await this.ripgrepFiles(resolvedSearchPath, normalizedPattern)) ??
      (await this.listFilesMatchingGlob(resolvedSearchPath, normalizedPattern))
    const results: JingleFilesystemFileInfo[] = []
    for (const matchedPath of matches) {
      try {
        const matchedStat = await stat(matchedPath)
        if (!matchedStat.isFile()) {
          continue
        }
        results.push({
          path: this.toExternalPath(matchedPath),
          is_dir: false,
          size: matchedStat.size,
          modified_at: matchedStat.mtime.toISOString()
        })
      } catch {
        continue
      }
    }
    return results.sort((a, b) => a.path.localeCompare(b.path))
  }

  private async readTextFileWithoutFollowingSymlinks(
    resolvedPath: string,
    requestedPath: string
  ): Promise<string> {
    if (SUPPORTS_NOFOLLOW) {
      if (!(await stat(resolvedPath)).isFile()) {
        throw new Error(`File '${requestedPath}' not found`)
      }
      const descriptor = await open(resolvedPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
      try {
        return await descriptor.readFile({ encoding: "utf-8" })
      } finally {
        await descriptor.close()
      }
    }

    const fileStat = await lstat(resolvedPath)
    if (fileStat.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed: ${requestedPath}`)
    }
    if (!fileStat.isFile()) {
      throw new Error(`File '${requestedPath}' not found`)
    }
    return readFile(resolvedPath, "utf-8")
  }

  private async writeTextFileWithoutFollowingSymlinks(
    resolvedPath: string,
    content: string,
    create: boolean
  ): Promise<void> {
    if (SUPPORTS_NOFOLLOW) {
      const flags = create
        ? fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW
        : fsConstants.O_WRONLY | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW
      const descriptor = await open(resolvedPath, flags, 0o644)
      try {
        await descriptor.writeFile(content, "utf-8")
      } finally {
        await descriptor.close()
      }
      return
    }

    await writeFile(resolvedPath, content, "utf-8")
  }

  private async ripgrepSearch(
    pattern: string,
    baseFull: string,
    includeGlob: string | null
  ): Promise<RipgrepResults | null> {
    return new Promise((resolveResults) => {
      const args = ["--json", "-F"]
      if (includeGlob) {
        args.push("--glob", includeGlob)
      }
      args.push("--", pattern, baseFull)

      const process = spawn(ripgrepExecutablePath, args, { timeout: 30_000 })
      const results: RipgrepResults = {}
      let output = ""
      process.stdout.on("data", (data: Buffer) => {
        output += data.toString()
      })
      process.on("close", (code) => {
        if (code !== 0 && code !== 1) {
          resolveResults(null)
          return
        }

        for (const line of output.split("\n")) {
          if (!line.trim()) {
            continue
          }
          try {
            const data = JSON.parse(line) as {
              data?: {
                line_number?: number
                lines?: { text?: string }
                path?: { text?: string }
              }
              type?: string
            }
            if (data.type !== "match") {
              continue
            }
            const matchedPath = data.data?.path?.text
            const lineNumber = data.data?.line_number
            if (!matchedPath || lineNumber === undefined) {
              continue
            }

            const externalPath = this.toExternalPath(resolve(matchedPath))
            const lineText = data.data?.lines?.text?.replace(/\n$/, "") ?? ""
            results[externalPath] ??= []
            results[externalPath].push([lineNumber, lineText])
          } catch {
            continue
          }
        }
        resolveResults(results)
      })
      process.on("error", () => resolveResults(null))
    })
  }

  private async literalSearch(
    pattern: string,
    baseFull: string,
    includeGlob: string | null
  ): Promise<RipgrepResults> {
    const results: RipgrepResults = {}
    const files = await this.listFilesMatchingGlob(baseFull, includeGlob ?? "*")
    for (const filePath of files) {
      try {
        const fileStat = await stat(filePath)
        if (fileStat.size > this.maxFileSizeBytes) {
          continue
        }
        const lines = (await readFile(filePath, "utf-8")).split("\n")
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]
          if (!line.includes(pattern)) {
            continue
          }
          const externalPath = this.toExternalPath(filePath)
          results[externalPath] ??= []
          results[externalPath].push([index + 1, line])
        }
      } catch {
        continue
      }
    }
    return results
  }

  private async ripgrepFiles(searchPath: string, pattern: string): Promise<string[] | null> {
    return new Promise((resolveFiles) => {
      const args = ["--files", "--glob", pattern, searchPath]
      const process = spawn(ripgrepExecutablePath, args, { timeout: 30_000 })
      let output = ""
      process.stdout.on("data", (data: Buffer) => {
        output += data.toString()
      })
      process.on("close", (code) => {
        if (code !== 0) {
          resolveFiles(null)
          return
        }
        resolveFiles(
          output
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => resolve(line))
        )
      })
      process.on("error", () => resolveFiles(null))
    })
  }

  private async listFilesMatchingGlob(searchPath: string, glob: string): Promise<string[]> {
    const rootStat = await stat(searchPath)
    const rootDirectory = rootStat.isDirectory() ? searchPath : dirname(searchPath)
    const results: string[] = []
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(directory, entry.name)
        try {
          if (entry.isDirectory()) {
            await visit(fullPath)
          } else if (entry.isFile()) {
            const relativePath = relative(rootDirectory, fullPath).split(sep).join("/")
            if (matchesSimpleGlob(relativePath, glob) || matchesSimpleGlob(entry.name, glob)) {
              results.push(fullPath)
            }
          }
        } catch {
          continue
        }
      }
    }
    await visit(rootDirectory)
    return results
  }
}
