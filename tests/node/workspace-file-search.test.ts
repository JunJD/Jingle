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
let openworkHome = ""

class MemorySafeOpenworkMemoryService {
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

function createWorkspaceServiceFromRepository(repository: WorkspaceRepository): WorkspaceService {
  const threadWorkspaceService = new ThreadWorkspaceService(new ThreadWorkspaceRepository())
  return new WorkspaceService(
    repository,
    threadWorkspaceService,
    new MemorySafeOpenworkMemoryService() as unknown as ConstructorParameters<
      typeof WorkspaceService
    >[2]
  )
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
  openworkHome = await mkdtemp(join(tmpdir(), "openwork-workspace-file-search-home-"))
  process.env.OPENWORK_HOME = openworkHome
  execFileSync("node", ["scripts/run-prisma-openwork-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENWORK_HOME: openworkHome
    }
  })
  await initializeDatabase()
})

after(async () => {
  await closeDatabase()
  delete process.env.OPENWORK_HOME
  await rm(openworkHome, { force: true, recursive: true })
})

test("workspace file search returns workspace-relative file refs", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-workspace-search-"))
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
  const root = await mkdtemp(join(tmpdir(), "openwork-workspace-hidden-"))
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
  const root = await mkdtemp(join(tmpdir(), "openwork-workspace-global-search-"))
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
  const parent = await mkdtemp(join(tmpdir(), "openwork-workspace-root-"))
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
  const root = await mkdtemp(join(tmpdir(), "openwork-ai-workspace-root-"))
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
  const root = await mkdtemp(join(tmpdir(), "openwork-workspace-large-search-"))
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
  const root = await mkdtemp(join(tmpdir(), "openwork-workspace-ignore-search-"))
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

test("workspace read file rejects sibling prefix path escapes", async () => {
  const parent = await mkdtemp(join(tmpdir(), "openwork-workspace-parent-"))
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
