import { createHash } from "node:crypto"
import type {
  BufferEncoding,
  CpOptions,
  FileContent,
  FsStat,
  IFileSystem,
  MkdirOptions,
  RmOptions
} from "just-bash"
import type { MutationPredictionChange } from "@shared/mutation-prediction"

interface FileSnapshot {
  contentHash: string
  mode: number
}

interface DirentEntry {
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink: boolean
  name: string
}

export interface RecordingFsOptions {
  shouldTrackPath?: (path: string) => boolean
}

type ReadFileOptions = {
  encoding?: BufferEncoding | null
}

type WriteFileOptions = {
  encoding?: BufferEncoding
}

function isMissingPathError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    return (error as { code?: string }).code === "ENOENT"
  }

  return error instanceof Error && /ENOENT|No such file|not exist/i.test(error.message)
}

function isSameOrDescendant(candidatePath: string, rootPath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`)
}

function diffSnapshots(
  before: Map<string, FileSnapshot>,
  after: Map<string, FileSnapshot>
): MutationPredictionChange[] {
  const changes: MutationPredictionChange[] = []
  const allPaths = new Set([...before.keys(), ...after.keys()])

  for (const filePath of Array.from(allPaths).sort()) {
    const previous = before.get(filePath)
    const next = after.get(filePath)

    if (!previous && next) {
      changes.push({ path: filePath, changeType: "create" })
      continue
    }

    if (previous && !next) {
      changes.push({ path: filePath, changeType: "delete" })
      continue
    }

    if (!previous || !next) {
      continue
    }

    if (previous.contentHash !== next.contentHash || previous.mode !== next.mode) {
      changes.push({ path: filePath, changeType: "modify" })
    }
  }

  return changes
}

export class RecordingFs implements IFileSystem {
  private readonly beforeSnapshots = new Map<string, FileSnapshot>()
  private readonly inner: IFileSystem
  private readonly shouldTrackPath: (path: string) => boolean
  private trackedRoots = new Set<string>()

  constructor(inner: IFileSystem, options: RecordingFsOptions = {}) {
    this.inner = inner
    this.shouldTrackPath = options.shouldTrackPath ?? (() => true)
  }

  async collectChanges(): Promise<MutationPredictionChange[]> {
    const afterSnapshots = new Map<string, FileSnapshot>()

    await Promise.all(
      Array.from(this.trackedRoots)
        .sort()
        .map((rootPath) => this.captureTree(rootPath, afterSnapshots))
    )

    return diffSnapshots(this.beforeSnapshots, afterSnapshots)
  }

  async readFile(path: string, options?: ReadFileOptions | BufferEncoding): Promise<string> {
    return this.inner.readFile(path, options)
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return this.inner.readFileBuffer(path)
  }

  async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding
  ): Promise<void> {
    await this.prepareMutation(path)
    return this.inner.writeFile(path, content, options)
  }

  async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding
  ): Promise<void> {
    await this.prepareMutation(path)
    return this.inner.appendFile(path, content, options)
  }

  async exists(path: string): Promise<boolean> {
    return this.inner.exists(path)
  }

  async stat(path: string): Promise<FsStat> {
    return this.inner.stat(path)
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    await this.prepareMutation(path)
    return this.inner.mkdir(path, options)
  }

  async readdir(path: string): Promise<string[]> {
    return this.inner.readdir(path)
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    if (this.inner.readdirWithFileTypes) {
      return this.inner.readdirWithFileTypes(path)
    }

    const entries = await this.inner.readdir(path)
    return Promise.all(
      entries.map(async (entry) => {
        const entryPath = this.inner.resolvePath(path, entry)
        const stat = await this.inner.lstat(entryPath)
        return {
          name: entry,
          isFile: stat.isFile,
          isDirectory: stat.isDirectory,
          isSymbolicLink: stat.isSymbolicLink
        }
      })
    )
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    await this.prepareMutation(path)
    return this.inner.rm(path, options)
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    await this.prepareMutation(dest)
    return this.inner.cp(src, dest, options)
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.prepareMutation(src)
    await this.prepareMutation(dest)
    return this.inner.mv(src, dest)
  }

  resolvePath(base: string, rel: string): string {
    return this.inner.resolvePath(base, rel)
  }

  getAllPaths(): string[] {
    return this.inner.getAllPaths()
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.prepareMutation(path)
    return this.inner.chmod(path, mode)
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    await this.prepareMutation(linkPath)
    return this.inner.symlink(target, linkPath)
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    await this.prepareMutation(newPath)
    return this.inner.link(existingPath, newPath)
  }

  async readlink(path: string): Promise<string> {
    return this.inner.readlink(path)
  }

  async lstat(path: string): Promise<FsStat> {
    return this.inner.lstat(path)
  }

  async realpath(path: string): Promise<string> {
    return this.inner.realpath(path)
  }

  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    await this.prepareMutation(path)
    return this.inner.utimes(path, atime, mtime)
  }

  private addTrackedRoot(nextRootPath: string): void {
    if (this.isCoveredByTrackedRoot(nextRootPath)) {
      return
    }

    const nextRoots = new Set<string>()
    for (const existingRootPath of this.trackedRoots) {
      if (isSameOrDescendant(existingRootPath, nextRootPath)) {
        continue
      }

      nextRoots.add(existingRootPath)
    }

    nextRoots.add(nextRootPath)
    this.trackedRoots = nextRoots
  }

  private async captureTree(
    inputPath: string,
    snapshots: Map<string, FileSnapshot>,
    skipRoots: readonly string[] = []
  ): Promise<void> {
    const path = this.normalizePath(inputPath)
    if (!this.shouldTrackPath(path) || this.isCoveredByRoots(path, skipRoots)) {
      return
    }

    let stat: FsStat
    try {
      stat = await this.inner.lstat(path)
    } catch (error) {
      if (isMissingPathError(error)) {
        return
      }

      throw error
    }

    if (stat.isDirectory) {
      const entries = await this.readdirWithFileTypes(path)

      await Promise.all(
        entries.map((entry) =>
          this.captureTree(this.inner.resolvePath(path, entry.name), snapshots, skipRoots)
        )
      )

      return
    }

    if (!stat.isFile || snapshots.has(path)) {
      return
    }

    const content = await this.inner.readFileBuffer(path)
    snapshots.set(path, {
      contentHash: createHash("sha1").update(content).digest("hex"),
      mode: stat.mode
    })
  }

  private isCoveredByRoots(path: string, roots: readonly string[]): boolean {
    return roots.some((rootPath) => isSameOrDescendant(path, rootPath))
  }

  private isCoveredByTrackedRoot(path: string): boolean {
    return this.isCoveredByRoots(path, Array.from(this.trackedRoots))
  }

  private normalizePath(path: string): string {
    return this.inner.resolvePath("/", path)
  }

  private async prepareMutation(inputPath: string): Promise<void> {
    const path = this.normalizePath(inputPath)
    if (!this.shouldTrackPath(path) || this.isCoveredByTrackedRoot(path)) {
      return
    }

    const skipRoots = Array.from(this.trackedRoots)
    await this.captureTree(path, this.beforeSnapshots, skipRoots)
    this.addTrackedRoot(path)
  }
}
