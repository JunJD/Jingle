import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import test, { after, before } from "node:test"
import { createThread, initializeDatabase, closeDatabase } from "../../src/main/db"
import { ThreadWorkspaceRepository } from "../../src/main/thread-workspace/repository"
import { ThreadWorkspaceService } from "../../src/main/thread-workspace/service"
import { WorkspaceRepository } from "../../src/main/workspace/repository"
import { WorkspaceService } from "../../src/main/workspace/service"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

class MemorySafeJingleMemoryService {
  hasPendingWorkspaceSuggestions(): Promise<boolean> {
    return Promise.resolve(false)
  }
}

class StaticGlobalWorkspaceRepository extends WorkspaceRepository {
  constructor(private readonly workspacePath: string) {
    super()
  }

  override getGlobalWorkspacePath(): string | null {
    return this.workspacePath
  }
}

class MutableGlobalWorkspaceRepository extends WorkspaceRepository {
  constructor(private workspacePath: string) {
    super()
  }

  override getGlobalWorkspacePath(): string | null {
    return this.workspacePath
  }

  setWorkspacePath(workspacePath: string): void {
    this.workspacePath = workspacePath
  }
}

function createWorkspaceServiceFromRepository(
  repository: WorkspaceRepository,
  options: ConstructorParameters<typeof WorkspaceService>[3] = {}
): WorkspaceService {
  const threadWorkspaceService = new ThreadWorkspaceService(new ThreadWorkspaceRepository())
  return new WorkspaceService(
    repository,
    threadWorkspaceService,
    new MemorySafeJingleMemoryService() as unknown as ConstructorParameters<
      typeof WorkspaceService
    >[2],
    options
  )
}

function getFileSearchCache(service: WorkspaceService): Map<
  string,
  {
    expiresAt: number
    promise?: Promise<unknown>
    value?: unknown
  }
> {
  return (
    service as unknown as {
      fileSearchCache: Map<
        string,
        {
          expiresAt: number
          promise?: Promise<unknown>
          value?: unknown
        }
      >
    }
  ).fileSearchCache
}

function createDeferred<T>(): {
  promise: Promise<T>
  reject: (error: Error) => void
  resolve: (value: T) => void
  settled: boolean
} {
  let rejectPromise!: (error: Error) => void
  let resolvePromise!: (value: T) => void
  const deferred = {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    }),
    reject(error: Error) {
      deferred.settled = true
      rejectPromise(error)
    },
    resolve(value: T) {
      deferred.settled = true
      resolvePromise(value)
    },
    settled: false
  }
  return deferred
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }

  assert.fail("Timed out waiting for async workspace search state")
}

async function createWorkspaceService(
  threadId: string,
  workspacePath: string
): Promise<WorkspaceService> {
  const repository = new WorkspaceRepository()
  await createThread(threadId)
  await new ThreadWorkspaceService(new ThreadWorkspaceRepository()).bindProject(
    threadId,
    workspacePath
  )
  return createWorkspaceServiceFromRepository(repository)
}

before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-workspace-file-search-home-"))
  process.env.JINGLE_HOME = jingleHome
  execFileSync("node", ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      JINGLE_HOME: jingleHome
    }
  })
  await initializeDatabase()
})

after(async () => {
  await closeDatabase()
  if (originalJingleHome === undefined) {
    delete process.env.JINGLE_HOME
  } else {
    process.env.JINGLE_HOME = originalJingleHome
  }
  await rm(jingleHome, { force: true, recursive: true })
})

test("workspace file search returns workspace-relative file refs", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-workspace-search-"))
  try {
    await mkdir(join(root, "src", "main"), { recursive: true })
    await writeFile(join(root, "src", "main", "service.ts"), "export const service = true\n")
    await writeFile(join(root, "README.md"), "# Workspace\n")

    const threadId = `thread-search-${randomUUID()}`
    const service = await createWorkspaceService(threadId, root)
    const result = await service.searchFiles({
      query: "service",
      threadId
    })

    assert.deepEqual(result, {
      success: true,
      files: [
        {
          name: "service.ts",
          path: "src/main/service.ts"
        }
      ]
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("workspace file search includes hidden workspace files like opencode", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-workspace-hidden-"))
  try {
    await mkdir(join(root, ".github", "workflows"), { recursive: true })
    await writeFile(join(root, ".github", "workflows", "ci.yml"), "name: ci\n")

    const threadId = `thread-hidden-search-${randomUUID()}`
    const service = await createWorkspaceService(threadId, root)
    const result = await service.searchFiles({
      query: "ci",
      threadId
    })

    assert.deepEqual(result, {
      success: true,
      files: [
        {
          name: "ci.yml",
          path: ".github/workflows/ci.yml"
        }
      ]
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("workspace file search uses global workspace when thread id is omitted", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-workspace-global-search-"))
  try {
    await mkdir(join(root, "src"), { recursive: true })
    await writeFile(join(root, "src", "global-search-target.ts"), "export const found = true\n")

    const service = createWorkspaceServiceFromRepository(new StaticGlobalWorkspaceRepository(root))
    const result = await service.searchFiles({
      query: "global search target"
    })

    assert.deepEqual(result, {
      success: true,
      files: [
        {
          name: "global-search-target.ts",
          path: "src/global-search-target.ts"
        }
      ]
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("global workspace path creates the configured workspace root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "jingle-workspace-root-"))
  const root = join(parent, "Documents", "Jingle")
  try {
    const service = createWorkspaceServiceFromRepository(new StaticGlobalWorkspaceRepository(root))
    const resolvedRoot = await service.resolveGlobalWorkspacePath()

    assert.equal(resolvedRoot, root)
    assert.equal((await stat(root)).isDirectory(), true)
  } finally {
    await rm(parent, { force: true, recursive: true })
  }
})

test("default AI workspace is created below the global workspace root", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-ai-workspace-root-"))
  try {
    const service = createWorkspaceServiceFromRepository(new StaticGlobalWorkspaceRepository(root))
    const workspacePath = await service.createDefaultWorkspace({
      title: 'Design: / invalid "title"'
    })

    assert.equal(dirname(workspacePath), root)
    assert.match(basename(workspacePath), /Design invalid title/)
    assert.equal((await stat(workspacePath)).isDirectory(), true)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("workspace file search ranks across the full ripgrep file list", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-workspace-large-search-"))
  try {
    await mkdir(join(root, "bulk"), { recursive: true })
    await mkdir(join(root, "deep"), { recursive: true })
    await Promise.all(
      Array.from({ length: 5050 }, (_, index) =>
        writeFile(join(root, "bulk", `file-${index.toString().padStart(4, "0")}.txt`), "\n")
      )
    )
    await writeFile(join(root, "deep", "needle-workspace-file.ts"), "export const found = true\n")

    const threadId = `thread-large-search-${randomUUID()}`
    const service = await createWorkspaceService(threadId, root)
    const result = await service.searchFiles({
      query: "needleworkspacefile",
      threadId
    })

    assert.deepEqual(result, {
      success: true,
      files: [
        {
          name: "needle-workspace-file.ts",
          path: "deep/needle-workspace-file.ts"
        }
      ]
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("workspace file search skips dependency and build output directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-workspace-ignore-search-"))
  try {
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true })
    await mkdir(join(root, "dist"), { recursive: true })
    await mkdir(join(root, "src"), { recursive: true })
    await writeFile(join(root, "node_modules", "pkg", "middleware.ts"), "export const dep = true\n")
    await writeFile(join(root, "dist", "middleware.ts"), "export const built = true\n")
    await writeFile(join(root, "src", "middleware.ts"), "export const source = true\n")

    const threadId = `thread-ignore-search-${randomUUID()}`
    const service = await createWorkspaceService(threadId, root)
    const result = await service.searchFiles({
      query: "middleware",
      threadId
    })

    assert.deepEqual(result, {
      success: true,
      files: [
        {
          name: "middleware.ts",
          path: "src/middleware.ts"
        }
      ]
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("workspace file search bounds cached workspace path collections", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-workspace-cache-bound-"))
  const cacheEntryLimit = 64

  try {
    const workspacePaths = await Promise.all(
      Array.from({ length: cacheEntryLimit + 1 }, async (_, index) => {
        const workspacePath = join(root, `workspace-${index}`)
        await mkdir(workspacePath, { recursive: true })
        await writeFile(join(workspacePath, `file-${index}.txt`), "cached\n")
        return workspacePath
      })
    )
    const repository = new MutableGlobalWorkspaceRepository(workspacePaths[0])
    const service = createWorkspaceServiceFromRepository(repository)

    for (const workspacePath of workspacePaths.slice(0, cacheEntryLimit)) {
      repository.setWorkspacePath(workspacePath)
      const result = await service.searchFiles({ query: "file" })
      assert.equal(result.success, true)
    }

    repository.setWorkspacePath(workspacePaths[0])
    await service.searchFiles({ query: "file" })
    repository.setWorkspacePath(workspacePaths[cacheEntryLimit])
    await service.searchFiles({ query: "file" })

    const cache = getFileSearchCache(service)
    assert.equal(cache.size, cacheEntryLimit)

    await writeFile(join(workspacePaths[1], "post-eviction-marker.txt"), "fresh\n")
    repository.setWorkspacePath(workspacePaths[1])
    const evictedResult = await service.searchFiles({ query: "post eviction marker" })

    assert.deepEqual(evictedResult, {
      success: true,
      files: [
        {
          name: "post-eviction-marker.txt",
          path: "post-eviction-marker.txt"
        }
      ]
    })

    await writeFile(join(workspacePaths[0], "still-cached-marker.txt"), "stale\n")
    repository.setWorkspacePath(workspacePaths[0])
    const retainedResult = await service.searchFiles({ query: "still cached marker" })

    assert.deepEqual(retainedResult, {
      success: true,
      files: []
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("workspace file search ignores completions from evicted pending entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-workspace-cache-pending-"))
  const cacheEntryLimit = 64
  type Collection = { completed: boolean; paths: string[] }
  const deferredByPath = new Map<string, Array<ReturnType<typeof createDeferred<Collection>>>>()
  let collectorCallCount = 0

  try {
    const workspacePaths = Array.from({ length: cacheEntryLimit + 1 }, (_, index) =>
      join(root, `workspace-${index}`)
    )
    const repository = new MutableGlobalWorkspaceRepository(workspacePaths[0])
    const service = createWorkspaceServiceFromRepository(repository, {
      collectFilePaths: (workspacePath) => {
        const deferred = createDeferred<Collection>()
        const calls = deferredByPath.get(workspacePath) ?? []
        calls.push(deferred)
        deferredByPath.set(workspacePath, calls)
        collectorCallCount += 1
        return deferred.promise
      }
    })
    const originalSearches: Array<ReturnType<typeof service.searchFiles>> = []
    for (const workspacePath of workspacePaths) {
      repository.setWorkspacePath(workspacePath)
      originalSearches.push(service.searchFiles({ query: "file" }))
      await waitFor(() => deferredByPath.has(workspacePath))
    }
    assert.equal(collectorCallCount, workspacePaths.length)

    const firstCalls = deferredByPath.get(workspacePaths[0])!
    repository.setWorkspacePath(workspacePaths[0])
    const firstReplacementSearch = service.searchFiles({ query: "replacement" })
    await waitFor(() => (deferredByPath.get(workspacePaths[0])?.length ?? 0) === 2)
    const firstReplacement = deferredByPath.get(workspacePaths[0])![1]

    firstCalls[0].resolve({ completed: true, paths: ["evicted-old-success.txt"] })
    await originalSearches[0]
    assert.equal(
      getFileSearchCache(service).get(workspacePaths[0])?.promise,
      firstReplacement.promise
    )

    const secondCalls = deferredByPath.get(workspacePaths[1])!
    repository.setWorkspacePath(workspacePaths[1])
    const secondReplacementSearch = service.searchFiles({ query: "replacement" })
    await waitFor(() => (deferredByPath.get(workspacePaths[1])?.length ?? 0) === 2)
    const secondReplacement = deferredByPath.get(workspacePaths[1])![1]

    secondCalls[0].reject(new Error("evicted old failure"))
    await originalSearches[1]
    assert.equal(
      getFileSearchCache(service).get(workspacePaths[1])?.promise,
      secondReplacement.promise
    )

    for (const deferreds of deferredByPath.values()) {
      for (const deferred of deferreds) {
        if (!deferred.settled) {
          deferred.resolve({ completed: true, paths: ["current.txt"] })
        }
      }
    }
    await Promise.all([...originalSearches, firstReplacementSearch, secondReplacementSearch])
    assert.equal(getFileSearchCache(service).size, cacheEntryLimit)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("workspace file search removes expired path collections on the next miss", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-workspace-cache-expiry-"))
  let now = 0

  try {
    const workspacePaths = [join(root, "workspace-0"), join(root, "workspace-1")]
    const repository = new MutableGlobalWorkspaceRepository(workspacePaths[0])
    const service = createWorkspaceServiceFromRepository(repository, {
      collectFilePaths: () => Promise.resolve({ completed: true, paths: ["current.txt"] }),
      now: () => now
    })

    await service.searchFiles({ query: "current" })
    now = 30_001
    repository.setWorkspacePath(workspacePaths[1])
    await service.searchFiles({ query: "current" })

    assert.deepEqual([...getFileSearchCache(service).keys()], [workspacePaths[1]])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("workspace read file rejects sibling prefix path escapes", async () => {
  const parent = await mkdtemp(join(tmpdir(), "jingle-workspace-parent-"))
  const workspacePath = join(parent, "workspace")
  const siblingPath = join(parent, "workspace-neighbor")
  try {
    await mkdir(workspacePath, { recursive: true })
    await mkdir(siblingPath, { recursive: true })
    await writeFile(join(siblingPath, "secret.txt"), "nope\n")

    const threadId = `thread-path-escape-${randomUUID()}`
    const service = await createWorkspaceService(threadId, workspacePath)
    const result = await service.readFile({
      filePath: "../workspace-neighbor/secret.txt",
      threadId
    })

    assert.deepEqual(result, {
      success: false,
      error: "Access denied: path outside workspace"
    })
  } finally {
    await rm(parent, { force: true, recursive: true })
  }
})
